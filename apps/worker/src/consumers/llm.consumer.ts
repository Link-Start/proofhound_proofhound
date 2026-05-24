import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { DbClient } from '@proofhound/db';
import { RateLimitExceededError, type RateLimiter } from '@proofhound/limiter';
import { normalizeLLMError } from '@proofhound/llm-client';
import { createLogger } from '@proofhound/logger';
import {
  llmJobPayloadSchema,
  remainingWebhookAsyncCallTtlSeconds,
  webhookAsyncCallKey,
  type LlmJobPayload,
  type WebhookAsyncCallContext,
  type WebhookAsyncCallErrorReceipt,
  type WebhookAsyncCallSuccessReceipt,
} from '@proofhound/orchestration-shared';
import { DelayedError, type Job } from 'bullmq';
import type Redis from 'ioredis';
import { DATABASE_CLIENT } from '../infrastructure/database/database.constants';
import {
  MODEL_SECRET_RESOLVER,
  modelSecretResolverFactory,
} from '../infrastructure/llm/model-secret.provider';
import { REDIS_CLIENT, REDIS_LIMITER } from '../infrastructure/redis/redis.constants';
import { resolveWorkerConcurrency } from '../config/worker-concurrency';
import { createLlmRunner, type LlmRunnerResult } from '../runners/llm-runner';
import type { ModelSecretResolver } from '../runners/model-secret';
import { DrizzleRunResultWriter } from '../runners/run-result-writer';

export const LLM_WORKER_CONCURRENCY = resolveWorkerConcurrency();

@Processor('llm', { concurrency: LLM_WORKER_CONCURRENCY })
@Injectable()
export class LlmConsumer extends WorkerHost {
  private readonly logger = createLogger('worker.llm', { service: 'worker' });
  private readonly runLlmJob: ReturnType<typeof createLlmRunner>;
  private readonly runResultWriter: DrizzleRunResultWriter;

  constructor(
    @Inject(DATABASE_CLIENT) db: DbClient,
    @Inject(REDIS_LIMITER) limiter: RateLimiter,
    @Inject(MODEL_SECRET_RESOLVER) modelSecretResolver: ModelSecretResolver,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
    this.runLlmJob = createLlmRunner({ db, limiter, logger: this.logger, modelSecretResolver });
    this.runResultWriter = new DrizzleRunResultWriter(db);
  }

  async process(job: Job<unknown>, token?: string): Promise<LlmRunnerResult> {
    const payload = llmJobPayloadSchema.parse(job.data) satisfies LlmJobPayload;
    try {
      const result = await this.runLlmJob(payload, {
        bullmqJobId: String(job.id),
        bullmqQueue: 'llm',
        attempt: job.attemptsMade + 1,
        dbosWorkflowId: payload.dbosWorkflowId,
      });
      if (payload.webhookAsyncCall) {
        await this.writeWebhookAsyncSuccess(payload.webhookAsyncCall, result).catch((cacheError) => {
          this.logger.error(
            {
              bullmqJobId: String(job.id),
              runResultId: result.runResultId,
              error: (cacheError as Error).message,
            },
            'webhook_async_call_success_cache_write_failed',
          );
        });
      }
      return result;
    } catch (error) {
      if (error instanceof RateLimitExceededError) {
        // 限流命中：推迟到下个时间窗，**不消耗 attempt**——SPEC 03 §4.2 的 attempts=5 留给真错误
        const delayMs = Math.max(error.retryAfterMs, 1_000);
        this.logger.info(
          {
            bullmqJobId: String(job.id),
            modelId: payload.modelId,
            reason: error.reason,
            retryAfterMs: error.retryAfterMs,
            delayMs,
          },
          'llm_job_throttled',
        );
        await job.moveToDelayed(Date.now() + delayMs, token);
        throw new DelayedError();
      }
      throw error;
    }
  }

  // BullMQ 在 attempts 用尽后才触发 'failed' 事件,这里写一次最终 error 行(DrizzleRunResultWriter 内置
  // INSERT...WHERE NOT EXISTS 兜底:如果之前的 attempt 已经写入 success 行,这条 error 不会覆盖)。
  @OnWorkerEvent('failed')
  async onFailed(job: Job<unknown>, error: Error): Promise<void> {
    const parsed = llmJobPayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.error(
        { bullmqJobId: String(job.id), error: error.message },
        'llm_job_final_failure_payload_invalid',
      );
      return;
    }
    const payload = parsed.data;
    if ((job.attemptsMade ?? 0) < (job.opts.attempts ?? 1)) {
      // 还能继续 retry,本次失败不应落最终 error 行
      return;
    }

    const runResultId = payload.runResultId ?? randomUUID();
    // LLMAdapterHttpError.message 是固定字符串，真正的 provider 错误正文在 providerErrorBody，需要还原后再入库
    const normalized = normalizeLLMError(error);
    const errorClass = normalized.errorClass || error.name || 'Error';
    const errorMessage = (normalized.errorMessage || job.failedReason || 'job failed').slice(0, 2000);

    try {
      await this.runResultWriter.writeRunResult({
        id: runResultId,
        projectId: payload.projectId,
        source: payload.source,
        sourceId: payload.sourceId,
        releaseVariantId: payload.releaseVariantId ?? null,
        promptVersionId: payload.promptVersionId,
        modelId: payload.modelId,
        sampleId: payload.sampleId ?? null,
        externalId: payload.externalId ?? null,
        renderedPrompt: payload.renderedPrompt,
        inputVariables: payload.inputVariables,
        rawResponse: null,
        parsedOutput: null,
        status: errorClass === 'AbortError' ? 'timeout' : 'error',
        errorClass,
        errorMessage,
        latencyMs: null,
        inputTokens: null,
        outputTokens: null,
        costEstimate: null,
        attempt: job.attemptsMade ?? 1,
        dbosWorkflowId: payload.dbosWorkflowId ?? null,
        bullmqJobId: String(job.id),
      });
      this.logger.info(
        {
          bullmqJobId: String(job.id),
          runResultId,
          attempts: job.attemptsMade,
          errorClass,
        },
        'llm_job_final_error_persisted',
      );
    } catch (writeError) {
      this.logger.error(
        {
          bullmqJobId: String(job.id),
          runResultId,
          error: (writeError as Error).message,
        },
        'llm_job_final_error_write_failed',
      );
    }

    if (payload.webhookAsyncCall) {
      await this.writeWebhookAsyncError(payload.webhookAsyncCall, {
        runResultId,
        runStatus: errorClass === 'AbortError' ? 'timeout' : 'error',
        errorClass,
        errorMessage,
      }).catch((cacheError) => {
        this.logger.error(
          {
            bullmqJobId: String(job.id),
            runResultId,
            error: (cacheError as Error).message,
          },
          'webhook_async_call_error_cache_write_failed',
        );
      });
    }
  }

  private async writeWebhookAsyncSuccess(
    call: WebhookAsyncCallContext,
    result: LlmRunnerResult,
  ): Promise<void> {
    const ttl = await this.getWebhookAsyncCallTtl(call);
    if (ttl <= 0) return;
    const completedAt = new Date().toISOString();
    const receipt: WebhookAsyncCallSuccessReceipt = {
      ...call,
      status: 'success',
      updatedAt: completedAt,
      completedAt,
      result: result.parsed ?? result.content ?? result.decisionOutput ?? null,
      rawResponse: result.content,
      parsedOutput: result.parsed ?? null,
      decisionOutput: result.decisionOutput ?? null,
      judgmentStatus: result.judgmentStatus ?? null,
      latencyMs: result.durationMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costEstimate: result.costEstimate,
    };
    await this.redis.set(webhookAsyncCallKey(call.callId), JSON.stringify(receipt), 'EX', ttl);
  }

  private async writeWebhookAsyncError(
    call: WebhookAsyncCallContext,
    input: {
      runResultId: string;
      runStatus: string;
      errorClass: string | null;
      errorMessage: string | null;
    },
  ): Promise<void> {
    const ttl = await this.getWebhookAsyncCallTtl(call);
    if (ttl <= 0) return;
    const completedAt = new Date().toISOString();
    const receipt: WebhookAsyncCallErrorReceipt = {
      ...call,
      runResultId: input.runResultId,
      status: 'error',
      updatedAt: completedAt,
      completedAt,
      runStatus: input.runStatus,
      errorClass: input.errorClass,
      errorMessage: input.errorMessage,
      latencyMs: null,
    };
    await this.redis.set(webhookAsyncCallKey(call.callId), JSON.stringify(receipt), 'EX', ttl);
  }

  private async getWebhookAsyncCallTtl(call: WebhookAsyncCallContext): Promise<number> {
    const ttl = await this.redis.ttl(webhookAsyncCallKey(call.callId));
    if (ttl > 0) return ttl;
    if (ttl === -2) return 0;
    return remainingWebhookAsyncCallTtlSeconds(call.expiresAt);
  }
}

export const llmConsumerProviders = [
  {
    provide: MODEL_SECRET_RESOLVER,
    useFactory: modelSecretResolverFactory,
  },
];

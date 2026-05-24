import { createHash } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfiguredInstance, DBOS } from '@dbos-inc/dbos-sdk';
import {
  DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
  type ErrorPatternAnalysisConfig,
  errorPatternAnalysisConfigSchema,
  analyzeFailures,
  generateNextVersion,
  generateInitialVersion,
  FirstVersionParseError,
  allGoalsMet,
  computeNoBestStreak,
  decideRoundOutcome,
  getOptimizationTipNames,
  isBetterThan,
  readMetric,
} from '@proofhound/optimization-strategy';
import type {
  AnalyzeFailuresResult,
  AnalysisEvidenceBundle,
  OptimizationGoal,
  FieldWhitelist,
  MetricSnapshot,
  PromptVersionRef,
  RoundHistoryEntry,
  RunResultRecord,
  SampleRecord,
  SummarizeOutput,
} from '@proofhound/optimization-strategy';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { RateLimitExceededError, type RateLimiter } from '@proofhound/limiter';
import {
  type LLMCallLogger,
  type LLMMessage,
  type ModelImageCapability,
  type ModelInvocationConfig,
  type RateLimiterLike,
} from '@proofhound/llm-client';
import { createLogger } from '@proofhound/logger';
import {
  DEFAULT_PROMPT_LANGUAGE,
  optimizationFieldWhitelistSchema,
  optimizationGoalSchema,
  experimentRunConfigSchema,
  type OptimizationFieldWhitelistDto,
  type OptimizationGoalDto,
  type ExperimentRunConfigDto,
  type PromptVariableDto,
  type PromptLanguageDto,
  type PromptOutputSchemaDto,
  type PromptJudgmentRulesDto,
  promptLanguageSchema,
  promptVariableSchema,
} from '@proofhound/shared';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { DATABASE_CLIENT } from '../../infrastructure/database/database.constants';
import { DrizzleRunResultWriter } from '../../infrastructure/llm/run-result-writer';
import { REDIS_LIMITER } from '../../infrastructure/redis/redis.constants';
import { ExperimentService } from '../experiment/experiment.service';
import { ExperimentWorkflowRegistrar } from '../experiment/experiment.workflow';
import { PromptRepository } from '../prompt/prompt.repository';
import {
  OptimizationRepository,
  type OptimizationAnalysisExperimentRow,
  type OptimizationRoundHistoryRow,
  type OptimizationRunResultRow,
  type OptimizationWorkflowContext,
  type OptimizationRoundStepKind,
  type OptimizationRoundStepStatus,
  type RoundStepUpsertInput,
} from './optimization.repository';

const { models, runResults, experiments } = schema;

// 命名空间 UUID(随机选定且写死,保证跨重启稳定)——与 ExperimentWorkflow 区别开,避免哈希撞表
const OPTIMIZATION_NS = '4a3f1b9e-5d7c-4f2a-9e1b-3c2d8e7a4f01';

const POLL_SLEEP_SCHEDULE_SEC = [3, 3, 5, 8, 10, 15];
const POLL_TIMEOUT_SEC = 60 * 60; // 单轮子实验最长 1h 兜底,长跑可在 runConfig 覆盖
const OPTIMIZATION_EXPERIMENT_NAME_MAX_LENGTH = 200;
const OPTIMIZATION_EXPERIMENT_NAME_SEPARATOR = ' · ';
const OPTIMIZATION_EXPERIMENT_NAME_FALLBACK = 'optimization';

type FinalizeKind = 'success' | 'failed' | 'stopped' | 'cancelled';
type ControlSignal = 'stop' | 'resume' | 'cancel' | null;
type ChildExperimentAction = 'stop' | 'cancel' | 'resume';
type WorkflowControlState = { status: string; controlState: ControlSignal } | null;
type BaselineExperimentStatus = 'running' | 'success' | 'failed' | 'stopped' | 'cancelled';

// 系统 actor:workflow / service 内代表"系统"调 ExperimentService.controlExperiment 时使用。
// 开源版不维护用户表和审计表，这里只保留稳定 actor id 方便日志与业务字段追溯。
export const SYSTEM_ACTOR_OPTIMIZATION: CurrentUserPayload = {
  sub: '00000000-0000-0000-0000-000000000000',
  email: 'system@proofhound.local',
  isSuperAdmin: true,
  isActive: true,
};

interface WorkflowConfigSnapshot {
  ok: boolean;
  reason?: string;
  // 上下文
  projectId: string;
  optimizationName: string;
  promptId: string | null;
  baseVersionId: string | null;
  basePromptVersion: PromptVersionRef | null;
  datasetId: string;
  datasetSampleCount: number;
  startingMode: string;
  sourceExperimentId: string | null;
  promptLanguage: PromptLanguageDto;
  analysisModel: ModelInvocationConfig;
  taskModel: ModelInvocationConfig;
  goals: OptimizationGoal[];
  fieldWhitelist: FieldWhitelist;
  strategy: string;
  strategyConfig: ErrorPatternAnalysisConfig;
  maxRounds: number;
  optimizationHint?: string;
  createdBy: string;
  // 快照
  nextRound: number;
  bestVersion: PromptVersionRef | null;
  bestMetrics: MetricSnapshot;
  // SPEC 25 §11 子实验 runConfig 继承:optimizations.run_config 解析为 experimentRunConfigSchema
  // 后直接作为每轮子实验 runConfig 写入,字段集合与 experimentRunConfigSchema 一致(无 description)。
  childRunConfig: ExperimentRunConfigDto;
  // SPEC 25 §7 恢复粒度:当 nextRound 对应轮次的子实验已存在且未终态(stopped/running)时,
  // 这里携带 experimentId,让 runImpl 跳过 startWorkflow 改走"continue child"路径
  resumeChildExpId: string | null;
}

interface RoundOutcome {
  kind: 'continue' | 'goals_met' | 'fatal';
  metrics?: MetricSnapshot;
  isBest?: boolean;
  errorMessage?: string;
  analysisFailure?: boolean;
}

type PrepareOutcome =
  | { kind: 'launch'; experimentId: string }
  | { kind: 'fatal'; errorMessage: string; analysisFailure?: boolean };

interface PromptBaselinePrepareOutcome {
  kind: 'skip' | 'ready' | 'launch' | 'wait' | 'failed' | 'stopped' | 'cancelled';
  experimentId?: string;
  status?: BaselineExperimentStatus;
  errorMessage?: string;
}

interface PromptBaselineFinalizeOutcome {
  kind: 'ready' | 'failed' | 'stopped' | 'cancelled';
  errorMessage?: string;
}

interface RoundOptimizationContext {
  generationBaseVersion: PromptVersionRef;
  analysisVersion: PromptVersionRef;
  analysisExperiment: OptimizationAnalysisExperimentRow;
  previousExperiment: OptimizationAnalysisExperimentRow | null;
  previousVersion: PromptVersionRef | null;
  regressionRetry: boolean;
}

@Injectable()
export class OptimizationWorkflowRegistrar extends ConfiguredInstance {
  private readonly logger = createLogger('optimization.workflow', { service: 'server' });
  private readonly llmLogger: LLMCallLogger = createLogger('optimization.workflow.llm', {
    service: 'server',
  });

  readonly runWorkflow: (optimizationId: string) => Promise<void>;
  private readonly loadConfigStep: (optimizationId: string) => Promise<WorkflowConfigSnapshot>;
  private readonly markStartedStep: (optimizationId: string) => Promise<void>;
  // SPEC 25 §2.1: from_dataset_only 起步专用 — 从数据集采样 + 调 analysisModel 生成首版 prompt
  private readonly generateFirstVersionStep: (optimizationId: string) => Promise<void>;
  private readonly preparePromptBaselineStep: (optimizationId: string) => Promise<PromptBaselinePrepareOutcome>;
  private readonly recordBaselineWorkflowIdStep: (experimentId: string, workflowId: string) => Promise<void>;
  private readonly markPromptBaselineFailedStep: (experimentId: string, failureReason: string) => Promise<void>;
  private readonly finalizePromptBaselineStep: (
    optimizationId: string,
    experimentId: string,
  ) => Promise<PromptBaselineFinalizeOutcome>;
  private readonly readStateStep: (optimizationId: string) => Promise<WorkflowControlState>;
  private readonly clearResumeStep: (optimizationId: string) => Promise<void>;
  private readonly prepareRoundStep: (optimizationId: string, roundNumber: number) => Promise<PrepareOutcome>;
  private readonly finalizeRoundStep: (
    optimizationId: string,
    roundNumber: number,
    experimentId: string,
  ) => Promise<RoundOutcome>;
  private readonly markChildLaunchFailedStep: (
    experimentId: string,
    message: string,
    optimizationId: string,
    roundNumber: number,
  ) => Promise<void>;
  private readonly finalizeStep: (
    optimizationId: string,
    kind: FinalizeKind,
    options: { reason?: string; analysisFailureReason?: string },
  ) => Promise<void>;
  // SPEC 25 §11.3:跨轮历史聚合 — prepareRoundImpl 内即时从 DB 聚合,纯读,replay 安全
  private readonly loadRoundHistoryStep: (
    optimizationId: string,
    beforeRoundIndex: number,
  ) => Promise<OptimizationRoundHistoryRow[]>;
  // SPEC 25 §11.4.1:LLM 结果复用 — prepareRoundImpl 调 LLM 前先查 success 行,命中则跳过 LLM
  private readonly peekOptimizationRunResultStep: (
    optimizationId: string,
    roundNumber: number,
    source: 'optimization_analysis' | 'optimization_generate',
  ) => Promise<{ parsedOutput: unknown; rawResponse: string | null } | null>;
  // SPEC 25 §7:父 stop/cancel 联动子实验;父 resume 时也用同 step 把子实验 resume 起来
  private readonly controlChildExperimentStep: (
    projectId: string,
    experimentId: string,
    action: ChildExperimentAction,
  ) => Promise<{ ok: boolean; reason?: string }>;
  // SPEC 25 §7 恢复粒度:resume 进入断点轮时查子实验当前状态,决定是否需要 resume / 已 terminal 不再启
  private readonly queryChildExperimentStatusStep: (
    experimentId: string,
  ) => Promise<{ status: string; controlState: string | null } | null>;

  constructor(
    @Inject(DATABASE_CLIENT) private readonly db: DbClient,
    private readonly repo: OptimizationRepository,
    private readonly promptRepo: PromptRepository,
    private readonly experimentWorkflow: ExperimentWorkflowRegistrar,
    private readonly experimentService: ExperimentService,
    private readonly crypto: CryptoService,
    @Inject(REDIS_LIMITER) private readonly limiter: RateLimiter,
    private readonly runResultWriter: DrizzleRunResultWriter,
  ) {
    super('optimization-workflow');
    this.loadConfigStep = DBOS.registerStep(this.loadConfigImpl.bind(this), {
      name: 'optimization.loadConfig',
    });
    this.markStartedStep = DBOS.registerStep(this.markStartedImpl.bind(this), {
      name: 'optimization.markStarted',
    });
    this.generateFirstVersionStep = DBOS.registerStep(this.generateFirstVersionImpl.bind(this), {
      name: 'optimization.generateFirstVersion',
    });
    this.preparePromptBaselineStep = DBOS.registerStep(this.preparePromptBaselineImpl.bind(this), {
      name: 'optimization.preparePromptBaseline',
    });
    this.recordBaselineWorkflowIdStep = DBOS.registerStep(this.recordBaselineWorkflowIdImpl.bind(this), {
      name: 'optimization.recordBaselineWorkflowId',
    });
    this.markPromptBaselineFailedStep = DBOS.registerStep(this.markPromptBaselineFailedImpl.bind(this), {
      name: 'optimization.markPromptBaselineFailed',
    });
    this.finalizePromptBaselineStep = DBOS.registerStep(this.finalizePromptBaselineImpl.bind(this), {
      name: 'optimization.finalizePromptBaseline',
    });
    this.readStateStep = DBOS.registerStep(this.readStateImpl.bind(this), {
      name: 'optimization.readState',
    });
    this.clearResumeStep = DBOS.registerStep(this.clearResumeImpl.bind(this), {
      name: 'optimization.clearResume',
    });
    this.prepareRoundStep = DBOS.registerStep(this.prepareRoundImpl.bind(this), {
      name: 'optimization.prepareRound',
    });
    this.finalizeRoundStep = DBOS.registerStep(this.finalizeRoundImpl.bind(this), {
      name: 'optimization.finalizeRound',
    });
    this.markChildLaunchFailedStep = DBOS.registerStep(this.markChildLaunchFailedImpl.bind(this), {
      name: 'optimization.markChildLaunchFailed',
    });
    this.finalizeStep = DBOS.registerStep(this.finalizeImpl.bind(this), {
      name: 'optimization.finalize',
    });
    this.loadRoundHistoryStep = DBOS.registerStep(this.loadRoundHistoryImpl.bind(this), {
      name: 'optimization.loadRoundHistory',
    });
    this.peekOptimizationRunResultStep = DBOS.registerStep(this.peekOptimizationRunResultImpl.bind(this), {
      name: 'optimization.peekRunResult',
    });
    this.controlChildExperimentStep = DBOS.registerStep(this.controlChildExperimentImpl.bind(this), {
      name: 'optimization.controlChildExperiment',
    });
    this.queryChildExperimentStatusStep = DBOS.registerStep(this.queryChildExperimentStatusImpl.bind(this), {
      name: 'optimization.queryChildExperimentStatus',
    });

    this.runWorkflow = DBOS.registerWorkflow(this.runImpl.bind(this), {
      name: 'OptimizationWorkflow',
    });

    this.logger.info({}, 'optimization_workflow_registered');
  }

  private async runImpl(optimizationId: string): Promise<void> {
    this.logger.debug({ optimizationId }, 'workflow_run_start');

    try {
      let snapshot: WorkflowConfigSnapshot;
      try {
        snapshot = await this.loadConfigStep(optimizationId);
      } catch (error) {
        await this.finalizeStep(optimizationId, 'failed', {
          reason: `load_config_failed: ${(error as Error).message}`,
        });
        return;
      }

      if (!snapshot.ok) {
        await this.finalizeStep(optimizationId, 'failed', { reason: snapshot.reason });
        return;
      }

      await this.markStartedStep(optimizationId);

      // SPEC 25 §2.1: from_dataset_only 起步,首版 prompt 由 generateFirstVersionStep 生成
      // (调 analysisModel,从数据集随机采样归纳出 prompt body / variables / outputSchema)。
      // step 成功后 base_version_id 已回填,重 loadConfig 拿到带新 baseVersionId 的 snapshot;
      // 后续 ensurePromptBaseline 走与 from_prompt_version 同构的 baseline 实验路径。
      if (snapshot.startingMode === 'from_dataset_only' && !snapshot.baseVersionId) {
        try {
          await this.generateFirstVersionStep(optimizationId);
        } catch (error) {
          const reason = mapFirstVersionErrorReason(error);
          await this.finalizeStep(optimizationId, 'failed', { reason });
          return;
        }
        const reloaded = await this.loadConfigStep(optimizationId);
        if (!reloaded.ok) {
          await this.finalizeStep(optimizationId, 'failed', {
            reason: reloaded.reason ?? 'reload_after_first_version_failed',
          });
          return;
        }
        snapshot = reloaded;
      }

      const baseline = await this.ensurePromptBaseline(optimizationId, snapshot);
      if (baseline.kind === 'exit') return;
      if (baseline.kind === 'fatal') {
        await this.finalizeStep(optimizationId, 'failed', {
          reason: baseline.errorMessage,
        });
        return;
      }
      snapshot = baseline.snapshot;

      // Pre-loop goal check（from_experiment 起点可能已达标,直接收尾）
      if (snapshot.bestVersion && allGoalsMet(snapshot.goals, snapshot.bestMetrics)) {
        await this.finalizeStep(optimizationId, 'success', { reason: 'goals_met' });
        return;
      }

      for (let n = snapshot.nextRound; n <= snapshot.maxRounds; n++) {
        const state = await this.readStateStep(optimizationId);
        // service 抢占式终态化(stop/cancel 时直接写 status=stopped/cancelled),
        // workflow 见到 status 已经不是 running 立即退出 —— 不再调 finalize 覆盖、
        // 不再启动子实验、不再写 round_steps。
        if (!state || state.status !== 'running') {
          this.logger.info(
            { optimizationId, status: state?.status ?? 'not_found' },
            'optimization_workflow_exit_preempted',
          );
          return;
        }
        if (state.controlState === 'cancel') {
          await this.finalizeStep(optimizationId, 'cancelled', { reason: 'control_cancel' });
          return;
        }
        if (state.controlState === 'stop') {
          await this.finalizeStep(optimizationId, 'stopped', { reason: 'control_stop' });
          return;
        }
        if (state.controlState === 'resume') {
          await this.clearResumeStep(optimizationId);
        }

        // SPEC 25 §7 恢复粒度:此次 loop 是否进入"接子实验断点续跑"分支
        // 只在 n == snapshot.nextRound 这一次成立;下一轮(n+1)走正常 prepare + startWorkflow
        const isResumeRound = n === snapshot.nextRound && snapshot.resumeChildExpId !== null;

        const prepare = await this.prepareRoundStep(optimizationId, n);
        if (prepare.kind === 'fatal') {
          await this.finalizeStep(optimizationId, 'failed', {
            reason: prepare.errorMessage ?? 'round_fatal_error',
            analysisFailureReason: prepare.analysisFailure ? prepare.errorMessage : undefined,
          });
          return;
        }

        if (isResumeRound) {
          // 子实验已经存在(prepare 内 ON CONFLICT DO NOTHING 也保证不覆盖);
          // 跳过 DBOS.startWorkflow(避免给同 id 重新派发引发歧义),
          // 若子实验是 stopped → 通过 service 启它的 resume(新 child workflow id)
          const childStatus = await this.queryChildExperimentStatusStep(prepare.experimentId);
          if (!childStatus) {
            this.logger.warn(
              { optimizationId, roundNumber: n, experimentId: prepare.experimentId },
              'optimization_resume_child_missing',
            );
            await this.finalizeStep(optimizationId, 'failed', {
              reason: 'resume_child_missing',
            });
            return;
          }
          if (childStatus.status === 'stopped') {
            await this.controlChildExperimentStep(snapshot.projectId, prepare.experimentId, 'resume');
            this.logger.info(
              { optimizationId, roundNumber: n, experimentId: prepare.experimentId },
              'optimization_child_resumed',
            );
          } else {
            this.logger.info(
              {
                optimizationId,
                roundNumber: n,
                experimentId: prepare.experimentId,
                childStatus: childStatus.status,
              },
              'optimization_resume_round_child_already_active',
            );
          }
        } else {
          // ---- workflow 层启动子 ExperimentWorkflow(SPEC 03 §3.2)----
          // DBOS 不允许 step 内调用 startWorkflow,所以 launch 必须在 workflow 层做。
          // 同 workflowId 同函数的重复 startWorkflow 是幂等成功(replay 安全),
          // 仅在同 id 但函数 / 类名不同时抛 DBOSConflictingWorkflowError——任何 catch 都是
          // 真实启动失败:把子实验改 failed,本轮按 continue 跳过(SPEC 25 §7),不阻断整体优化。
          const expWorkflowId = `optimization:${optimizationId}:round:${n}:exp`;
          try {
            await DBOS.startWorkflow(this.experimentWorkflow.runWorkflow, {
              workflowID: expWorkflowId,
            })(prepare.experimentId);
          } catch (error) {
            const message = (error as Error).message;
            this.logger.warn(
              { optimizationId, roundNumber: n, expWorkflowId, error: message },
              'child_experiment_launch_failed',
            );
            await this.markChildLaunchFailedStep(prepare.experimentId, message, optimizationId, n);
          }
        }

        const outcome = await this.finalizeRoundStep(optimizationId, n, prepare.experimentId);

        if (outcome.kind === 'fatal') {
          await this.finalizeStep(optimizationId, 'failed', {
            reason: outcome.errorMessage ?? 'round_fatal_error',
            analysisFailureReason: outcome.analysisFailure ? outcome.errorMessage : undefined,
          });
          return;
        }
        if (outcome.kind === 'goals_met') {
          await this.finalizeStep(optimizationId, 'success', { reason: 'goals_met' });
          return;
        }
      }

      await this.finalizeStep(optimizationId, 'failed', { reason: 'max_rounds' });
    } catch (error) {
      // 兜底:任何未捕获的 step 异常都把 status 写成 failed,避免应用表停留在 running
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ optimizationId, err: message }, 'workflow_unhandled_error');
      try {
        await this.finalizeStep(optimizationId, 'failed', {
          reason: `unhandled_workflow_error: ${message}`,
        });
      } catch (finalizeError) {
        this.logger.error(
          {
            optimizationId,
            err: finalizeError instanceof Error ? finalizeError.message : String(finalizeError),
          },
          'workflow_finalize_after_unhandled_failed',
        );
      }
      throw error;
    }
  }

  private async ensurePromptBaseline(
    optimizationId: string,
    snapshot: WorkflowConfigSnapshot,
  ): Promise<
    { kind: 'ready'; snapshot: WorkflowConfigSnapshot } | { kind: 'fatal'; errorMessage: string } | { kind: 'exit' }
  > {
    if (!isPromptBaselineBootstrapNeeded(snapshot.startingMode)) {
      return { kind: 'ready', snapshot };
    }

    const prepare = await this.preparePromptBaselineStep(optimizationId);
    if (prepare.kind === 'skip') {
      return { kind: 'ready', snapshot };
    }
    if (prepare.kind === 'failed') {
      return { kind: 'fatal', errorMessage: prepare.errorMessage ?? 'baseline_experiment_failed' };
    }
    if (prepare.kind === 'cancelled') {
      await this.finalizeStep(optimizationId, 'cancelled', {
        reason: prepare.errorMessage ?? 'baseline_experiment_cancelled',
      });
      return { kind: 'exit' };
    }
    if (prepare.kind === 'stopped') {
      const state = await this.readStateStep(optimizationId);
      if (state?.controlState === 'resume' && prepare.experimentId) {
        await this.controlChildExperimentStep(snapshot.projectId, prepare.experimentId, 'resume');
        await this.clearResumeStep(optimizationId);
      } else {
        await this.finalizeStep(optimizationId, 'stopped', {
          reason: prepare.errorMessage ?? 'baseline_experiment_stopped',
        });
        return { kind: 'exit' };
      }
    }

    if (prepare.kind === 'launch' && prepare.experimentId) {
      const expWorkflowId = `optimization:${optimizationId}:baseline:exp`;
      try {
        await DBOS.startWorkflow(this.experimentWorkflow.runWorkflow, {
          workflowID: expWorkflowId,
        })(prepare.experimentId);
        await this.recordBaselineWorkflowIdStep(prepare.experimentId, expWorkflowId);
      } catch (error) {
        const message = (error as Error).message;
        this.logger.warn(
          { optimizationId, experimentId: prepare.experimentId, expWorkflowId, error: message },
          'prompt_baseline_experiment_launch_failed',
        );
        await this.markPromptBaselineFailedStep(prepare.experimentId, `launch_failed: ${message}`);
        return { kind: 'fatal', errorMessage: `baseline_launch_failed: ${message}` };
      }
    }

    const experimentId = prepare.experimentId ?? snapshot.sourceExperimentId;
    if (!experimentId) {
      return { kind: 'fatal', errorMessage: 'baseline_experiment_missing' };
    }

    const finalized = await this.finalizePromptBaselineStep(optimizationId, experimentId);
    if (finalized.kind === 'failed') {
      return { kind: 'fatal', errorMessage: finalized.errorMessage ?? 'baseline_experiment_failed' };
    }
    if (finalized.kind === 'stopped') {
      await this.finalizeStep(optimizationId, 'stopped', {
        reason: finalized.errorMessage ?? 'baseline_experiment_stopped',
      });
      return { kind: 'exit' };
    }
    if (finalized.kind === 'cancelled') {
      await this.finalizeStep(optimizationId, 'cancelled', {
        reason: finalized.errorMessage ?? 'baseline_experiment_cancelled',
      });
      return { kind: 'exit' };
    }

    const reloaded = await this.loadConfigStep(optimizationId);
    if (!reloaded.ok) {
      return { kind: 'fatal', errorMessage: reloaded.reason ?? 'baseline_snapshot_reload_failed' };
    }
    return { kind: 'ready', snapshot: reloaded };
  }

  // ---------- step impls ----------

  private async loadConfigImpl(optimizationId: string): Promise<WorkflowConfigSnapshot> {
    const ctx = await this.repo.loadWorkflowContext(optimizationId);
    if (!ctx) {
      return invalidSnapshot('optimization_not_found');
    }
    if (!ctx.promptId) {
      // 所有 starting mode 在 createOptimization 时都已确保 promptId 落库（from_dataset_only 自动建空 prompt）
      return invalidSnapshot('prompt_id_missing_for_starting_mode');
    }
    const isDatasetOnly = ctx.startingMode === 'from_dataset_only';
    // SPEC 25 §2.1: from_dataset_only 允许 baseVersionId 为 null,workflow 的
    // generateFirstVersionStep 会生成首版后回填;其它模式必须已有 baseVersionId。
    if (!isDatasetOnly && !ctx.baseVersionId) {
      return invalidSnapshot('base_version_id_required');
    }
    if (!isDatasetOnly && !['from_experiment', 'from_prompt_version'].includes(ctx.startingMode)) {
      return invalidSnapshot('starting_mode_unsupported_v1');
    }

    const goalsParsed = z.array(optimizationGoalSchema).safeParse(ctx.goals ?? []);
    if (!goalsParsed.success || goalsParsed.data.length === 0) {
      return invalidSnapshot('goals_invalid');
    }
    const fwParsed = optimizationFieldWhitelistSchema.safeParse(ctx.fieldWhitelist ?? {});
    if (!fwParsed.success) {
      return invalidSnapshot('field_whitelist_invalid');
    }

    let strategyConfig: ErrorPatternAnalysisConfig;
    try {
      strategyConfig = errorPatternAnalysisConfigSchema.parse(ctx.strategyConfig ?? {});
    } catch {
      strategyConfig = DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG;
    }

    const analysisModel = await this.loadModelInvocationConfig(ctx.analysisModelId);
    if (!analysisModel) return invalidSnapshot('analysis_model_unavailable');
    const taskModel = await this.loadModelInvocationConfig(ctx.experimentModelId);
    if (!taskModel) return invalidSnapshot('task_model_unavailable');

    const promptLanguage = parsePromptLanguage(ctx.promptLanguage);
    const variables = parseVariables(ctx.baseVersionVariables);
    // SPEC 25 §2.1: from_dataset_only 首版生成前 baseVersionId 为 null,basePromptVersion 也为 null;
    // generateFirstVersionStep 完成后,loadConfigStep 重跑时 ctx.baseVersionId 已回填,这里构造正常 ref。
    const basePromptVersion: PromptVersionRef | null = ctx.baseVersionId
      ? {
          id: ctx.baseVersionId,
          promptId: ctx.promptId,
          versionNumber: ctx.baseVersionNumber ?? 0,
          body: ctx.baseVersionBody ?? '',
          outputSchema: ctx.baseVersionOutputSchema,
          promptLanguage: parsePromptLanguage(ctx.baseVersionPromptLanguage),
          judgmentRules:
            ctx.baseVersionJudgmentRules && typeof ctx.baseVersionJudgmentRules === 'object'
              ? {
                  ruleName: 'default',
                  config: ctx.baseVersionJudgmentRules,
                }
              : undefined,
          // 保留完整 PromptVariableDto（type/required/datasetField）— 否则下游 parseVariables 因
          // promptVariableSchema 缺字段而把每项 safeParse 失败，最终写入的新版本 variables=[]，
          // 实验渲染时 buildInputVariables 拿到空对象，{{text}} 不会被样本值替换而留作字面量。
          variables,
        }
      : null;

    // 已完成轮次 + 当前最佳
    // SPEC 25 §7: nextRound 推导新规则
    //   - success/failed → 视为已完成,进下一轮
    //   - stopped/running → 视为"中断中",本轮 index 不进位 + 携带 resumeChildExpId
    //                       让 runImpl 跳过 startWorkflow 改走 continue-child 分支
    const completedRounds = await this.repo.listRoundExperimentsForOptimization(optimizationId);
    let bestVersion: PromptVersionRef | null = ctx.bestVersionId ? null : basePromptVersion;
    let bestMetrics: MetricSnapshot = this.toMetricSnapshot(ctx.bestMetrics) ?? emptyMetrics();
    let nextRound = 1;
    let resumeChildExpId: string | null = null;
    const sortedRounds = completedRounds.slice().sort((a, b) => a.roundIndex - b.roundIndex);
    for (const round of sortedRounds) {
      if (round.status === 'success' || round.status === 'failed') {
        nextRound = Math.max(nextRound, round.roundIndex + 1);
      } else if (round.status === 'stopped' || round.status === 'running') {
        // 中断中的轮 → 本轮重跑(prepare 走 LLM 复用 + 子实验 ON CONFLICT 不重建);携带子 expId
        nextRound = round.roundIndex;
        resumeChildExpId = round.experimentId;
        break; // 后面的轮(若存在)按设计就不应该已落库 — 防御性 break
      }
      // 其它状态(cancelled / queued / 未来扩展)按"不影响 nextRound"处理
    }
    if (ctx.bestVersionId) {
      const [bestVer] = await this.db
        .select({
          id: schema.promptVersions.id,
          promptId: schema.promptVersions.promptId,
          versionNumber: schema.promptVersions.versionNumber,
          body: schema.promptVersions.body,
          outputSchema: schema.promptVersions.outputSchema,
          promptLanguage: schema.promptVersions.promptLanguage,
          judgmentRules: schema.promptVersions.judgmentRules,
          variables: schema.promptVersions.variables,
        })
        .from(schema.promptVersions)
        .where(eq(schema.promptVersions.id, ctx.bestVersionId))
        .limit(1);
      if (bestVer) {
        bestVersion = {
          id: bestVer.id,
          promptId: bestVer.promptId,
          versionNumber: bestVer.versionNumber,
          body: bestVer.body ?? '',
          outputSchema: bestVer.outputSchema,
          promptLanguage: parsePromptLanguage(bestVer.promptLanguage),
          judgmentRules:
            bestVer.judgmentRules && typeof bestVer.judgmentRules === 'object'
              ? { ruleName: 'default', config: bestVer.judgmentRules }
              : undefined,
          variables: parseVariables(bestVer.variables),
        };
      }
    }
    if (!bestVersion) bestVersion = basePromptVersion;

    // baseline metrics: 从源实验或主表 best_metrics 取
    if (!ctx.bestMetrics && ctx.sourceExperimentId) {
      const [src] = await this.db
        .select({ metrics: experiments.metrics })
        .from(experiments)
        .where(eq(experiments.id, ctx.sourceExperimentId))
        .limit(1);
      const fromSrc = this.toMetricSnapshot(src?.metrics);
      if (fromSrc) bestMetrics = fromSrc;
    }

    const runConfig = (ctx.runConfig as Record<string, unknown> | null) ?? {};
    const optimizationHint = readOptimizationHintFromContext(ctx);

    const childRunConfig = parseChildRunConfigFromOptimization(runConfig);

    const fieldWhitelist: FieldWhitelist = toLoopFieldWhitelist(
      fwParsed.data,
      readExpectedField(ctx.baseVersionJudgmentRules),
    );

    return {
      ok: true,
      projectId: ctx.projectId,
      optimizationName: ctx.name,
      promptId: ctx.promptId,
      baseVersionId: ctx.baseVersionId,
      basePromptVersion,
      datasetId: ctx.datasetId,
      datasetSampleCount: ctx.datasetSampleCount,
      startingMode: ctx.startingMode,
      sourceExperimentId: ctx.sourceExperimentId,
      promptLanguage,
      analysisModel,
      taskModel,
      goals: goalsParsed.data.map(toLoopGoal),
      fieldWhitelist,
      strategy: ctx.strategy,
      strategyConfig,
      maxRounds: ctx.maxRounds,
      optimizationHint,
      createdBy: ctx.createdBy,
      nextRound,
      bestVersion,
      bestMetrics,
      childRunConfig,
      resumeChildExpId,
    };
  }

  private async markStartedImpl(optimizationId: string): Promise<void> {
    await this.repo.markStarted(optimizationId);
  }

  // SPEC 25 §2.1: from_dataset_only 起点的首版生成。
  // 1) 从数据集随机抽 initialSamplingRounds × initialSamplesPerRound 条样本
  // 2) 调 analysisModel 让 LLM 归纳首版 prompt body / variables / outputSchema
  // 3) 用确定性 versionId 写一行 frozen prompt_versions(replay 幂等)
  // 4) 把 versionId 回填到 optimizations.base_version_id
  // 5) 沿用 §12 的 round_steps 记录(round_index=0, step='generate_prompt')
  // 失败时抛带特定 reason 的 Error,runImpl 捕获后映射到 finalize 原因码并 finalize 整个优化为 failed。
  private async generateFirstVersionImpl(optimizationId: string): Promise<void> {
    const ctx = await this.repo.loadWorkflowContext(optimizationId);
    if (!ctx) {
      throw new Error('first_version_generation_failed_v1:context_missing');
    }
    if (ctx.startingMode !== 'from_dataset_only') {
      // 不该走到这里;防御性检查
      throw new Error('first_version_generation_failed_v1:wrong_starting_mode');
    }
    if (ctx.baseVersionId) {
      // 已生成过(replay 路径) — 兜底跳过,避免重复调 LLM
      this.logger.info({ optimizationId }, 'optimization_first_version_already_generated_skip');
      return;
    }
    if (!ctx.promptId) {
      throw new Error('first_version_generation_failed_v1:prompt_id_missing');
    }

    const dbosWorkflowId = DBOS.workflowID ?? null;
    const versionId = deterministicUuid(`${optimizationId}:first-version`);
    const generateRunResultId = deterministicUuid(`${optimizationId}:first-generate`);

    await this.upsertStepSafe({
      optimizationId,
      roundIndex: 0,
      step: 'generate_prompt',
      status: 'running',
      startedAt: new Date(),
      dbosWorkflowId,
    });

    try {
      // 校验 + 解析配置
      const fwParsed = optimizationFieldWhitelistSchema.safeParse(ctx.fieldWhitelist ?? {});
      if (!fwParsed.success) {
        throw new Error('first_version_generation_failed_v1:field_whitelist_invalid');
      }
      const goalsParsed = z.array(optimizationGoalSchema).safeParse(ctx.goals ?? []);
      if (!goalsParsed.success || goalsParsed.data.length === 0) {
        throw new Error('first_version_generation_failed_v1:goals_invalid');
      }
      let strategyConfig: ErrorPatternAnalysisConfig;
      try {
        strategyConfig = errorPatternAnalysisConfigSchema.parse(ctx.strategyConfig ?? {});
      } catch {
        strategyConfig = DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG;
      }
      const analysisModel = await this.loadModelInvocationConfig(ctx.analysisModelId);
      if (!analysisModel) {
        throw new Error('first_version_generation_failed_v1:analysis_model_unavailable');
      }

      // 加载并随机抽样
      const allSamples = await this.repo.loadDatasetSamples(ctx.datasetId);
      const sampleCount = strategyConfig.initialSamplingRounds * strategyConfig.initialSamplesPerRound;
      if (allSamples.length === 0) {
        throw new Error('first_version_dataset_empty_v1');
      }
      const samples =
        allSamples.length <= sampleCount
          ? allSamples
          : pickRandomSamples(allSamples, sampleCount, `${optimizationId}:first-version`);
      if (allSamples.length < sampleCount) {
        this.logger.warn(
          {
            optimizationId,
            requested: sampleCount,
            available: allSamples.length,
          },
          'optimization_first_version_dataset_undersized',
        );
      }

      const fieldWhitelist: FieldWhitelist = toLoopFieldWhitelist(
        fwParsed.data,
        readExpectedField(ctx.baseVersionJudgmentRules),
      );

      // 调 LLM 生成首版
      const promptLanguage = parsePromptLanguage(ctx.promptLanguage);
      const generated = await generateInitialVersion(
        {
          optimizationId,
          analysisModel,
          samples,
          goals: goalsParsed.data.map(toLoopGoal),
          fieldWhitelist,
          description: ctx.description,
          optimizationHint: readOptimizationHintFromContext(ctx),
          promptLanguage,
          strategyConfig,
          runResultMeta: {
            projectId: ctx.projectId,
            sourceId: optimizationId,
            promptVersionId: versionId,
            modelId: analysisModel.id,
            dbosWorkflowId,
            bullmqJobId: null,
            attempt: 0,
          },
          generateRunResultId,
        },
        {
          limiter: this.limiter as RateLimiterLike,
          logger: this.llmLogger,
          runResultWriter: this.runResultWriter,
        },
      );

      // 写入 frozen prompt_versions(确定性 id 让 replay 幂等)
      await this.promptRepo.createOptimizationFrozenVersion({
        versionId,
        promptId: ctx.promptId,
        parentVersionId: null,
        body: generated.newPromptBody,
        variables: generated.variables,
        outputSchema: generated.outputSchema,
        judgmentRules: deriveJudgmentRulesFromOutputSchema(
          generated.outputSchema,
          readExpectedField(ctx.baseVersionJudgmentRules),
        ),
        promptLanguage,
        optimizationId,
        changeReason: 'optimization:first-version',
        createdBy: ctx.createdBy,
      });

      // 回填 base_version_id (带 IS NULL 保护)
      await this.repo.updateBaseVersionId(optimizationId, versionId);

      await this.upsertStepSafe({
        optimizationId,
        roundIndex: 0,
        step: 'generate_prompt',
        status: 'success',
        finishedAt: new Date(),
        runResultId: generateRunResultId,
        dbosWorkflowId,
      });
    } catch (error) {
      const { errorClass, errorMessage } = normalizeErrorForStep(error);
      await this.upsertStepSafe({
        optimizationId,
        roundIndex: 0,
        step: 'generate_prompt',
        status: 'failed',
        finishedAt: new Date(),
        errorClass,
        errorMessage,
        dbosWorkflowId,
      });
      throw error;
    }
  }

  private async preparePromptBaselineImpl(optimizationId: string): Promise<PromptBaselinePrepareOutcome> {
    const snapshot = await this.loadConfigImpl(optimizationId);
    if (!snapshot.ok) {
      return { kind: 'failed', errorMessage: snapshot.reason ?? 'snapshot_invalid' };
    }
    if (!isPromptBaselineBootstrapNeeded(snapshot.startingMode)) {
      return { kind: 'skip' };
    }
    if (!snapshot.baseVersionId || !snapshot.basePromptVersion) {
      return { kind: 'failed', errorMessage: 'base_version_missing' };
    }

    if (snapshot.sourceExperimentId) {
      const existing = await this.repo.findExperimentStatus(snapshot.sourceExperimentId);
      if (!existing) {
        return {
          kind: 'failed',
          errorMessage: `baseline_experiment_not_found:${snapshot.sourceExperimentId}`,
        };
      }
      const status = normalizeBaselineExperimentStatus(existing.status);
      if (status === 'success') {
        return { kind: 'ready', experimentId: existing.id, status };
      }
      if (status === 'failed' || status === 'stopped' || status === 'cancelled') {
        return {
          kind: status,
          experimentId: existing.id,
          status,
          errorMessage: `baseline_experiment_${status}`,
        };
      }
      return { kind: 'wait', experimentId: existing.id, status };
    }

    const experimentId = computeOptimizationBaselineExperimentId(optimizationId);
    await this.repo.freezePromptVersionIfNeeded(snapshot.baseVersionId);
    await this.repo.createPromptBaselineExperimentRow({
      id: experimentId,
      projectId: snapshot.projectId,
      name: await this.buildOptimizationExperimentNameForInsert({
        projectId: snapshot.projectId,
        experimentId,
        optimizationId,
        optimizationName: snapshot.optimizationName,
        round: 'baseline',
      }),
      promptVersionId: snapshot.baseVersionId,
      datasetId: snapshot.datasetId,
      modelId: snapshot.taskModel.id,
      runConfig: snapshot.childRunConfig,
      totalSamples: snapshot.datasetSampleCount,
      createdBy: snapshot.createdBy,
    });
    await this.repo.attachSourceExperimentIfEmpty(optimizationId, experimentId);

    const created = await this.repo.findExperimentStatus(experimentId);
    const status = normalizeBaselineExperimentStatus(created?.status ?? 'running');
    if (status === 'success') {
      return { kind: 'ready', experimentId, status };
    }
    if (status === 'failed' || status === 'stopped' || status === 'cancelled') {
      return {
        kind: status,
        experimentId,
        status,
        errorMessage: `baseline_experiment_${status}`,
      };
    }
    return { kind: 'launch', experimentId, status };
  }

  private async buildOptimizationExperimentNameForInsert(input: {
    projectId: string;
    experimentId: string;
    optimizationId: string;
    optimizationName: string;
    round: 'baseline' | number;
  }): Promise<string> {
    const primaryName = buildOptimizationExperimentName(input.optimizationName, input.round);
    const existing = await this.repo.findActiveExperimentByProjectAndName(input.projectId, primaryName);
    if (!existing || existing.id === input.experimentId) return primaryName;

    return buildOptimizationExperimentName(input.optimizationName, input.round, {
      collisionSalt: `${input.optimizationId}:${input.round}`,
    });
  }

  private async recordBaselineWorkflowIdImpl(experimentId: string, workflowId: string): Promise<void> {
    await this.repo.setExperimentDbosWorkflowId(experimentId, workflowId);
  }

  private async markPromptBaselineFailedImpl(experimentId: string, failureReason: string): Promise<void> {
    await this.repo.markChildExperimentFailed(experimentId, failureReason);
  }

  private async finalizePromptBaselineImpl(
    optimizationId: string,
    experimentId: string,
  ): Promise<PromptBaselineFinalizeOutcome> {
    const snapshot = await this.loadConfigImpl(optimizationId);
    if (!snapshot.ok) {
      return { kind: 'failed', errorMessage: snapshot.reason ?? 'snapshot_invalid' };
    }

    const finalState = await this.waitForExperimentTerminal(experimentId, optimizationId, 0, snapshot.projectId);
    const status = normalizeBaselineExperimentStatus(finalState.status);
    if (status === 'success') {
      return { kind: 'ready' };
    }
    if (status === 'stopped' || status === 'cancelled') {
      return { kind: status, errorMessage: `baseline_experiment_${status}` };
    }
    return { kind: 'failed', errorMessage: 'baseline_experiment_failed' };
  }

  private async readStateImpl(optimizationId: string): Promise<WorkflowControlState> {
    const row = await this.repo.findStatusAndControl(optimizationId);
    if (!row) return null;
    const ctl = row.controlState;
    const normalized: ControlSignal = ctl === 'stop' || ctl === 'cancel' || ctl === 'resume' ? ctl : null;
    return { status: row.status, controlState: normalized };
  }

  private async clearResumeImpl(optimizationId: string): Promise<void> {
    await this.repo.clearResume(optimizationId);
  }

  // SPEC 25 §11.3 跨轮历史聚合 step — 纯读,可被 DBOS step 包装。
  // beforeRoundIndex 锁住"只看 < N 的"已完成轮;best_version_id 漂移会让 history 内容随当时 DB 状态变,
  // 但不影响本轮幂等(runResultId 用 uuidv5 锁住,replay 不会真实再调 LLM)
  private async loadRoundHistoryImpl(
    optimizationId: string,
    beforeRoundIndex: number,
  ): Promise<OptimizationRoundHistoryRow[]> {
    return this.repo.loadRoundHistory(optimizationId, beforeRoundIndex);
  }

  // 把 repository 返回的原始行转换为 strategy 包的 RoundHistoryEntry[]。
  // - metrics 走 toMetricSnapshot 归一化
  // - deltaFromPrev 用 goals[0] 主指标遍历计算(首条 null)
  // - changeSummary / appliedChanges 从 generateParsedOutput 解;旧数据 / 解析失败时取空串 / []
  //   (不抛错,保证 history 不阻塞主路径)
  private buildRoundHistoryEntries(
    rows: OptimizationRoundHistoryRow[],
    goals: OptimizationGoal[],
  ): RoundHistoryEntry[] {
    const primaryGoal = goals[0];
    let prevPrimary: number | null = null;
    return rows.map((row) => {
      const metrics = this.toMetricSnapshot(row.metrics) ?? { overall: {} };
      const currentPrimary = primaryGoal ? readMetric(metrics, primaryGoal) : null;
      const deltaFromPrev = currentPrimary !== null && prevPrimary !== null ? currentPrimary - prevPrimary : null;
      prevPrimary = currentPrimary;

      const parsedGen = (row.generateParsedOutput ?? null) as {
        changeSummary?: unknown;
        appliedChanges?: Array<{
          changeId?: unknown;
          patternIds?: unknown;
          summary?: unknown;
        }>;
        appliedTips?: unknown;
      } | null;
      const changeSummary = typeof parsedGen?.changeSummary === 'string' ? parsedGen.changeSummary : '';
      const rawApplied = Array.isArray(parsedGen?.appliedChanges) ? parsedGen.appliedChanges : [];
      const appliedChanges = rawApplied
        .filter(
          (c): c is { changeId: string; patternIds?: unknown; summary?: unknown } =>
            Boolean(c) && typeof c.changeId === 'string',
        )
        .map((c) => ({
          changeId: c.changeId,
          patternIds: Array.isArray(c.patternIds)
            ? c.patternIds.filter((p): p is string => typeof p === 'string')
            : undefined,
          rationale: typeof c.summary === 'string' ? c.summary : undefined,
        }));
      // 「工具箱轮换提示」依据 — 反聚合 LLM 自报的 appliedTips(SPEC 25 §11.3「工具箱轮换提示」)
      const appliedTips = extractAppliedTipsFromGenerateParsedOutput(parsedGen);

      return {
        roundIndex: row.roundIndex,
        metrics,
        deltaFromPrev,
        changeSummary,
        appliedChanges,
        appliedTips,
        isBest: row.isBest,
        generatedFromBaseVersionId: row.parentVersionId ?? '',
      };
    });
  }

  private async resolveRoundOptimizationContext(
    optimizationId: string,
    roundNumber: number,
    snapshot: WorkflowConfigSnapshot,
  ): Promise<RoundOptimizationContext | { errorMessage: string }> {
    const regressionRetry = await this.resolveRegressionRetryContext(optimizationId, roundNumber, snapshot);
    if (regressionRetry) return regressionRetry;

    const generationBaseVersion = snapshot.bestVersion ?? snapshot.basePromptVersion;
    if (!generationBaseVersion) return { errorMessage: 'base_version_missing' };

    const analysisExperiment = await this.repo.findAnalysisExperimentForPromptVersion({
      optimizationId,
      sourceExperimentId: snapshot.sourceExperimentId,
      promptVersionId: generationBaseVersion.id,
    });
    if (!analysisExperiment) {
      return {
        errorMessage: `analysis_experiment_missing_for_prompt_version:${generationBaseVersion.id}`,
      };
    }
    const previousExperiment = await this.repo.findPreviousComparableExperiment({
      optimizationId,
      sourceExperimentId: snapshot.sourceExperimentId,
      currentRoundIndex: analysisExperiment.roundIndex,
    });
    const previousVersion = previousExperiment
      ? await this.loadPromptVersionRef(previousExperiment.promptVersionId)
      : null;

    return {
      generationBaseVersion,
      analysisVersion: generationBaseVersion,
      analysisExperiment,
      previousExperiment,
      previousVersion,
      regressionRetry: false,
    };
  }

  // SPEC 25 §5 / §11.5:若刚完成的上一轮比其父 prompt 对应实验更差,
  // 本轮不继续在坏 prompt 上叠改。Analyze 看坏 prompt + 坏样本归因,
  // Generate 回退到父 prompt 上重新改进。
  private async resolveRegressionRetryContext(
    optimizationId: string,
    roundNumber: number,
    snapshot: WorkflowConfigSnapshot,
  ): Promise<RoundOptimizationContext | null> {
    if (roundNumber <= 1) return null;

    const previousRound = await this.repo.findExperimentByRound(optimizationId, roundNumber - 1);
    if (!previousRound || previousRound.status !== 'success' || !previousRound.parentVersionId) {
      return null;
    }

    const regressedMetrics = this.toMetricSnapshot(previousRound.metrics);
    if (!regressedMetrics) return null;

    const baseExperiment = await this.repo.findAnalysisExperimentForPromptVersion({
      optimizationId,
      sourceExperimentId: snapshot.sourceExperimentId,
      promptVersionId: previousRound.parentVersionId,
    });
    if (!baseExperiment) return null;

    const baseMetrics = this.toMetricSnapshot(baseExperiment.metrics);
    if (!baseMetrics || !isBetterThan(baseMetrics, regressedMetrics, snapshot.goals)) {
      return null;
    }

    const baseVersion = await this.loadPromptVersionRef(previousRound.parentVersionId);
    const regressedVersion = await this.loadPromptVersionRef(previousRound.promptVersionId);
    if (!baseVersion || !regressedVersion) return null;

    this.logger.info(
      {
        optimizationId,
        roundNumber,
        regressedRound: previousRound.roundIndex,
        regressedVersionId: regressedVersion.id,
        generationBaseVersionId: baseVersion.id,
      },
      'optimization_round_regression_retry_context',
    );

    return {
      generationBaseVersion: baseVersion,
      analysisVersion: regressedVersion,
      analysisExperiment: {
        id: previousRound.id,
        roundIndex: previousRound.roundIndex,
        metrics: previousRound.metrics,
        promptVersionId: previousRound.promptVersionId,
      },
      previousExperiment: baseExperiment,
      previousVersion: baseVersion,
      regressionRetry: true,
    };
  }

  private async prepareRoundImpl(optimizationId: string, roundNumber: number): Promise<PrepareOutcome> {
    const snapshot = await this.loadConfigImpl(optimizationId);
    if (!snapshot.ok) {
      return { kind: 'fatal', errorMessage: snapshot.reason ?? 'snapshot_invalid' };
    }

    // 加载 dataset samples + 本轮优化上下文（供 strategy 包消费）
    const samplesRaw = await this.repo.loadDatasetSamples(snapshot.datasetId);
    if (samplesRaw.length === 0) {
      return { kind: 'fatal', errorMessage: 'dataset_empty' };
    }

    const roundContext = await this.resolveRoundOptimizationContext(optimizationId, roundNumber, snapshot);
    if ('errorMessage' in roundContext) {
      return {
        kind: 'fatal',
        errorMessage: roundContext.errorMessage,
        analysisFailure: true,
      };
    }
    const {
      generationBaseVersion: baseVersionForRound,
      analysisVersion,
      analysisExperiment,
      previousExperiment,
      previousVersion,
    } = roundContext;

    // SPEC 25 §11.4.1: prepareRoundImpl 内 step 状态 / 复用所需 metadata
    const dbosWorkflowIdForSteps = DBOS.workflowID ?? null;

    // 与 experiment 通道一致地从 judgmentRules 解析 expected 字段名,保证两个通道读到同一个 expected
    const samples: SampleRecord[] = buildSamplesForStrategy(samplesRaw, baseVersionForRound.judgmentRules?.config);

    const rawCurrent = await this.repo.loadRunResultsByExperiment(analysisExperiment.id);
    const rawPrevious = previousExperiment ? await this.repo.loadRunResultsByExperiment(previousExperiment.id) : null;
    const currentRunResults = mapRunResultsForStrategy(rawCurrent);
    const previousRunResults = rawPrevious ? mapRunResultsForStrategy(rawPrevious) : null;
    const analysisMetrics = this.toMetricSnapshot(analysisExperiment.metrics) ?? snapshot.bestMetrics;

    // SPEC 25 §11.3 跨轮历史 — 注入到 analyze / generate 两步 LLM 调用,让 LLM 跨轮避免重复无效改动。
    // 首轮(roundNumber=1) → 空数组 → strategy 包不渲染历史段(向后兼容)。
    const roundHistoryRows = await this.loadRoundHistoryStep(optimizationId, roundNumber);
    const roundHistory = this.buildRoundHistoryEntries(roundHistoryRows, snapshot.goals);

    // SPEC 25 §11.3「工具箱轮换提示」— 连续 ≥2 轮 !isBest 时构造 hint 注入到 generate user prompt。
    // streak < 2 → undefined,strategy 包不渲染该段。
    const noBestStreak = computeNoBestStreak(roundHistory);
    const toolboxSwitchHint = (() => {
      if (noBestStreak < 2) return undefined;
      const recentEntries = roundHistory.slice(-2);
      const usedSet = new Set<string>();
      for (const entry of recentEntries) {
        for (const tip of entry.appliedTips) {
          const trimmed = tip.trim();
          if (trimmed.length > 0) usedSet.add(trimmed);
        }
      }
      return {
        recentlyUsedTips: Array.from(usedSet),
        allTipNames: getOptimizationTipNames(snapshot.promptLanguage),
      };
    })();
    if (toolboxSwitchHint) {
      this.logger.info(
        {
          optimizationId,
          roundNumber,
          streak: noBestStreak,
          recentlyUsedTips: toolboxSwitchHint.recentlyUsedTips,
        },
        'optimization_toolbox_switch_triggered',
      );
    }

    // 确定性 UUID(uuidv5):replay 时同 id 命中 INSERT WHERE NOT EXISTS,
    // 不会写重复行(SPEC 25 §11.2)
    const analysisRunResultId = deterministicUuid(`${optimizationId}:${roundNumber}:analysis`);
    const generateRunResultId = deterministicUuid(`${optimizationId}:${roundNumber}:generate`);
    const versionId = deterministicUuid(`${optimizationId}:${roundNumber}:version`);
    const experimentId = deterministicUuid(`${optimizationId}:${roundNumber}:experiment`);

    // step 内拿当前 workflow id 串联日志与 run_results.dbos_workflow_id(SPEC 05 §5.6)
    const dbosWorkflowId = DBOS.workflowID ?? null;
    const analysisRunResultMeta = {
      projectId: snapshot.projectId,
      sourceId: optimizationId,
      promptVersionId: analysisVersion.id,
      modelId: snapshot.analysisModel.id,
      dbosWorkflowId,
      bullmqJobId: null,
      attempt: 0,
    };
    const generateRunResultMeta = {
      projectId: snapshot.projectId,
      sourceId: optimizationId,
      promptVersionId: baseVersionForRound.id,
      modelId: snapshot.analysisModel.id,
      dbosWorkflowId,
      bullmqJobId: null,
      attempt: 0,
    };

    // SPEC 25 §11.4.1: 复用已 success 的分析 run_result,跳过 LLM 调用避免重复扣 token
    let analysisFull: AnalyzeFailuresResult;
    const existingAnalysis = await this.peekOptimizationRunResultStep(
      optimizationId,
      roundNumber,
      'optimization_analysis',
    );
    if (existingAnalysis) {
      analysisFull = reconstructAnalysisFromRunResult(existingAnalysis);
      this.logger.info(
        { optimizationId, roundNumber, source: 'optimization_analysis' },
        'optimization_reuse_run_result',
      );
      await this.upsertStepSafe({
        optimizationId,
        roundIndex: roundNumber,
        step: 'error_analysis',
        status: 'success',
        finishedAt: new Date(),
        runResultId: analysisRunResultId,
        dbosWorkflowId: dbosWorkflowIdForSteps,
      });
    } else {
      await this.upsertStepSafe({
        optimizationId,
        roundIndex: roundNumber,
        step: 'error_analysis',
        status: 'running',
        startedAt: new Date(),
        dbosWorkflowId: dbosWorkflowIdForSteps,
      });
      try {
        analysisFull = await analyzeFailures(
          {
            optimizationId,
            roundNumber,
            analysisModel: snapshot.analysisModel,
            currentVersion: analysisVersion,
            previousVersion,
            samples,
            currentRunResults,
            previousRunResults,
            metrics: analysisMetrics,
            goals: snapshot.goals,
            fieldWhitelist: snapshot.fieldWhitelist,
            strategyConfig: snapshot.strategyConfig,
            promptLanguage: snapshot.promptLanguage,
            roundHistory,
            runResultMeta: analysisRunResultMeta,
            analysisRunResultId,
          },
          {
            limiter: this.limiter as RateLimiterLike,
            logger: this.llmLogger,
            runResultWriter: this.runResultWriter,
          },
        );
        await this.upsertStepSafe({
          optimizationId,
          roundIndex: roundNumber,
          step: 'error_analysis',
          status: 'success',
          finishedAt: new Date(),
          runResultId: analysisRunResultId,
          dbosWorkflowId: dbosWorkflowIdForSteps,
        });
      } catch (error) {
        const message = error instanceof RateLimitExceededError ? 'rate_limited' : (error as Error).message;
        const { errorClass, errorMessage } = normalizeErrorForStep(error);
        await this.upsertStepSafe({
          optimizationId,
          roundIndex: roundNumber,
          step: 'error_analysis',
          status: 'failed',
          finishedAt: new Date(),
          errorClass,
          errorMessage,
          dbosWorkflowId: dbosWorkflowIdForSteps,
        });
        return {
          kind: 'fatal',
          errorMessage: `analysis_failed: ${message}`,
          analysisFailure: true,
        };
      }
    }

    // ---- 生成 LLM (SPEC 25 §11.4.1: 同复用机制) ----
    let generated: {
      newPromptBody: string;
      changeSummary: string;
      newOutputSchema?: unknown;
      outputSchemaChangeReason?: string;
      // SPEC 25 §11: LLM 多次未保留 base 已用占位时,generate 在 newPromptBody 末尾自动补回缺失占位
      // 并标 autoPatched=true。workflow 据此拼 changeReason tag 让前端 chip 提醒用户人工微调。
      autoPatched?: boolean;
      patchedVariables?: string[];
    };
    const existingGenerate = await this.peekOptimizationRunResultStep(
      optimizationId,
      roundNumber,
      'optimization_generate',
    );
    if (existingGenerate) {
      generated = reconstructGenerateFromRunResult(existingGenerate, baseVersionForRound.body);
      this.logger.info(
        { optimizationId, roundNumber, source: 'optimization_generate' },
        'optimization_reuse_run_result',
      );
      await this.upsertStepSafe({
        optimizationId,
        roundIndex: roundNumber,
        step: 'generate_prompt',
        status: 'success',
        finishedAt: new Date(),
        runResultId: generateRunResultId,
        dbosWorkflowId: dbosWorkflowIdForSteps,
      });
    } else {
      await this.upsertStepSafe({
        optimizationId,
        roundIndex: roundNumber,
        step: 'generate_prompt',
        status: 'running',
        startedAt: new Date(),
        dbosWorkflowId: dbosWorkflowIdForSteps,
      });
      try {
        const draft = await generateNextVersion(
          {
            optimizationId,
            roundNumber,
            analysisModel: snapshot.analysisModel,
            currentVersion: baseVersionForRound,
            analysis: analysisFull,
            metrics: analysisMetrics,
            goals: snapshot.goals,
            fieldWhitelist: snapshot.fieldWhitelist,
            optimizationHint: snapshot.optimizationHint,
            strategyConfig: snapshot.strategyConfig,
            promptLanguage: snapshot.promptLanguage,
            roundHistory,
            toolboxSwitchHint,
            runResultMeta: generateRunResultMeta,
            generateRunResultId,
          },
          {
            limiter: this.limiter as RateLimiterLike,
            logger: this.llmLogger,
            runResultWriter: this.runResultWriter,
          },
        );
        generated = {
          newPromptBody: draft.newPromptBody,
          changeSummary: draft.changeSummary,
          newOutputSchema: draft.newOutputSchema,
          outputSchemaChangeReason: draft.outputSchemaChangeReason,
          autoPatched: draft.autoPatched,
          patchedVariables: draft.patchedVariables,
        };
        if (draft.autoPatched) {
          this.logger.warn(
            {
              optimizationId,
              roundNumber,
              patchedVariables: draft.patchedVariables,
              retries: draft.retries,
            },
            'optimization_generate_auto_patched_round',
          );
        } else if (draft.retries > 0) {
          this.logger.info(
            { optimizationId, roundNumber, retries: draft.retries },
            'optimization_generate_succeeded_after_retry',
          );
        }
        await this.upsertStepSafe({
          optimizationId,
          roundIndex: roundNumber,
          step: 'generate_prompt',
          status: 'success',
          finishedAt: new Date(),
          runResultId: generateRunResultId,
          dbosWorkflowId: dbosWorkflowIdForSteps,
        });
      } catch (error) {
        const message = error instanceof RateLimitExceededError ? 'rate_limited' : (error as Error).message;
        const { errorClass, errorMessage } = normalizeErrorForStep(error);
        await this.upsertStepSafe({
          optimizationId,
          roundIndex: roundNumber,
          step: 'generate_prompt',
          status: 'failed',
          finishedAt: new Date(),
          errorClass,
          errorMessage,
          dbosWorkflowId: dbosWorkflowIdForSteps,
        });
        return {
          kind: 'fatal',
          errorMessage: `generate_failed: ${message}`,
          analysisFailure: true,
        };
      }
    }

    // ---- 写新版本（幂等：确定性 versionId + ON CONFLICT DO NOTHING）----
    if (!snapshot.promptId) {
      return { kind: 'fatal', errorMessage: 'prompt_id_missing' };
    }
    const variables: PromptVariableDto[] = parseVariables(baseVersionForRound.variables);
    // LLM 提供且通过 safeValidateNewOutputSchema 校验的 newOutputSchema 优先;否则沿用基线 schema。
    const outputSchemaForVersion = (generated.newOutputSchema ??
      baseVersionForRound.outputSchema ??
      null) as PromptOutputSchemaDto;
    const judgmentRulesForVersion = (
      baseVersionForRound.judgmentRules &&
      typeof baseVersionForRound.judgmentRules === 'object' &&
      'config' in baseVersionForRound.judgmentRules
        ? (baseVersionForRound.judgmentRules as { config: unknown }).config
        : null
    ) as PromptJudgmentRulesDto;

    const baseChangeReason = generated.outputSchemaChangeReason
      ? `${generated.changeSummary}\n\n[output schema 变更] ${generated.outputSchemaChangeReason}`
      : generated.changeSummary;
    // SPEC 25 §11: autoPatched=true 时把补丁 tag 拼到 changeReason 末尾,前端轮次卡片据此渲染"系统补丁" chip
    const changeReason =
      generated.autoPatched && generated.patchedVariables && generated.patchedVariables.length > 0
        ? `${baseChangeReason}\n\n[系统自动补丁] 补回占位：${generated.patchedVariables.join(', ')}`
        : baseChangeReason;

    await this.promptRepo.createOptimizationFrozenVersion({
      versionId,
      promptId: snapshot.promptId,
      parentVersionId: baseVersionForRound.id,
      body: generated.newPromptBody,
      variables,
      outputSchema: outputSchemaForVersion,
      judgmentRules: judgmentRulesForVersion,
      promptLanguage: snapshot.promptLanguage,
      optimizationId,
      changeReason,
      createdBy: snapshot.createdBy,
    });

    // ---- 创建子实验（幂等：确定性 experimentId + ON CONFLICT DO NOTHING + partial unique）----
    await this.repo.createChildExperimentRow({
      id: experimentId,
      projectId: snapshot.projectId,
      name: await this.buildOptimizationExperimentNameForInsert({
        projectId: snapshot.projectId,
        experimentId,
        optimizationId,
        optimizationName: snapshot.optimizationName,
        round: roundNumber,
      }),
      promptVersionId: versionId,
      datasetId: snapshot.datasetId,
      modelId: snapshot.taskModel.id,
      optimizationId,
      roundIndex: roundNumber,
      runConfig: snapshot.childRunConfig,
      totalSamples: samples.length,
      createdBy: snapshot.createdBy,
    });

    // experiment 步进入 running:此时详情页 stepper 第三个圆点开始转,
    // 真实终态由 finalizeRoundImpl(等子实验跑完)写入。
    await this.upsertStepSafe({
      optimizationId,
      roundIndex: roundNumber,
      step: 'experiment',
      status: 'running',
      startedAt: new Date(),
      experimentId,
      dbosWorkflowId: dbosWorkflowIdForSteps,
    });

    // 启动子 ExperimentWorkflow + 等待 + 比较指标改由 runImpl(workflow)层与
    // finalizeRoundImpl(step)分担:DBOS 禁止 step 内调 startWorkflow。
    return { kind: 'launch', experimentId };
  }

  // 包 try-catch:upsertRoundStep 失败不应阻塞 workflow 主路径(round_steps 表只是
  // 给详情页 UX 增强,缺数据时前端走 fallback 仍然能展示)。失败原因走 warn 日志。
  private async upsertStepSafe(input: RoundStepUpsertInput): Promise<void> {
    try {
      await this.repo.upsertRoundStep(input);
    } catch (err) {
      this.logger.warn(
        {
          optimizationId: input.optimizationId,
          roundIndex: input.roundIndex,
          step: input.step,
          status: input.status,
          err: (err as Error)?.message,
        },
        'optimization_round_step_upsert_failed',
      );
    }
  }

  private async finalizeRoundImpl(
    optimizationId: string,
    roundNumber: number,
    experimentId: string,
  ): Promise<RoundOutcome> {
    // step 内重新载入 snapshot:apiKey 等敏感字段不进 DBOS 系统表,故不跨 step 传 snapshot
    const snapshot = await this.loadConfigImpl(optimizationId);
    if (!snapshot.ok) {
      this.logger.warn(
        { optimizationId, roundNumber, reason: snapshot.reason },
        'optimization_finalize_round_snapshot_invalid',
      );
      return { kind: 'continue', metrics: undefined, isBest: false };
    }

    const versionId = deterministicUuid(`${optimizationId}:${roundNumber}:version`);

    // ---- 等待子实验跑完(每轮内自带 poll,replay 时 polling 也是幂等的)----
    // SPEC 25 §7 双路径:poll 内同时读父 control_state,看到 stop/cancel 联动停子实验后继续 poll 到 terminal
    const finalState = await this.waitForExperimentTerminal(
      experimentId,
      optimizationId,
      roundNumber,
      snapshot.projectId,
    );
    const dbosWfId = DBOS.workflowID ?? null;
    if (finalState.status === 'cancelled' || finalState.status === 'stopped') {
      // 父 workflow 在下个 step 边界感知 control_state;这里把本轮当作 continue 跳过
      await this.upsertStepSafe({
        optimizationId,
        roundIndex: roundNumber,
        step: 'experiment',
        status: 'skipped',
        finishedAt: new Date(),
        experimentId,
        dbosWorkflowId: dbosWfId,
      });
      return { kind: 'continue', metrics: undefined, isBest: false };
    }
    if (finalState.status === 'failed') {
      // 单轮失败但不致命,继续下一轮(不阻断整个优化);fatal 仅当 analysis/generate 致命错时
      await this.upsertStepSafe({
        optimizationId,
        roundIndex: roundNumber,
        step: 'experiment',
        status: 'failed',
        finishedAt: new Date(),
        errorMessage: 'experiment_failed',
        experimentId,
        dbosWorkflowId: dbosWfId,
      });
      return { kind: 'continue', metrics: undefined, isBest: false };
    }

    const roundMetrics = this.toMetricSnapshot(finalState.metrics) ?? emptyMetrics();
    const decision = decideRoundOutcome({
      roundMetrics,
      bestMetrics: snapshot.bestMetrics,
      goals: snapshot.goals,
    });

    if (decision.isBest) {
      await this.repo.updateBest(optimizationId, versionId, roundMetrics.overall);
    }
    await this.repo.updateCurrentRound(optimizationId, roundNumber);
    await this.upsertStepSafe({
      optimizationId,
      roundIndex: roundNumber,
      step: 'experiment',
      status: 'success',
      finishedAt: new Date(),
      experimentId,
      dbosWorkflowId: dbosWfId,
    });

    if (decision.goalsMet) {
      return { kind: 'goals_met', metrics: roundMetrics, isBest: decision.isBest };
    }
    return { kind: 'continue', metrics: roundMetrics, isBest: decision.isBest };
  }

  private async markChildLaunchFailedImpl(
    experimentId: string,
    message: string,
    optimizationId: string,
    roundNumber: number,
  ): Promise<void> {
    await this.repo.markChildExperimentFailed(experimentId, `launch_failed: ${message}`);
    await this.upsertStepSafe({
      optimizationId,
      roundIndex: roundNumber,
      step: 'experiment',
      status: 'failed',
      finishedAt: new Date(),
      errorClass: 'LaunchFailed',
      errorMessage: `launch_failed: ${message.slice(0, 1000)}`,
      experimentId,
      dbosWorkflowId: DBOS.workflowID ?? null,
    });
  }

  private async finalizeImpl(
    optimizationId: string,
    kind: FinalizeKind,
    options: { reason?: string; analysisFailureReason?: string },
  ): Promise<void> {
    const updated = await this.repo.finalize(optimizationId, kind, {
      summary: options.reason ? { kind, reason: options.reason, finalizedAt: new Date().toISOString() } : undefined,
      analysisFailureReason: options.analysisFailureReason ?? null,
    });
    if (!updated) {
      // service 已经抢占式终态化(stop/cancel 直接写 status),workflow 自己的 finalize 被守卫拦下。
      // 走到这里说明 workflow 已经做完了自己该做的清理,不必再覆盖 status。
      this.logger.debug(
        { optimizationId, kind, reason: options.reason },
        'optimization_finalize_no_op_already_terminal',
      );
      return;
    }
    this.logger.info({ optimizationId, kind, reason: options.reason }, 'optimization_finalized');
  }

  // SPEC 25 §11.4.1: 查本轮 LLM 结果是否已 success 落库,命中则跳过 LLM 调用
  // 严格过滤 status='success';非 success 行(rate_limited/timeout/error)不复用,正常重调
  private async peekOptimizationRunResultImpl(
    optimizationId: string,
    roundNumber: number,
    source: 'optimization_analysis' | 'optimization_generate',
  ): Promise<{ parsedOutput: unknown; rawResponse: string | null } | null> {
    const row = await this.repo.findExistingOptimizationRunResult(optimizationId, roundNumber, source, {
      statusFilter: 'success',
    });
    if (!row) return null;
    return { parsedOutput: row.parsedOutput, rawResponse: row.rawResponse };
  }

  // SPEC 25 §7 双路径联动:父 stop/cancel 时调子实验 controlExperiment,父 resume 也走此 step
  // 子实验已终态(success/failed/cancelled/stopped)或行不存在 → Conflict/NotFound 吞掉
  // 其它错误 throw,让 DBOS step 重试 (poll 兜底保证最终一致)
  private async controlChildExperimentImpl(
    projectId: string,
    experimentId: string,
    action: ChildExperimentAction,
  ): Promise<{ ok: boolean; reason?: string }> {
    try {
      await this.experimentService.controlExperiment(
        projectId,
        experimentId,
        action,
        SYSTEM_ACTOR_OPTIMIZATION,
        'system',
      );
      return { ok: true };
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        this.logger.warn(
          { projectId, experimentId, action, err: (error as Error).message },
          'optimization_child_control_skipped',
        );
        return { ok: true, reason: 'already_terminal_or_invalid' };
      }
      throw error;
    }
  }

  // SPEC 25 §7 恢复粒度:resume 进入断点轮时查子实验当前状态决定动作
  // 返回 null 表示 experiments 行不存在(应当极少;一般是被外部硬删了)
  private async queryChildExperimentStatusImpl(
    experimentId: string,
  ): Promise<{ status: string; controlState: string | null } | null> {
    const rows = await this.db
      .select({ status: experiments.status, controlState: experiments.controlState })
      .from(experiments)
      .where(eq(experiments.id, experimentId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { status: row.status, controlState: row.controlState };
  }

  // ---------- helpers ----------

  private async loadModelInvocationConfig(modelId: string): Promise<ModelInvocationConfig | null> {
    const [row] = await this.db.select().from(models).where(eq(models.id, modelId)).limit(1);
    if (!row || !row.isActive || row.deletedAt) return null;
    return {
      id: row.id,
      providerType: row.providerType,
      providerModelId: row.providerModelId,
      endpoint: row.endpoint,
      apiKey: this.crypto.decryptApiKey(row.apiKeyEncrypted),
      capabilities: toModelInvocationCapabilities(row.capabilities),
      rpmLimit: row.rpmLimit,
      tpmLimit: row.tpmLimit,
      concurrencyLimit: row.concurrencyLimit,
      inputTokenPricePerMillion: row.inputTokenPricePerMillion,
      outputTokenPricePerMillion: row.outputTokenPricePerMillion,
      extraBody: toExtraBody(row.extraBody),
    };
  }

  private async loadPromptVersionRef(versionId: string): Promise<PromptVersionRef | null> {
    const [row] = await this.db
      .select({
        id: schema.promptVersions.id,
        promptId: schema.promptVersions.promptId,
        versionNumber: schema.promptVersions.versionNumber,
        body: schema.promptVersions.body,
        outputSchema: schema.promptVersions.outputSchema,
        promptLanguage: schema.promptVersions.promptLanguage,
        judgmentRules: schema.promptVersions.judgmentRules,
        variables: schema.promptVersions.variables,
      })
      .from(schema.promptVersions)
      .where(eq(schema.promptVersions.id, versionId))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      promptId: row.promptId,
      versionNumber: row.versionNumber,
      body: row.body ?? '',
      outputSchema: row.outputSchema,
      promptLanguage: parsePromptLanguage(row.promptLanguage),
      judgmentRules:
        row.judgmentRules && typeof row.judgmentRules === 'object'
          ? { ruleName: 'default', config: row.judgmentRules }
          : undefined,
      variables: parseVariables(row.variables),
    };
  }

  private async waitForExperimentTerminal(
    experimentId: string,
    optimizationId: string,
    roundNumber: number,
    projectId: string,
  ): Promise<{ status: string; metrics: unknown }> {
    const start = Date.now();
    let pollIndex = 0;
    let parentControlLinked = false; // 防止同一次 stop/cancel 信号重复调 service(实验已 controlState 后 service 会抛 Conflict,虽然吞掉但日志噪音大)
    while (Date.now() - start < POLL_TIMEOUT_SEC * 1000) {
      const [exp] = await this.db
        .select({ status: experiments.status, metrics: experiments.metrics })
        .from(experiments)
        .where(eq(experiments.id, experimentId))
        .limit(1);
      if (!exp) {
        return { status: 'failed', metrics: null };
      }
      if (
        exp.status === 'success' ||
        exp.status === 'failed' ||
        exp.status === 'stopped' ||
        exp.status === 'cancelled'
      ) {
        return { status: exp.status, metrics: exp.metrics };
      }

      // SPEC 25 §7 双路径联动:poll 内读父 status + control_state。
      //   - 父 controlState 为 stop/cancel 时联动子实验 controlExperiment(冗余兜底:
      //     service.tryLinkChildExperimentControl 已先调过,这里覆盖 service 失败的边角)。
      //   - 父 status 已不是 running(service 抢占式终态化) → 立即结束 poll,把子实验当作 stopped
      //     返回(让 finalizeRoundImpl 走 continue 分支,主循环顶部读到父 status 后直接退出)。
      const parent = await this.repo.findStatusAndControl(optimizationId);
      const parentControl = parent?.controlState ?? null;
      if (!parentControlLinked && (parentControl === 'stop' || parentControl === 'cancel')) {
        const action: ChildExperimentAction = parentControl;
        await this.controlChildExperimentStep(projectId, experimentId, action);
        parentControlLinked = true;
        this.logger.info(
          { optimizationId, roundNumber, experimentId, action, parentStatus: parent?.status },
          'optimization_child_control_linked_from_poll',
        );
      }
      if (parent && parent.status !== 'running') {
        this.logger.info(
          {
            optimizationId,
            roundNumber,
            experimentId,
            parentStatus: parent.status,
            expStatus: exp.status,
          },
          'optimization_round_wait_parent_terminal_exit',
        );
        return { status: 'stopped', metrics: exp.metrics };
      }

      const sleepSec = POLL_SLEEP_SCHEDULE_SEC[Math.min(pollIndex, POLL_SLEEP_SCHEDULE_SEC.length - 1)] ?? 10;
      pollIndex += 1;
      await DBOS.sleepSeconds(sleepSec);
      this.logger.debug(
        { optimizationId, roundNumber, experimentId, pollIndex, status: exp.status, parentControlLinked },
        'optimization_round_wait_tick',
      );
    }
    return { status: 'failed', metrics: null };
  }

  private toMetricSnapshot(value: unknown): MetricSnapshot | null {
    if (!value || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    const overall: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number' && Number.isFinite(v)) overall[k] = v;
      else if (k === 'per_class' && v && typeof v === 'object') {
        // handled below
      }
    }
    const perClassRaw = obj['per_class'];
    let perClass: Record<string, Record<string, number>> | undefined;
    if (perClassRaw && typeof perClassRaw === 'object') {
      perClass = {};
      for (const [cls, metrics] of Object.entries(perClassRaw as Record<string, unknown>)) {
        if (!metrics || typeof metrics !== 'object') continue;
        const inner: Record<string, number> = {};
        for (const [mk, mv] of Object.entries(metrics as Record<string, unknown>)) {
          if (typeof mv === 'number' && Number.isFinite(mv)) inner[mk] = mv;
        }
        perClass[cls] = inner;
      }
    }
    return { overall, perClass };
  }

  private extractAnalysisText(parsedOutput: unknown, rawResponse: string | null): string {
    if (parsedOutput && typeof parsedOutput === 'object') {
      const obj = parsedOutput as Record<string, unknown>;
      if (typeof obj['errorAnalysisText'] === 'string') return obj['errorAnalysisText'] as string;
      if (typeof obj['summary'] === 'string') return obj['summary'] as string;
    }
    if (typeof rawResponse === 'string' && rawResponse.length > 0) return rawResponse;
    return '';
  }

  private extractGeneratedDraft(
    parsedOutput: unknown,
    rawResponse: string | null,
    fallbackBody: string,
  ): { newPromptBody: string; changeSummary: string } {
    if (parsedOutput && typeof parsedOutput === 'object') {
      const obj = parsedOutput as Record<string, unknown>;
      const body = typeof obj['newPromptBody'] === 'string' ? (obj['newPromptBody'] as string) : null;
      const summary = typeof obj['changeSummary'] === 'string' ? (obj['changeSummary'] as string) : '';
      if (body) return { newPromptBody: body, changeSummary: summary };
    }
    if (typeof rawResponse === 'string' && rawResponse.length > 0) {
      return { newPromptBody: rawResponse, changeSummary: '' };
    }
    return { newPromptBody: fallbackBody, changeSummary: 'restored_from_failed_replay' };
  }
}

// ---------- module-level helpers ----------

function mapRunResultsForStrategy(rows: OptimizationRunResultRow[]): RunResultRecord[] {
  return rows.map((r) => ({
    id: r.id,
    sampleId: r.sampleId ?? '',
    parsedOutput: r.parsedOutput,
    decisionOutput: r.decisionOutput,
    isCorrect: r.isCorrect,
    errorMessage: r.errorMessage,
    rawResponse: r.rawResponse,
  }));
}

// SPEC 25 §11.4.1: 从 run_results.parsed_output 重建 strategy 包 analyzeFailures 的返回结构,
// 让 prepareRoundImpl 在 LLM 已有 success 结果时跳过实际调用。
// 注意:复用路径下 batches/confusionPairs/regressionGroups 给空值——下游 generateNextVersion 只读
// errorAnalysisText,不读这些字段;详情页直接读 run_results.parsed_output 也不依赖 workflow 内存。
export function reconstructAnalysisFromRunResult(row: {
  parsedOutput: unknown;
  rawResponse: string | null;
}): AnalyzeFailuresResult {
  const parsed = isObject(row.parsedOutput) ? (row.parsedOutput as Record<string, unknown>) : null;
  const summaryText = readSummaryText(parsed, row.rawResponse);
  const errorPatterns =
    parsed && Array.isArray(parsed['errorPatterns'])
      ? (parsed['errorPatterns'] as SummarizeOutput['errorPatterns'])
      : [];
  const suggestedChanges =
    parsed && Array.isArray(parsed['suggestedChanges'])
      ? (parsed['suggestedChanges'] as SummarizeOutput['suggestedChanges'])
      : [];
  const conflicts =
    parsed && Array.isArray(parsed['conflicts'])
      ? (parsed['conflicts'] as NonNullable<SummarizeOutput['conflicts']>)
      : [];
  const summary: SummarizeOutput = {
    summary: summaryText,
    errorPatterns,
    suggestedChanges,
    conflicts,
    evidenceBundleVersion: 1,
    truncated: false,
    rawContent: row.rawResponse ?? '',
  };
  const fallbackBundle: AnalysisEvidenceBundle = {
    evidenceBundleVersion: 1,
    summary: summaryText,
    errorPatterns,
    suggestedChanges,
    conflicts,
    sourceStats: {
      batchCount: 0,
      totalConfusionFailures: 0,
      totalRegressionSamples: 0,
      truncated: false,
    },
  };
  const evidenceBundle =
    parsed && isObject(parsed['evidenceBundle'])
      ? ({ ...fallbackBundle, ...(parsed['evidenceBundle'] as Record<string, unknown>) } as AnalysisEvidenceBundle)
      : fallbackBundle;
  return {
    errorAnalysisText: summaryText,
    summary,
    evidenceBundle,
    batches: [],
    confusionPairs: [],
    regressionGroups: [],
    truncated: evidenceBundle.sourceStats?.truncated ?? false,
    totalConfusionFailures: evidenceBundle.sourceStats?.totalConfusionFailures ?? 0,
    totalRegressionSamples: evidenceBundle.sourceStats?.totalRegressionSamples ?? 0,
  };
}

// SPEC 25 §11.4.1: 从 run_results.parsed_output 重建 generateNextVersion 的返回字段。
// 已 success 行的 parsed_output 必有 newPromptBody;rawResponse 兜底以防极端 race。
// newOutputSchema / outputSchemaChangeReason 是可选字段:LLM 提供且通过校验时存在。
// autoPatched / patchedVariables 由 generate retry+patch 路径写入 parsedOutput,workflow 复用时也透传。
export function reconstructGenerateFromRunResult(
  row: { parsedOutput: unknown; rawResponse: string | null },
  fallbackBody: string,
): {
  newPromptBody: string;
  changeSummary: string;
  newOutputSchema?: unknown;
  outputSchemaChangeReason?: string;
  autoPatched?: boolean;
  patchedVariables?: string[];
} {
  if (isObject(row.parsedOutput)) {
    const obj = row.parsedOutput as Record<string, unknown>;
    const body = typeof obj['newPromptBody'] === 'string' ? (obj['newPromptBody'] as string) : null;
    const summary = typeof obj['changeSummary'] === 'string' ? (obj['changeSummary'] as string) : '';
    if (body) {
      const result: {
        newPromptBody: string;
        changeSummary: string;
        newOutputSchema?: unknown;
        outputSchemaChangeReason?: string;
        autoPatched?: boolean;
        patchedVariables?: string[];
      } = { newPromptBody: body, changeSummary: summary };
      if (isObject(obj['newOutputSchema'])) {
        result.newOutputSchema = obj['newOutputSchema'];
      }
      if (
        typeof obj['outputSchemaChangeReason'] === 'string' &&
        (obj['outputSchemaChangeReason'] as string).length > 0
      ) {
        result.outputSchemaChangeReason = obj['outputSchemaChangeReason'] as string;
      }
      if (typeof obj['autoPatched'] === 'boolean') {
        result.autoPatched = obj['autoPatched'] as boolean;
      }
      if (Array.isArray(obj['patchedVariables'])) {
        result.patchedVariables = (obj['patchedVariables'] as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        );
      }
      return result;
    }
  }
  if (typeof row.rawResponse === 'string' && row.rawResponse.length > 0) {
    return { newPromptBody: row.rawResponse, changeSummary: '' };
  }
  return { newPromptBody: fallbackBody, changeSummary: 'restored_from_reuse' };
}

// 从 generate run_results.parsed_output 中提取 LLM 自报的 appliedTips,过滤无效项。
// 供 buildRoundHistoryEntries 反聚合「工具箱轮换提示」依据(SPEC 25 §11.3)。旧数据 / 解析失败 → []。
export function extractAppliedTipsFromGenerateParsedOutput(parsedGen: unknown): string[] {
  if (!parsedGen || typeof parsedGen !== 'object') return [];
  const tips = (parsedGen as { appliedTips?: unknown }).appliedTips;
  if (!Array.isArray(tips)) return [];
  return tips.filter((t): t is string => typeof t === 'string' && t.length > 0);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readSummaryText(parsed: Record<string, unknown> | null, rawResponse: string | null): string {
  if (parsed) {
    if (typeof parsed['summary'] === 'string') return parsed['summary'] as string;
    if (typeof parsed['errorAnalysisText'] === 'string') return parsed['errorAnalysisText'] as string;
  }
  if (typeof rawResponse === 'string' && rawResponse.length > 0) return rawResponse;
  return '';
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function readOptimizationHintFromContext(ctx: {
  optimizationHint?: string | null;
  runConfig?: unknown;
}): string | undefined {
  const direct = normalizeOptionalText(ctx.optimizationHint);
  if (direct) return direct;
  const runConfig =
    ctx.runConfig && typeof ctx.runConfig === 'object' ? (ctx.runConfig as Record<string, unknown>) : {};
  const legacy = typeof runConfig['optimizationHint'] === 'string' ? runConfig['optimizationHint'] : undefined;
  return normalizeOptionalText(legacy) ?? undefined;
}

// 把 LLM 调用 / 解析等异常归一化成 round_steps.error_class + error_message。
// errorMessage 长度截到 1000 字符,避免大堆栈塞 DB。
function normalizeErrorForStep(err: unknown): { errorClass: string; errorMessage: string } {
  const errObj = err as { name?: string; message?: string } | undefined;
  const errorClass = typeof errObj?.name === 'string' && errObj.name.length > 0 ? errObj.name : 'Error';
  const rawMsg = typeof errObj?.message === 'string' ? errObj.message : String(err ?? 'unknown');
  return { errorClass, errorMessage: rawMsg.slice(0, 1000) };
}

// SPEC 25 §11 子实验 runConfig 继承:optimizations.run_config 解析为 experimentRunConfigSchema,
// 未识别字段(stopAfterNoImprovementRounds 等)由 catchall 保留;后续 service
// parseRunConfig 用同一 schema 再次过滤,保证子实验 runConfig 只暴露 experimentRunConfigSchema 字段集。
export function parseChildRunConfigFromOptimization(value: unknown): ExperimentRunConfigDto {
  const parsed = experimentRunConfigSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

function invalidSnapshot(reason: string): WorkflowConfigSnapshot {
  return {
    ok: false,
    reason,
    projectId: '',
    optimizationName: '',
    promptId: null,
    baseVersionId: null,
    basePromptVersion: null,
    datasetId: '',
    datasetSampleCount: 0,
    startingMode: '',
    sourceExperimentId: null,
    promptLanguage: DEFAULT_PROMPT_LANGUAGE,
    analysisModel: emptyModel(),
    taskModel: emptyModel(),
    goals: [],
    fieldWhitelist: { promptVariables: [] },
    strategy: '',
    strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
    maxRounds: 0,
    optimizationHint: undefined,
    createdBy: '',
    nextRound: 1,
    bestVersion: null,
    bestMetrics: emptyMetrics(),
    childRunConfig: {},
    resumeChildExpId: null,
  };
}

function emptyMetrics(): MetricSnapshot {
  return { overall: {} };
}

function emptyModel(): ModelInvocationConfig {
  return {
    id: '',
    providerType: '',
    providerModelId: '',
    endpoint: '',
    apiKey: '',
    rpmLimit: 0,
    tpmLimit: 0,
    concurrencyLimit: 0,
    inputTokenPricePerMillion: 0,
    outputTokenPricePerMillion: 0,
    extraBody: {},
  };
}

function parsePromptLanguage(value: unknown): PromptLanguageDto {
  const parse = promptLanguageSchema.safeParse(value);
  return parse.success ? parse.data : DEFAULT_PROMPT_LANGUAGE;
}

function toModelInvocationCapabilities(raw: unknown): ModelInvocationConfig['capabilities'] {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const image = (raw as Record<string, unknown>).image;
    if (typeof image === 'string' && ['none', 'url', 'base64', 'both'].includes(image)) {
      return { image: image as ModelImageCapability };
    }
  }
  return { image: 'none' };
}

function toExtraBody(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

function toLoopGoal(dto: OptimizationGoalDto): OptimizationGoal {
  const op = dto.comparator === 'gte' ? '>=' : dto.comparator === 'gt' ? '>' : '<=';
  const scope =
    dto.scope === 'overall' || !dto.scope
      ? ({ kind: 'overall' } as const)
      : ({ kind: 'class', label: dto.scope } as const);
  return {
    metric: dto.metric,
    op,
    value: dto.target,
    scope,
  };
}

export function toLoopFieldWhitelist(dto: OptimizationFieldWhitelistDto | null, expectedField: string): FieldWhitelist {
  if (!dto) return { promptVariables: [] };
  // DTO 用 inputFields / metaFields；strategy 包用 promptVariables / analysisOnlyFields。
  // 语义对应：inputFields = 允许出现在 prompt 模板里的变量；metaFields = 仅给分析 LLM 看的元数据字段。
  // SPEC 25 §9 把这两个概念合并表述，DTO 是当前最小集；modifiableSections 暂无 DTO 字段，留空。
  //
  // 安全约束：judgment rules 引用的 expected_field（默认 expected_output）是 ground truth，
  // 业务 prompt 绝不能把它当变量注入（会泄漏答案）。若 UI / DTO 把它放进 inputFields（前端默认
  // 会把数据集所有字段塞过来），这里统一剔除并下移到 analysisOnlyFields——既杜绝泄漏，又能
  // 避免生成 LLM 看到这个字段名后做"防御性"地把所有 {{var}} 都删掉的过度反应。
  const inputFields = dto.inputFields.filter((f) => f !== expectedField);
  const analysisOnly = [...dto.metaFields, ...(dto.inputFields.includes(expectedField) ? [expectedField] : [])];
  return {
    promptVariables: inputFields,
    analysisOnlyFields: analysisOnly.length > 0 ? analysisOnly : undefined,
  };
}

export function parseVariables(raw: unknown): PromptVariableDto[] {
  if (!Array.isArray(raw)) return [];
  const list: PromptVariableDto[] = [];
  for (const item of raw) {
    const parse = promptVariableSchema.safeParse(item);
    if (parse.success) list.push(parse.data);
  }
  return list;
}

function deterministicUuid(seed: string): string {
  const hash = createHash('sha1').update(`${OPTIMIZATION_NS}:${seed}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function isPromptBaselineBootstrapNeeded(startingMode: string): boolean {
  // SPEC 25 §2.1: from_dataset_only 在 generateFirstVersionStep 完成后也走与
  // from_prompt_version 同构的 baseline 实验流程。
  return startingMode === 'from_prompt_version' || startingMode === 'from_dataset_only';
}

// SPEC 25 §2.1 首版生成失败时把 Error 映射为 finalize 用的原因码。
// FirstVersionParseError → first_version_parse_failed_v1
// message 已经带 `first_version_*_v1` 前缀 → 直接取前缀
// 其它(网络错 / LLM 限流耗尽 / panic) → first_version_generation_failed_v1
export function mapFirstVersionErrorReason(error: unknown): string {
  if (error instanceof FirstVersionParseError) return 'first_version_parse_failed_v1';
  if (error instanceof Error) {
    const msg = error.message;
    if (msg.startsWith('first_version_dataset_empty_v1')) return 'first_version_dataset_empty_v1';
    if (msg.startsWith('first_version_parse_failed_v1')) return 'first_version_parse_failed_v1';
    if (msg.startsWith('first_version_generation_failed_v1')) {
      // 携带子原因(如 :context_missing) → 保留前缀部分让前端 mapping 更细粒度
      return msg.split(':')[0] ?? 'first_version_generation_failed_v1';
    }
  }
  return 'first_version_generation_failed_v1';
}

// SPEC 25 §2.1: 首版生成时的样本抽样 — replay 时 seed 固定为 `${optimizationId}:first-version`,
// 保证多次重放抽到同一批样本,LLM run_result 通过确定性 id 也只写一行。
export function pickRandomSamples<T>(items: T[], n: number, seed: string): T[] {
  if (items.length <= n) return items.slice();
  // seedable PRNG (xorshift32) — 不要 crypto 强度,只要 replay 一致;state=0 会自锁,故 || 1
  let state = 0;
  for (const ch of seed) state = (state * 31 + ch.charCodeAt(0)) >>> 0;
  if (state === 0) state = 1;
  const rng = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
  const out = items.slice();
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (out.length - i));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out.slice(0, n);
}

export function computeOptimizationBaselineExperimentId(optimizationId: string): string {
  return deterministicUuid(`${optimizationId}:baseline:experiment`);
}

export function buildOptimizationExperimentName(
  optimizationName: string,
  round: 'baseline' | number,
  options: { collisionSalt?: string; maxLength?: number } = {},
): string {
  const maxLength = options.maxLength ?? OPTIMIZATION_EXPERIMENT_NAME_MAX_LENGTH;
  const trimmedName = optimizationName.trim() || OPTIMIZATION_EXPERIMENT_NAME_FALLBACK;
  const roundLabel = round === 'baseline' ? 'baseline' : `R${round}`;
  const collisionSuffix = options.collisionSalt
    ? `${OPTIMIZATION_EXPERIMENT_NAME_SEPARATOR}${shortHash(options.collisionSalt, 6)}`
    : '';
  const fixedSuffix = `${OPTIMIZATION_EXPERIMENT_NAME_SEPARATOR}${roundLabel}${collisionSuffix}`;
  const prefixMaxLength = Math.max(1, maxLength - fixedSuffix.length);
  const prefix = trimmedName.length <= prefixMaxLength ? trimmedName : trimmedName.slice(0, prefixMaxLength).trimEnd();
  return `${prefix || OPTIMIZATION_EXPERIMENT_NAME_FALLBACK}${fixedSuffix}`;
}

function shortHash(value: string, length: number): string {
  return createHash('sha1').update(value).digest('hex').slice(0, length);
}

function readJudgmentDecisionField(outputSchema: unknown): string | null {
  if (!outputSchema || typeof outputSchema !== 'object' || Array.isArray(outputSchema)) return null;
  const fields = (outputSchema as Record<string, unknown>)['fields'];
  if (!Array.isArray(fields)) return null;
  for (const field of fields) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) continue;
    const record = field as Record<string, unknown>;
    if (record['isJudgment'] !== true && record['is_decision'] !== true && record['judgment'] !== true) continue;
    const key = record['key'] ?? record['name'];
    if (typeof key === 'string' && key.trim().length > 0) return key.trim();
  }
  return null;
}

export function deriveJudgmentRulesFromOutputSchema(
  outputSchema: PromptOutputSchemaDto,
  expectedField = 'expected_output',
): PromptJudgmentRulesDto {
  return {
    mode: 'exact_match',
    expected_field: expectedField,
    decision_field: readJudgmentDecisionField(outputSchema) ?? 'label',
  };
}

function normalizeBaselineExperimentStatus(status: string): BaselineExperimentStatus {
  if (status === 'success' || status === 'failed' || status === 'stopped' || status === 'cancelled') {
    return status;
  }
  return 'running';
}

// 与 experiment.workflow.ts 的同名 helper 行为一致:从 judgmentRules JSONB 读出 expected 字段名,
// 默认 'expected_output'。两个通道独立保留实现,避免跨模块耦合 (SPEC 23/24 的 judgmentRules 契约)
export function readExpectedField(rules: unknown): string {
  if (rules && typeof rules === 'object') {
    const record = rules as Record<string, unknown>;
    const f = record['expected_field'] ?? record['expectedField'];
    if (typeof f === 'string' && f.length > 0) return f;
    const rawRules = record['rules'];
    if (Array.isArray(rawRules)) {
      for (const rule of rawRules) {
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue;
        const nested =
          (rule as Record<string, unknown>)['expected_field'] ??
          (rule as Record<string, unknown>)['expectedField'] ??
          (rule as Record<string, unknown>)['value'];
        if (typeof nested === 'string' && nested.length > 0) return nested;
      }
    }
  }
  return 'expected_output';
}

// 把 dataset 原始样本投影成 strategy 包消费的 SampleRecord;expected 从 data[expectedField] 抽,
// 缺省时留 undefined,让下游 confusion-pairs 的 asLabel 决定是否过滤
export function buildSamplesForStrategy(
  samplesRaw: Array<{ id: string; data: Record<string, unknown> }>,
  judgmentRulesConfig: unknown,
): SampleRecord[] {
  const expectedField = readExpectedField(judgmentRulesConfig);
  return samplesRaw.map((s) => {
    const rawExpected = s.data[expectedField];
    return {
      id: s.id,
      input: s.data,
      expected: rawExpected == null ? undefined : rawExpected,
    };
  });
}

// 暴露给 e2e / mcp 用的稳定 id 计算
export function computeOptimizationVersionId(optimizationId: string, roundNumber: number): string {
  return deterministicUuid(`${optimizationId}:${roundNumber}:version`);
}

export function computeOptimizationExperimentId(optimizationId: string, roundNumber: number): string {
  return deterministicUuid(`${optimizationId}:${roundNumber}:experiment`);
}

// 这两个变量来自 schema 但没被直接 import；保留对应类型给后续 step 用
void runResults;
void asc;
void and;

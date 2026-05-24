/* eslint-disable no-console -- 集成测试用 console.log 打印 LLM I/O 便于人工观察 */
// 真实 LLM 集成测试 — 1 轮优化闭环冒烟
//
// 触发：MODEL_PROBE_PROVIDER_TYPE / MODEL_ID / ENDPOINT / API_KEY 同时存在时启用；
// 否则自动 skip。env 缺失场景 vitest 不会失败，只会显示 skipped。
//
// 复用项目内 MODEL_PROBE_* 系列（与 apps/worker/src/scripts/probe-model-from-env.ts 同源约定），
// 这样一份 .env 既能跑 model 连通性探测，也能跑本集成测试。
//
// 跑法：
//   pnpm --filter @proofhound/optimization-strategy test:integration
//
// 本测试模拟「已有实验」起步：
// - 数据集 10 条二分类（5 positive / 5 negative）— 形状对齐 ph_assets.dataset_samples.data (jsonb)
// - 首版 prompt 极简「判断 {{review_text}} 的情感」
// - 上一轮 fake 失败预测：模型全猜 positive → accuracy=0.5；混淆对 negative→positive=5
// - previousRunResults=null → 跳过 regression 分析
// - maxRounds=1：跑 1 轮 (1 confusion + 1 summarize + 1 generate = 3 次真实 LLM)
// - ExperimentRunner 用 mock 返回 metrics（本算法包不感知实验执行）
//
// 断言 + 打印：链路通了 + 新 prompt 包含变量占位 + 各阶段 LLM I/O 打印到控制台便于人工观察。
// 特别打印「生成的纯 body」「自动拼接的输出格式段」「composed 完整 prompt」三段，
// 方便人工核对：生成的 body 不含输出格式 / JSON schema，输出格式段由 outputSchema 自动拼接。
import { resolve } from 'node:path';
import { StubLimiter } from '@proofhound/limiter';
import type { LLMCallLogger, ModelInvocationConfig } from '@proofhound/llm-client';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG } from '../error-pattern-analysis/config.schema';
import { runIterationLoop } from '../loop/run-iteration-loop';
import type {
  OptimizationConfig,
  ExperimentSnapshot,
  LoopDependencies,
  MetricSnapshot,
  RunResultRecord,
  SampleRecord,
} from '../loop/types';
import type { ErrorPatternAnalysisConfig } from '../error-pattern-analysis/config.schema';
import { buildOutputFormatInstruction, composeFullPrompt } from '@proofhound/shared';
import { InMemoryExperimentRunner, makeInMemoryPorts } from './helpers/in-memory-ports';

// ---------- env 加载（兼容 cwd 和 monorepo root） ----------
function loadEnvFile(): void {
  for (const candidate of [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), '../../../.env'),
  ]) {
    try {
      // Node.js 21+ 原生 API；project engines.node 24.x
      process.loadEnvFile(candidate);
      return;
    } catch {
      // 找下一个
    }
  }
}

loadEnvFile();

const REQUIRED = [
  'MODEL_PROBE_PROVIDER_TYPE',
  'MODEL_PROBE_MODEL_ID',
  'MODEL_PROBE_ENDPOINT',
  'MODEL_PROBE_API_KEY',
];

const hasEnv = REQUIRED.every((k) => {
  const v = process.env[k];
  return typeof v === 'string' && v.trim().length > 0;
});

const describeIf = hasEnv ? describe : describe.skip;

function modelFromEnv(): ModelInvocationConfig {
  return {
    id: 'model_integration_probe',
    providerType: process.env['MODEL_PROBE_PROVIDER_TYPE']!,
    providerModelId: process.env['MODEL_PROBE_MODEL_ID']!,
    endpoint: process.env['MODEL_PROBE_ENDPOINT']!,
    apiKey: process.env['MODEL_PROBE_API_KEY']!,
    rpmLimit: Number(process.env['MODEL_PROBE_RPM_LIMIT'] ?? 60),
    tpmLimit: Number(process.env['MODEL_PROBE_TPM_LIMIT'] ?? 100_000),
    concurrencyLimit: Number(process.env['MODEL_PROBE_CONCURRENCY_LIMIT'] ?? 1),
    inputTokenPricePerMillion: Number(process.env['MODEL_PROBE_INPUT_PRICE_PER_MILLION'] ?? 0),
    outputTokenPricePerMillion: Number(process.env['MODEL_PROBE_OUTPUT_PRICE_PER_MILLION'] ?? 0),
  };
}

// ---------- mock 数据集（贴近 ph_assets.dataset_samples 真实形状） ----------
// data jsonb 字段 → 我们的 SampleRecord.input；expected 是 V1 把"期望值"按 judgment_rules.field 从 data 解出来的简化版
const samples: SampleRecord[] = [
  { id: 's1', input: { review_text: '这个产品非常棒，强烈推荐！' }, expected: 'positive' },
  { id: 's2', input: { review_text: '完美，超出预期，非常满意' }, expected: 'positive' },
  { id: 's3', input: { review_text: '物美价廉，下次还会购买' }, expected: 'positive' },
  { id: 's4', input: { review_text: '解决了我的问题，谢谢' }, expected: 'positive' },
  { id: 's5', input: { review_text: '五星好评！服务也很好' }, expected: 'positive' },
  { id: 's6', input: { review_text: '太垃圾了，浪费钱' }, expected: 'negative' },
  { id: 's7', input: { review_text: '收到货就坏了，很失望' }, expected: 'negative' },
  { id: 's8', input: { review_text: '说明书写得乱七八糟' }, expected: 'negative' },
  { id: 's9', input: { review_text: '差评，不会再买了' }, expected: 'negative' },
  { id: 's10', input: { review_text: '客服态度很差，一星' }, expected: 'negative' },
];

// 上一轮 fake 失败：模型全猜 positive → 5 个 negative 全错（混淆对 negative→positive=5）
const fakeBadRunResults: RunResultRecord[] = samples.map((s) => ({
  id: `rr_${s.id}`,
  sampleId: s.id,
  decisionOutput: 'positive',
  parsedOutput: { sentiment: 'positive' },
  isCorrect: s.expected === 'positive',
}));

const lastMetrics: MetricSnapshot = {
  overall: { accuracy: 0.5, precision: 0.5, recall: 1.0, f1: 0.6667 },
  perClass: {
    positive: { precision: 0.5, recall: 1.0, f1: 0.6667 },
    negative: { precision: 0, recall: 0, f1: 0 },
  },
};

function makeSnapshot(taskModel: ModelInvocationConfig): ExperimentSnapshot {
  return {
    projectId: 'integration_proj',
    projectType: 'classification',
    sourceExperimentId: 'integration_exp_source',
    dataset: { id: 'integration_ds', samples },
    taskModel,
    judgmentRules: { ruleName: 'enum_match', config: { field: 'sentiment' } },
    basePromptVersion: {
      id: 'integration_pv_base',
      promptId: 'integration_p',
      versionNumber: 1,
      body: '判断 {{review_text}} 的情感', // 极简首版
      outputSchema: { type: 'object', properties: { sentiment: { enum: ['positive', 'negative'] } } },
      judgmentRules: { ruleName: 'enum_match', config: { field: 'sentiment' } },
      variables: [{ name: 'review_text', description: '用户评论原文' }],
    },
    lastRunResults: fakeBadRunResults,
    lastMetrics,
  };
}

function makeConfig(model: ModelInvocationConfig): OptimizationConfig<ErrorPatternAnalysisConfig> {
  return {
    optimizationId: 'integration_ai',
    goals: [
      // 整体准确率目标设高 — 1 轮跑不到（确保走 max_rounds 退出而非提前 success）
      { metric: 'accuracy', op: '>=', value: 0.95, scope: { kind: 'overall' } },
      // 同时关心 negative 类（当前 precision=0, recall=0，差距最大）
      { metric: 'recall', op: '>=', value: 0.9, scope: { kind: 'class', label: 'negative' } },
    ],
    maxRounds: 1,
    fieldWhitelist: {
      promptVariables: ['review_text'],
      analysisOnlyFields: [],
      modifiableSections: ['任务说明', '示例区', '判定边界'],
    },
    optimizationHint: '请聚焦在如何让模型识别 negative 情感的关键词',
    analysisModel: model,
    taskModel: model,
    strategyKey: 'error_pattern_analysis',
    strategyConfig: DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG,
  };
}

function makeConsoleLogger(): LLMCallLogger {
  return {
    info: (payload, msg) => {
      // 关注 stepName + durationMs；payload 里 promptCapped 由 invokeLLM 自动 redact，安全
      const lite = {
        stepName: (payload as Record<string, unknown>).stepName,
        durationMs: (payload as Record<string, unknown>).durationMs,
        costEstimate: (payload as Record<string, unknown>).costEstimate,
        inputTokens: (payload as Record<string, unknown>).inputTokens,
        outputTokens: (payload as Record<string, unknown>).outputTokens,
      };
      console.log(`[llm:info] ${msg}`, JSON.stringify(lite));
    },
    error: (payload, msg) => {
      console.error(`[llm:error] ${msg}`, JSON.stringify(payload));
    },
  };
}

describeIf('runIterationLoop · real LLM integration', () => {
  it(
    'runs 1 round end-to-end (confusion + summarize + generate) and produces a valid improved prompt',
    async () => {
      const model = modelFromEnv();
      console.log(
        '\n=== Integration test starting ===',
        JSON.stringify({
          providerType: model.providerType,
          providerModelId: model.providerModelId,
          endpoint: model.endpoint,
        }),
      );

      const snapshot = makeSnapshot(model);
      const config = makeConfig(model);

      // ExperimentRunner 用 mock — 不真调 LLM 跑实验（本算法包不感知"实验执行"）。
      // 让 round-1 的实验返回稍微改善的指标，但仍未达标（用于触发 max_rounds 结束）。
      const runner = new InMemoryExperimentRunner([
        {
          experimentId: 'integration_exp_r1',
          metrics: {
            overall: { accuracy: 0.7, precision: 0.7, recall: 0.7, f1: 0.7 },
            perClass: {
              positive: { precision: 0.7, recall: 0.8, f1: 0.75 },
              negative: { precision: 0.7, recall: 0.6, f1: 0.65 },
            },
          },
          runResults: samples.map((s, i) => ({
            id: `rr_r1_${s.id}`,
            sampleId: s.id,
            decisionOutput: i < 7 ? s.expected : (s.expected === 'positive' ? 'negative' : 'positive'),
            parsedOutput: {},
            isCorrect: i < 7,
          })) as RunResultRecord[],
        },
      ]);
      const ports = makeInMemoryPorts({ runner });
      const deps: LoopDependencies = {
        limiter: new StubLimiter(),
        logger: makeConsoleLogger(),
      };

      const startedAt = Date.now();
      const result = await runIterationLoop(config, snapshot, ports, deps);
      const elapsedMs = Date.now() - startedAt;
      console.log(`\n=== Iteration finished in ${elapsedMs}ms ===`);

      // ===== 断言：链路正确 =====
      expect(result.rounds).toHaveLength(1);
      // 1 轮没达标 → max_rounds 退出
      expect(result.status).toBe('failed');
      expect(result.reason).toBe('max_rounds');

      // promptVersionWriter 写入了 1 个新版本，body 含变量占位
      expect(ports.promptVersionWriter.writes).toHaveLength(1);
      const write = ports.promptVersionWriter.writes[0]!;
      expect(write.body).toContain('{{review_text}}');
      expect(write.parentVersionId).toBe('integration_pv_base');
      expect(write.outputSchema).toBeDefined();
      expect(write.changeSummary.length).toBeGreaterThan(0);

      // previousRoundRunResultsReader 被调 1 次 + 返回 null → 没有 regression batch
      expect(ports.previousRoundRunResultsReader.calls).toHaveLength(1);
      const round = result.rounds[0]!;
      expect(round.errorAnalysis.length).toBeGreaterThan(0);
      expect(round.changeSummary.length).toBeGreaterThan(0);

      // 最终落 recordFinal
      expect(ports.roundRecorder.finalResult).not.toBeNull();
      expect(ports.roundRecorder.finalResult?.reason).toBe('max_rounds');

      // ===== 人工观察打印 =====
      console.log('\n=== Original prompt ===');
      console.log(snapshot.basePromptVersion.body);

      console.log('\n=== Error analysis (summary) ===');
      console.log(round.errorAnalysis);

      console.log('\n=== Change summary ===');
      console.log(round.changeSummary);

      console.log('\n=== Generated new prompt (LLM-authored body, 应不含输出格式 / JSON schema) ===');
      console.log(write.body);

      // 输出格式段从 outputSchema 自动拼接 — 业务 LLM 调用时会接在 body 尾部
      const outputFormatInstruction = buildOutputFormatInstruction(
        snapshot.basePromptVersion.outputSchema,
      );
      console.log('\n=== Auto-built output format instruction (from outputSchema) ===');
      console.log(outputFormatInstruction);

      const composedFullPrompt = composeFullPrompt(
        write.body,
        snapshot.basePromptVersion.outputSchema,
      );
      console.log('\n=== Composed full prompt (body + output format → 发给业务 LLM 的样子) ===');
      console.log(composedFullPrompt);

      console.log('\n=== Round metrics (mocked by InMemoryExperimentRunner) ===');
      console.log(JSON.stringify(round.metrics, null, 2));

      console.log('\n=== Goal progress ===');
      for (const gp of round.goalProgress) {
        console.log(
          `- ${gp.goal.scope.kind === 'overall' ? '整体' : `分类「${gp.goal.scope.label}」`} ${gp.goal.metric} ${gp.goal.op} ${gp.goal.value} | observed=${gp.observed} | achieved=${gp.achieved}`,
        );
      }

      console.log('\n=== Final OptimizationResult (compact) ===');
      console.log(
        JSON.stringify(
          {
            status: result.status,
            reason: result.reason,
            bestVersionId: result.bestVersionId,
            bestMetrics: result.bestMetrics,
            roundCount: result.rounds.length,
            errorClass: result.errorClass,
            errorMessage: result.errorMessage,
          },
          null,
          2,
        ),
      );
    },
    // 真实 LLM 调用最多 3 次 — 留 2 分钟超时
    120_000,
  );
});

if (!hasEnv) {
  console.log(
    '[real-llm.integration.test] skipped — set MODEL_PROBE_PROVIDER_TYPE / MODEL_ID / ENDPOINT / API_KEY to enable. ' +
      'See .env.example for the full list.',
  );
}

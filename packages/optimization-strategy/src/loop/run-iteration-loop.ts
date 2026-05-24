// 优化主循环 — 详见 docs/specs/25-optimizations.md
import { analyzeFailures } from '../error-pattern-analysis/analyze';
import { generateNextVersion } from '../error-pattern-analysis/generate';
import type { ErrorPatternAnalysisConfig } from '../error-pattern-analysis/config.schema';
import { getOptimizationTipNames } from '../error-pattern-analysis/prompts';
import { isBetterThan } from './best';
import { allGoalsMet, evaluateGoals, readMetric } from './goals';
import {
  toInvokeLLMDependencies,
  type OptimizationConfig,
  type OptimizationGoal,
  type OptimizationReason,
  type OptimizationResult,
  type OptimizationStatus,
  type ExperimentSnapshot,
  type LoopDependencies,
  type LoopPorts,
  type MetricSnapshot,
  type PromptVersionRef,
  type RoundHistoryEntry,
  type RoundOutcome,
  type RunResultRecord,
} from './types';

function nowIso(deps: LoopDependencies): string {
  return new Date(deps.now?.() ?? Date.now()).toISOString();
}

// 从 roundHistory 末尾向前数连续 !isBest 计数 — 用于「工具箱轮换提示」触发判定
// (SPEC 25 §11.3「工具箱轮换提示」)。空 history / 末尾轮已是 best → 返回 0。
export function computeNoBestStreak(history: RoundHistoryEntry[]): number {
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.isBest) break;
    streak++;
  }
  return streak;
}

// 在 streak >= 2 时构造 hint:取末尾 2 条 entry.appliedTips 去重合集 + 工具箱常量。
// streak < 2 / history 为空 → undefined(不渲染该段)。
function buildToolboxSwitchHint(
  history: RoundHistoryEntry[],
  promptLanguage?: OptimizationConfig['promptLanguage'],
): { recentlyUsedTips: string[]; allTipNames: readonly string[] } | undefined {
  const streak = computeNoBestStreak(history);
  if (streak < 2) return undefined;
  const recentEntries = history.slice(-2);
  const usedSet = new Set<string>();
  for (const e of recentEntries) {
    for (const t of e.appliedTips) {
      const trimmed = t.trim();
      if (trimmed.length > 0) usedSet.add(trimmed);
    }
  }
  return { recentlyUsedTips: Array.from(usedSet), allTipNames: getOptimizationTipNames(promptLanguage) };
}

function normalizeErrorClass(err: unknown): { errorClass: string; errorMessage: string } {
  if (err instanceof Error) {
    return { errorClass: err.name || 'Error', errorMessage: err.message };
  }
  return { errorClass: 'UnknownError', errorMessage: String(err) };
}

interface FinalizeContext {
  status: OptimizationStatus;
  reason: OptimizationReason;
  bestVersion: PromptVersionRef;
  bestMetrics: MetricSnapshot;
  rounds: RoundOutcome[];
  errorClass?: string;
  errorMessage?: string;
}

interface PendingRegressionRetry {
  baseVersion: PromptVersionRef;
  baseRunResults: RunResultRecord[];
  baseMetrics: MetricSnapshot;
  regressedVersion: PromptVersionRef;
  regressedRunResults: RunResultRecord[];
  regressedMetrics: MetricSnapshot;
}

async function finalize(
  ctx: FinalizeContext,
  config: OptimizationConfig<ErrorPatternAnalysisConfig>,
  ports: LoopPorts,
): Promise<OptimizationResult> {
  const result: OptimizationResult = {
    status: ctx.status,
    reason: ctx.reason,
    bestVersionId: ctx.bestVersion.id,
    bestMetrics: ctx.bestMetrics,
    rounds: ctx.rounds,
    errorClass: ctx.errorClass,
    errorMessage: ctx.errorMessage,
  };
  await ports.roundRecorder.recordFinal(result, { optimizationId: config.optimizationId });
  return result;
}

export async function runIterationLoop(
  config: OptimizationConfig<ErrorPatternAnalysisConfig>,
  snapshot: ExperimentSnapshot,
  ports: LoopPorts,
  deps: LoopDependencies,
): Promise<OptimizationResult> {
  const invokeDeps = toInvokeLLMDependencies(deps);

  let bestVersion: PromptVersionRef = snapshot.basePromptVersion;
  let bestMetrics: MetricSnapshot = snapshot.lastMetrics;
  let bestRunResults: RunResultRecord[] = snapshot.lastRunResults;
  let pendingRegressionRetry: PendingRegressionRetry | null = null;
  const rounds: RoundOutcome[] = [];
  // 跨轮历史(SPEC 25 §11.3) — 每轮 finalize 后累积一条;下一轮传给 analyze / generate
  const accumulatedHistory: RoundHistoryEntry[] = [];

  // 第 0 轮：源实验作为基线；若已达标直接收尾
  if (allGoalsMet(config.goals, bestMetrics)) {
    return finalize({ status: 'success', reason: 'goals_met', bestVersion, bestMetrics, rounds }, config, ports);
  }

  for (let roundNumber = 1; roundNumber <= config.maxRounds; roundNumber++) {
    // ① control check
    const signal = await ports.controlSignals.read(config.optimizationId);
    if (signal === 'cancel') {
      return finalize(
        { status: 'cancelled', reason: 'control_cancel', bestVersion, bestMetrics, rounds },
        config,
        ports,
      );
    }
    if (signal === 'stop') {
      return finalize({ status: 'stopped', reason: 'control_stop', bestVersion, bestMetrics, rounds }, config, ports);
    }

    const startedAt = nowIso(deps);

    try {
      const generationBaseVersion: PromptVersionRef = pendingRegressionRetry?.baseVersion ?? bestVersion;
      const generationBaseRunResults: RunResultRecord[] = pendingRegressionRetry?.baseRunResults ?? bestRunResults;
      const generationBaseMetrics: MetricSnapshot = pendingRegressionRetry?.baseMetrics ?? bestMetrics;
      const analysisVersion: PromptVersionRef = pendingRegressionRetry?.regressedVersion ?? generationBaseVersion;
      const currentRunResults: RunResultRecord[] =
        pendingRegressionRetry?.regressedRunResults ?? generationBaseRunResults;
      const currentMetrics: MetricSnapshot = pendingRegressionRetry?.regressedMetrics ?? generationBaseMetrics;

      // ② 从 DB 拉 previousRunResults — 用于回归样本检测
      const previousRunResults =
        pendingRegressionRetry?.baseRunResults ??
        (await ports.previousRoundRunResultsReader.read({
          optimizationId: config.optimizationId,
          sourceExperimentId: snapshot.sourceExperimentId,
          currentRoundNumber: roundNumber,
        }));

      // 本轮 generate 的 base — 在 step ⑦ 更新 bestVersion 之前快照,用于 history 记录。
      // 若上一轮相对其父版本退步,这里会回退到父 prompt,但 analyze 仍看退步轮版本与样本。
      const baseVersionForThisRound = generationBaseVersion;

      // ③ 错误样本分析（混淆对 + 回归 + 多次 LLM + 汇总）
      const analysis = await analyzeFailures(
        {
          optimizationId: config.optimizationId,
          roundNumber,
          analysisModel: config.analysisModel,
          currentVersion: analysisVersion,
          previousVersion: pendingRegressionRetry?.baseVersion ?? null,
          samples: snapshot.dataset.samples,
          currentRunResults,
          previousRunResults,
          metrics: currentMetrics,
          goals: config.goals,
          fieldWhitelist: config.fieldWhitelist,
          strategyConfig: config.strategyConfig,
          roundHistory: accumulatedHistory,
          promptLanguage: config.promptLanguage,
        },
        invokeDeps,
      );

      // ④ 生成新版本(连续 ≥2 轮未刷新 best 时注入「工具箱轮换提示」段 — SPEC 25 §11.3)
      const toolboxSwitchHint = buildToolboxSwitchHint(accumulatedHistory, config.promptLanguage);
      const draft = await generateNextVersion(
        {
          optimizationId: config.optimizationId,
          roundNumber,
          analysisModel: config.analysisModel,
          currentVersion: generationBaseVersion,
          analysis,
          metrics: currentMetrics,
          goals: config.goals,
          fieldWhitelist: config.fieldWhitelist,
          optimizationHint: config.optimizationHint,
          strategyConfig: config.strategyConfig,
          roundHistory: accumulatedHistory,
          toolboxSwitchHint,
          promptLanguage: config.promptLanguage,
        },
        invokeDeps,
      );

      // ⑤ 入库新版本（outputSchema / judgmentRules 原样保留 — SPEC 23 冻结四件套）
      const newVersion = await ports.promptVersionWriter.writePromptVersion({
        promptId: generationBaseVersion.promptId,
        parentVersionId: generationBaseVersion.id,
        body: draft.newPromptBody,
        outputSchema: generationBaseVersion.outputSchema,
        judgmentRules: generationBaseVersion.judgmentRules,
        optimizationId: config.optimizationId,
        changeSummary: draft.changeSummary,
      });

      // ⑥ 跑实验
      const run = await ports.experimentRunner.runExperiment({
        optimizationId: config.optimizationId,
        versionId: newVersion.id,
        datasetId: snapshot.dataset.id,
        taskModel: config.taskModel,
        judgmentRules: snapshot.judgmentRules,
        roundNumber,
      });

      // ⑦ 更新 best
      const isBest = isBetterThan(run.metrics, bestMetrics, config.goals);
      if (isBest) {
        bestVersion = newVersion;
        bestMetrics = run.metrics;
        bestRunResults = run.runResults;
      }
      pendingRegressionRetry = isBetterThan(generationBaseMetrics, run.metrics, config.goals)
        ? {
            baseVersion: generationBaseVersion,
            baseRunResults: generationBaseRunResults,
            baseMetrics: generationBaseMetrics,
            regressedVersion: newVersion,
            regressedRunResults: run.runResults,
            regressedMetrics: run.metrics,
          }
        : null;

      const goalProgress = evaluateGoals(config.goals, bestMetrics);
      const outcome: RoundOutcome = {
        roundNumber,
        generatedVersionId: newVersion.id,
        errorAnalysis: analysis.errorAnalysisText,
        changeSummary: draft.changeSummary,
        experimentId: run.experimentId,
        runResults: run.runResults,
        metrics: run.metrics,
        isBest,
        goalProgress,
        startedAt,
        finishedAt: nowIso(deps),
      };
      rounds.push(outcome);
      await ports.roundRecorder.recordRound(outcome, {
        optimizationId: config.optimizationId,
      });

      // 累积 history(SPEC 25 §11.3) — 下一轮 analyze / generate 透传,
      // 让 LLM 跨轮识别已被证伪方向 / 持续放大有效方向 / 切换工具箱技巧
      accumulatedHistory.push(
        buildHistoryEntryFromRound({
          roundNumber,
          metrics: run.metrics,
          changeSummary: draft.changeSummary,
          appliedChanges: draft.appliedChanges,
          appliedTips: draft.appliedTips,
          isBest,
          baseVersionId: baseVersionForThisRound.id,
          goals: config.goals,
          previousHistory: accumulatedHistory,
        }),
      );

      // ⑧ goal check
      if (goalProgress.every((p) => p.achieved)) {
        return finalize({ status: 'success', reason: 'goals_met', bestVersion, bestMetrics, rounds }, config, ports);
      }
    } catch (err) {
      const { errorClass, errorMessage } = normalizeErrorClass(err);
      return finalize(
        {
          status: 'failed',
          reason: 'fatal_error',
          bestVersion,
          bestMetrics,
          rounds,
          errorClass,
          errorMessage,
        },
        config,
        ports,
      );
    }
  }

  return finalize({ status: 'failed', reason: 'max_rounds', bestVersion, bestMetrics, rounds }, config, ports);
}

// 从本轮 outcome 构造 RoundHistoryEntry — 下一轮 LLM 调用透传(SPEC 25 §11.3)
function buildHistoryEntryFromRound(input: {
  roundNumber: number;
  metrics: MetricSnapshot;
  changeSummary: string;
  appliedChanges: Array<{ changeId: string; patternIds: string[]; summary: string }> | undefined;
  appliedTips: string[] | undefined;
  isBest: boolean;
  baseVersionId: string;
  goals: OptimizationGoal[];
  previousHistory: RoundHistoryEntry[];
}): RoundHistoryEntry {
  const primaryGoal = input.goals[0];
  const currentPrimary = primaryGoal ? readMetric(input.metrics, primaryGoal) : null;
  const prevEntry = input.previousHistory[input.previousHistory.length - 1];
  const prevPrimary = prevEntry && primaryGoal ? readMetric(prevEntry.metrics, primaryGoal) : null;
  const deltaFromPrev = currentPrimary !== null && prevPrimary !== null ? currentPrimary - prevPrimary : null;
  return {
    roundIndex: input.roundNumber,
    metrics: input.metrics,
    deltaFromPrev,
    changeSummary: input.changeSummary,
    appliedChanges: (input.appliedChanges ?? []).map((c) => ({
      changeId: c.changeId,
      patternIds: c.patternIds,
      rationale: c.summary,
    })),
    appliedTips: input.appliedTips ?? [],
    isBest: input.isBest,
    generatedFromBaseVersionId: input.baseVersionId,
  };
}

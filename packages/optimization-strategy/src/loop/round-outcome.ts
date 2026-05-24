// Round 决策 — workflow.finalizeRoundImpl 调完子实验、拿到本轮指标后,
// 把"snapshot → isBest + goalsMet + 新 best 指标 + goalProgress"这一段纯计算从
// DBOS step 边界中分离出来,workflow 只负责按结果写状态。
//
// 不包含子实验失败 / 父 stop / cancel 等编排分支 —— 那些仍归 workflow 处理。
import { isBetterThan } from './best';
import { evaluateGoals } from './goals';
import type { OptimizationGoal, GoalProgressEntry, MetricSnapshot } from './types';

export interface RoundOutcomeDecisionInput {
  roundMetrics: MetricSnapshot;
  bestMetrics: MetricSnapshot;
  goals: OptimizationGoal[];
}

export interface RoundOutcomeDecision {
  isBest: boolean;
  goalsMet: boolean;
  // isBest 时为 roundMetrics,否则维持 bestMetrics;供 workflow 写入 best_metrics
  newBestMetrics: MetricSnapshot;
  // 基于新 best 评估的目标进度(用于详情页 / 日志)
  goalProgress: GoalProgressEntry[];
}

export function decideRoundOutcome(input: RoundOutcomeDecisionInput): RoundOutcomeDecision {
  const isBest = isBetterThan(input.roundMetrics, input.bestMetrics, input.goals);
  const newBestMetrics = isBest ? input.roundMetrics : input.bestMetrics;
  const goalProgress = evaluateGoals(input.goals, newBestMetrics);
  const goalsMet = goalProgress.length > 0 && goalProgress.every((p) => p.achieved);
  return { isBest, goalsMet, newBestMetrics, goalProgress };
}

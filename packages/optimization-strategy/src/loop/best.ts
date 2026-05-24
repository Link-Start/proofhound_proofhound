// best 比较 — 判定候选指标是否优于当前最佳
// 规则：未达标 goal 数严格减少 = 更好；并列时已观察值的总和方向上更好（按 op 累加 distance）。
import { compare, readMetric } from './goals';
import type { OptimizationGoal, ComparisonOp, MetricSnapshot } from './types';

function unmetCount(goals: OptimizationGoal[], metrics: MetricSnapshot): number {
  let n = 0;
  for (const goal of goals) {
    const observed = readMetric(metrics, goal);
    if (observed === null || !compare(observed, goal.op, goal.value)) n++;
  }
  return n;
}

// 单条 goal 在 metrics 下的「方向得分」—— op 朝向越好得分越高，缺失记 -Infinity
function directionalScore(metrics: MetricSnapshot, goal: OptimizationGoal): number {
  const observed = readMetric(metrics, goal);
  if (observed === null) return Number.NEGATIVE_INFINITY;
  return signFor(goal.op) * observed;
}

function signFor(op: ComparisonOp): number {
  // >=, > 想要值更大；<= 想要值更小（取负使「更小」变成「更大」）
  return op === '<=' ? -1 : 1;
}

export function isBetterThan(
  candidate: MetricSnapshot,
  current: MetricSnapshot,
  goals: OptimizationGoal[],
): boolean {
  if (goals.length === 0) return false;
  const candidateUnmet = unmetCount(goals, candidate);
  const currentUnmet = unmetCount(goals, current);
  if (candidateUnmet !== currentUnmet) return candidateUnmet < currentUnmet;
  // 并列时比方向总分
  let candidateScore = 0;
  let currentScore = 0;
  for (const goal of goals) {
    candidateScore += directionalScore(candidate, goal);
    currentScore += directionalScore(current, goal);
  }
  return candidateScore > currentScore;
}

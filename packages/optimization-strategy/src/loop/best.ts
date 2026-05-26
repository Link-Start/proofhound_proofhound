// best comparison — determine whether the candidate metric is better than the current best
// Rule: a strict reduction in the count of unmet goals = better; on ties, the sum of observed values in the direction is better (accumulate distance by op).
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

// A single goal's "direction score" under metrics — the more aligned with op, the higher the score; missing scored as -Infinity
function directionalScore(metrics: MetricSnapshot, goal: OptimizationGoal): number {
  const observed = readMetric(metrics, goal);
  if (observed === null) return Number.NEGATIVE_INFINITY;
  return signFor(goal.op) * observed;
}

function signFor(op: ComparisonOp): number {
  // >=, > want larger; <= want smaller (negate so "smaller" becomes "larger")
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
  // On ties, compare the directional total
  let candidateScore = 0;
  let currentScore = 0;
  for (const goal of goals) {
    candidateScore += directionalScore(candidate, goal);
    currentScore += directionalScore(current, goal);
  }
  return candidateScore > currentScore;
}

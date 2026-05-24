// 优化目标评估 — 纯函数
import type { OptimizationGoal, ComparisonOp, GoalProgressEntry, MetricSnapshot } from './types';

export function readMetric(metrics: MetricSnapshot, goal: OptimizationGoal): number | null {
  if (goal.scope.kind === 'overall') {
    const value = metrics.overall[goal.metric];
    return typeof value === 'number' ? value : null;
  }
  const slice = metrics.perClass?.[goal.scope.label];
  const value = slice?.[goal.metric];
  return typeof value === 'number' ? value : null;
}

export function compare(observed: number, op: ComparisonOp, target: number): boolean {
  switch (op) {
    case '>=':
      return observed >= target;
    case '<=':
      return observed <= target;
    case '>':
      return observed > target;
  }
}

export function evaluateGoals(goals: OptimizationGoal[], metrics: MetricSnapshot): GoalProgressEntry[] {
  return goals.map((goal) => {
    const observed = readMetric(metrics, goal);
    const achieved = observed === null ? false : compare(observed, goal.op, goal.value);
    return { goal, observed, achieved };
  });
}

export function allGoalsMet(goals: OptimizationGoal[], metrics: MetricSnapshot): boolean {
  if (goals.length === 0) return false;
  return evaluateGoals(goals, metrics).every((entry) => entry.achieved);
}

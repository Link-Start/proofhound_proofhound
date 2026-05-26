// Round decision — after workflow.finalizeRoundImpl calls the child experiment and gets this round's metrics,
// separate the "snapshot → isBest + goalsMet + new best metrics + goalProgress" pure computation out of
// the DBOS step boundary; the workflow only writes state based on the result.
//
// Does not include child experiment failure / parent stop / cancel orchestration branches — those are still handled by the workflow.
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
  // When isBest, this is roundMetrics; otherwise keeps bestMetrics — used by the workflow to write best_metrics
  newBestMetrics: MetricSnapshot;
  // Goal progress evaluated against the new best (for the detail page / logs)
  goalProgress: GoalProgressEntry[];
}

export function decideRoundOutcome(input: RoundOutcomeDecisionInput): RoundOutcomeDecision {
  const isBest = isBetterThan(input.roundMetrics, input.bestMetrics, input.goals);
  const newBestMetrics = isBest ? input.roundMetrics : input.bestMetrics;
  const goalProgress = evaluateGoals(input.goals, newBestMetrics);
  const goalsMet = goalProgress.length > 0 && goalProgress.every((p) => p.achieved);
  return { isBest, goalsMet, newBestMetrics, goalProgress };
}

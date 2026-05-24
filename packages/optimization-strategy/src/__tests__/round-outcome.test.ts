import { describe, expect, it } from 'vitest';
import { decideRoundOutcome } from '../loop/round-outcome';
import type { OptimizationGoal, MetricSnapshot } from '../loop/types';

const overall = (overall: Record<string, number>): MetricSnapshot => ({ overall });

const accGoal = (target: number): OptimizationGoal => ({
  metric: 'accuracy',
  op: '>=',
  value: target,
  scope: { kind: 'overall' },
});

describe('decideRoundOutcome', () => {
  it('marks new round as best and goalsMet when it meets goal', () => {
    const decision = decideRoundOutcome({
      roundMetrics: overall({ accuracy: 0.95 }),
      bestMetrics: overall({ accuracy: 0.8 }),
      goals: [accGoal(0.9)],
    });
    expect(decision.isBest).toBe(true);
    expect(decision.goalsMet).toBe(true);
    expect(decision.newBestMetrics.overall.accuracy).toBe(0.95);
  });

  it('keeps best unchanged and continues when round regresses', () => {
    const decision = decideRoundOutcome({
      roundMetrics: overall({ accuracy: 0.75 }),
      bestMetrics: overall({ accuracy: 0.9 }),
      goals: [accGoal(0.95)],
    });
    expect(decision.isBest).toBe(false);
    expect(decision.goalsMet).toBe(false);
    expect(decision.newBestMetrics.overall.accuracy).toBe(0.9);
  });

  it('promotes to best when round improves but goals still unmet', () => {
    const decision = decideRoundOutcome({
      roundMetrics: overall({ accuracy: 0.88 }),
      bestMetrics: overall({ accuracy: 0.85 }),
      goals: [accGoal(0.95)],
    });
    expect(decision.isBest).toBe(true);
    expect(decision.goalsMet).toBe(false);
    expect(decision.newBestMetrics.overall.accuracy).toBe(0.88);
    expect(decision.goalProgress[0]?.achieved).toBe(false);
  });

  it('returns goalsMet=false when goals list is empty', () => {
    const decision = decideRoundOutcome({
      roundMetrics: overall({ accuracy: 0.95 }),
      bestMetrics: overall({ accuracy: 0.9 }),
      goals: [],
    });
    expect(decision.goalsMet).toBe(false);
    expect(decision.isBest).toBe(false); // isBetterThan returns false on empty goals
  });

  it('evaluates goal progress against the new best (not the round) when round regresses', () => {
    const decision = decideRoundOutcome({
      roundMetrics: overall({ accuracy: 0.5 }),
      bestMetrics: overall({ accuracy: 0.95 }),
      goals: [accGoal(0.9)],
    });
    expect(decision.isBest).toBe(false);
    expect(decision.goalsMet).toBe(true);
    expect(decision.goalProgress[0]?.observed).toBe(0.95);
  });
});

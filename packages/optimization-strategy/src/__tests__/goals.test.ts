import { describe, expect, it } from 'vitest';
import { allGoalsMet, evaluateGoals } from '../loop/goals';
import type { OptimizationGoal, MetricSnapshot } from '../loop/types';

const overall = (overall: Record<string, number>): MetricSnapshot => ({ overall });
const withClass = (overall: Record<string, number>, perClass: Record<string, Record<string, number>>): MetricSnapshot => ({
  overall,
  perClass,
});

describe('evaluateGoals', () => {
  it('returns achieved=true when overall metric meets >= target', () => {
    const goals: OptimizationGoal[] = [{ metric: 'accuracy', op: '>=', value: 0.9, scope: { kind: 'overall' } }];
    const entries = evaluateGoals(goals, overall({ accuracy: 0.92 }));
    expect(entries[0]).toEqual({ goal: goals[0], observed: 0.92, achieved: true });
  });

  it('returns achieved=false when overall metric falls below >= target', () => {
    const goals: OptimizationGoal[] = [{ metric: 'accuracy', op: '>=', value: 0.9, scope: { kind: 'overall' } }];
    const entries = evaluateGoals(goals, overall({ accuracy: 0.8 }));
    expect(entries[0]?.achieved).toBe(false);
    expect(entries[0]?.observed).toBe(0.8);
  });

  it('handles op="<=" by checking observed <= target', () => {
    const goals: OptimizationGoal[] = [{ metric: 'false_positive_rate', op: '<=', value: 0.05, scope: { kind: 'overall' } }];
    expect(evaluateGoals(goals, overall({ false_positive_rate: 0.04 }))[0]?.achieved).toBe(true);
    expect(evaluateGoals(goals, overall({ false_positive_rate: 0.06 }))[0]?.achieved).toBe(false);
  });

  it('handles op=">" (strict) — equal value is NOT achieved', () => {
    const goals: OptimizationGoal[] = [{ metric: 'f1', op: '>', value: 0.85, scope: { kind: 'overall' } }];
    expect(evaluateGoals(goals, overall({ f1: 0.85 }))[0]?.achieved).toBe(false);
    expect(evaluateGoals(goals, overall({ f1: 0.86 }))[0]?.achieved).toBe(true);
  });

  it('reads per-class metrics when scope=class', () => {
    const goals: OptimizationGoal[] = [{ metric: 'recall', op: '>=', value: 0.8, scope: { kind: 'class', label: 'positive' } }];
    const metrics = withClass({}, { positive: { recall: 0.85 }, negative: { recall: 0.5 } });
    expect(evaluateGoals(goals, metrics)[0]?.achieved).toBe(true);
  });

  it('marks observed=null + achieved=false when metric is missing in scope', () => {
    const goals: OptimizationGoal[] = [{ metric: 'accuracy', op: '>=', value: 0.9, scope: { kind: 'overall' } }];
    const entries = evaluateGoals(goals, overall({ f1: 0.95 }));
    expect(entries[0]).toEqual({ goal: goals[0], observed: null, achieved: false });
  });

  it('marks observed=null when class scope key is missing entirely', () => {
    const goals: OptimizationGoal[] = [{ metric: 'recall', op: '>=', value: 0.8, scope: { kind: 'class', label: 'missing_class' } }];
    const entries = evaluateGoals(goals, withClass({}, { positive: { recall: 0.9 } }));
    expect(entries[0]?.observed).toBeNull();
    expect(entries[0]?.achieved).toBe(false);
  });
});

describe('allGoalsMet', () => {
  it('returns true only when every goal is achieved', () => {
    const goals: OptimizationGoal[] = [
      { metric: 'accuracy', op: '>=', value: 0.9, scope: { kind: 'overall' } },
      { metric: 'recall', op: '>=', value: 0.8, scope: { kind: 'class', label: 'positive' } },
    ];
    expect(allGoalsMet(goals, withClass({ accuracy: 0.92 }, { positive: { recall: 0.85 } }))).toBe(true);
    expect(allGoalsMet(goals, withClass({ accuracy: 0.92 }, { positive: { recall: 0.7 } }))).toBe(false);
  });

  it('returns false when goals array is empty (no goals = nothing to declare success)', () => {
    expect(allGoalsMet([], overall({ accuracy: 1.0 }))).toBe(false);
  });
});

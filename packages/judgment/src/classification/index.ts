// V1 classification judgment strategy registration + entrypoint
// See docs/specs/24-experiments.md §7 + docs/specs/07-code-structure.md §12.2
import { getJudgment, registerJudgment } from '../registry';
import type { JudgmentContext, JudgmentOutcome } from '../types';
import { containsStrategy, equalsStrategy, exactMatchStrategy } from './expected-output';
import { enumMatchStrategy } from './enum-match';
import { thresholdStrategy } from './threshold';

registerJudgment(exactMatchStrategy);
registerJudgment(containsStrategy);
registerJudgment(equalsStrategy);
registerJudgment(enumMatchStrategy);
registerJudgment(thresholdStrategy);

const CLASSIFICATION_MODE_ALIASES: Record<string, string> = {
  exact: 'exact_match',
  exact_match: 'exact_match',
  exactmatch: 'exact_match',
  match: 'exact_match',
  contains: 'contains',
  include: 'contains',
  includes: 'contains',
  equals: 'equals',
  equal: 'equals',
  deep_equal: 'equals',
  enum: 'enum_match',
  enum_match: 'enum_match',
  threshold: 'threshold',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readFirstRule(rules: Record<string, unknown>): Record<string, unknown> | null {
  const rawRules = rules['rules'];
  if (!Array.isArray(rawRules)) return null;
  return rawRules.find((rule): rule is Record<string, unknown> => isRecord(rule)) ?? null;
}

function readMode(context: JudgmentContext): string {
  const rules = (context.judgmentRules as Record<string, unknown> | null) ?? {};
  const firstRule = readFirstRule(rules);
  const rawMode = rules['mode'] ?? rules['operator'] ?? firstRule?.['operator'] ?? firstRule?.['mode'];
  if (typeof rawMode !== 'string' || rawMode.trim().length === 0) return 'exact_match';
  return CLASSIFICATION_MODE_ALIASES[rawMode.trim().toLowerCase()] ?? 'exact_match';
}

export function evaluateClassificationJudgment(parsedOutput: unknown, context: JudgmentContext): JudgmentOutcome {
  try {
    const strategy = getJudgment('classification', readMode(context));
    return strategy.evaluate(parsedOutput, context);
  } catch {
    return { decisionOutput: null, isCorrect: null, judgmentStatus: 'judge_error' };
  }
}

export { containsStrategy, equalsStrategy, exactMatchStrategy } from './expected-output';
export { enumMatchStrategy } from './enum-match';
export { thresholdStrategy } from './threshold';

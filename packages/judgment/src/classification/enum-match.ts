// Enum match: requires decision to be in the enum set declared by output_schema, then compares against the expected output
// See docs/specs/24-experiments.md §7
import type { JudgmentContext, JudgmentOutcome, JudgmentStrategy } from '../types';
import { extractDecisionValue, readDecisionField } from './expected-output';

const ENUM_DELIMITERS = /\s*(?:或|or|\||,|、|\/)\s*/iu;

export function parseEnumValues(rawValue: unknown): string[] {
  if (rawValue === null || rawValue === undefined) return [];
  if (Array.isArray(rawValue)) return rawValue.map((v) => String(v).trim()).filter((v) => v.length > 0);
  if (typeof rawValue !== 'string') return [];
  return rawValue
    .split(ENUM_DELIMITERS)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function readEnumFromSchema(context: JudgmentContext, decisionField: string): string[] {
  const schema = context.outputSchema as { fields?: unknown[] } | null;
  const fields = Array.isArray(schema?.fields) ? schema!.fields : [];
  const target = fields.find((field) => {
    if (field == null || typeof field !== 'object') return false;
    const f = field as Record<string, unknown>;
    return f['key'] === decisionField && f['isJudgment'] === true;
  });
  if (!target || typeof target !== 'object') return [];
  return parseEnumValues((target as Record<string, unknown>)['value']);
}

function caseFold(value: string): string {
  return value.trim().toLowerCase();
}

export const enumMatchStrategy: JudgmentStrategy = {
  projectType: 'classification',
  ruleName: 'enum_match',
  evaluate(parsed, context): JudgmentOutcome {
    const decisionField = readDecisionField(context);
    const decisionOutput = extractDecisionValue(parsed, decisionField);
    if (decisionOutput === null) {
      return { decisionOutput: null, isCorrect: null, judgmentStatus: 'parse_error' };
    }

    const enumValues = readEnumFromSchema(context, decisionField);
    if (enumValues.length > 0) {
      const decisionFolded = caseFold(decisionOutput);
      const inEnum = enumValues.some((v) => caseFold(v) === decisionFolded);
      if (!inEnum) {
        return { decisionOutput, isCorrect: false, judgmentStatus: 'parse_error' };
      }
    }

    if (context.expectedOutput === undefined || context.expectedOutput === null) {
      return { decisionOutput, isCorrect: null, judgmentStatus: 'judge_error' };
    }
    const expected = String(context.expectedOutput);
    const isCorrect = caseFold(decisionOutput) === caseFold(expected);
    return { decisionOutput, isCorrect, judgmentStatus: isCorrect ? 'correct' : 'incorrect' };
  },
};

import { describe, expect, it } from 'vitest';
import { enumMatchStrategy, parseEnumValues } from './enum-match';

const context = {
  outputSchema: { fields: [{ key: 'label', value: 'positive 或 negative', isJudgment: true }] },
  judgmentRules: { mode: 'enum_match', decision_field: 'label', expected_field: 'expected_output' },
  expectedOutput: 'positive',
};

describe('parseEnumValues', () => {
  it('splits on Chinese "或"', () => {
    expect(parseEnumValues('positive 或 negative')).toEqual(['positive', 'negative']);
  });

  it('splits on English "or"', () => {
    expect(parseEnumValues('A or B or C')).toEqual(['A', 'B', 'C']);
  });

  it('splits on slash and pipe', () => {
    expect(parseEnumValues('alpha/beta|gamma')).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('accepts arrays directly', () => {
    expect(parseEnumValues(['x', 'y'])).toEqual(['x', 'y']);
  });
});

describe('enumMatchStrategy', () => {
  it('marks decision outside enum set as parse_error', () => {
    const out = enumMatchStrategy.evaluate({ label: 'maybe' }, context);
    expect(out.judgmentStatus).toBe('parse_error');
    expect(out.isCorrect).toBe(false);
    expect(out.decisionOutput).toBe('maybe');
  });

  it('marks decision in enum + matches expected as correct', () => {
    const out = enumMatchStrategy.evaluate({ label: 'positive' }, context);
    expect(out.judgmentStatus).toBe('correct');
    expect(out.isCorrect).toBe(true);
  });

  it('marks decision in enum but mismatches expected as incorrect', () => {
    const out = enumMatchStrategy.evaluate({ label: 'negative' }, context);
    expect(out.judgmentStatus).toBe('incorrect');
    expect(out.isCorrect).toBe(false);
  });
});

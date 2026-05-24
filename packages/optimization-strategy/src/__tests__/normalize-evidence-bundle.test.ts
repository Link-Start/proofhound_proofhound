import { describe, expect, it } from 'vitest';
import {
  normalizeEvidenceBundle,
  type AnalysisPattern,
  type SuggestedChange,
} from '../error-pattern-analysis/parse';

const basePattern = (over: Partial<AnalysisPattern>): AnalysisPattern => ({
  label: 'p',
  count: 1,
  reason: '',
  exampleSampleIds: [],
  ...over,
});

const baseChange = (over: Partial<SuggestedChange>): SuggestedChange => ({
  section: 'section',
  change: 'do x',
  rationale: '',
  ...over,
});

describe('normalizeEvidenceBundle', () => {
  it('fills source / bucketKey / patternId on patterns when LLM omitted them', () => {
    const { errorPatterns } = normalizeEvidenceBundle(
      {
        errorPatterns: [basePattern({ label: 'l1', count: 2 })],
        suggestedChanges: [],
      },
      { source: 'confusion', bucketKey: 'A→B', affectedCountFallback: 5 },
    );
    expect(errorPatterns[0]?.source).toBe('confusion');
    expect(errorPatterns[0]?.bucketKey).toBe('A→B');
    expect(errorPatterns[0]?.patternId).toMatch(/^confusion:a-b:p1/);
    expect(errorPatterns[0]?.affectedCount).toBe(2);
  });

  it('preserves caller-provided ID / source / bucketKey / affectedCount', () => {
    const { errorPatterns } = normalizeEvidenceBundle(
      {
        errorPatterns: [
          basePattern({
            patternId: 'custom-id',
            source: 'regression',
            bucketKey: 'predicted=X',
            affectedCount: 42,
          }),
        ],
        suggestedChanges: [],
      },
      { source: 'confusion', bucketKey: 'A→B', affectedCountFallback: 5 },
    );
    expect(errorPatterns[0]?.patternId).toBe('custom-id');
    expect(errorPatterns[0]?.source).toBe('regression');
    expect(errorPatterns[0]?.bucketKey).toBe('predicted=X');
    expect(errorPatterns[0]?.affectedCount).toBe(42);
  });

  it('uses affectedCountFallback when neither affectedCount nor count is given', () => {
    const { errorPatterns } = normalizeEvidenceBundle(
      {
        errorPatterns: [
          { label: 'l', count: 0, reason: '', exampleSampleIds: [] } as AnalysisPattern,
        ],
        suggestedChanges: [],
      },
      { source: 'confusion', bucketKey: 'A→B', affectedCountFallback: 9 },
    );
    expect(errorPatterns[0]?.affectedCount).toBe(0);
  });

  it('derives empty addressesPatternIds from batch patternIds', () => {
    const { errorPatterns, suggestedChanges } = normalizeEvidenceBundle(
      {
        errorPatterns: [
          basePattern({ label: 'l1', count: 1 }),
          basePattern({ label: 'l2', count: 1 }),
        ],
        suggestedChanges: [baseChange({ section: 's', change: 'c' })],
      },
      { source: 'confusion', bucketKey: 'A→B', affectedCountFallback: 0 },
    );
    expect(suggestedChanges[0]?.addressesPatternIds).toEqual(errorPatterns.map((p) => p.patternId));
  });

  it('derives empty evidenceSampleIds from union of pattern exampleSampleIds (deduped)', () => {
    const { suggestedChanges } = normalizeEvidenceBundle(
      {
        errorPatterns: [
          basePattern({ exampleSampleIds: ['s1', 's2'] }),
          basePattern({ exampleSampleIds: ['s2', 's3'] }),
        ],
        suggestedChanges: [baseChange({})],
      },
      { source: 'confusion', bucketKey: 'A→B', affectedCountFallback: 0 },
    );
    expect(suggestedChanges[0]?.evidenceSampleIds).toEqual(['s1', 's2', 's3']);
  });

  it('keeps caller-provided addressesPatternIds / evidenceSampleIds untouched', () => {
    const { suggestedChanges } = normalizeEvidenceBundle(
      {
        errorPatterns: [basePattern({ exampleSampleIds: ['s1'] })],
        suggestedChanges: [
          baseChange({
            addressesPatternIds: ['only-this'],
            evidenceSampleIds: ['s99'],
            affectedCount: 7,
          }),
        ],
      },
      { source: 'regression', bucketKey: 'predicted=Y', affectedCountFallback: 0 },
    );
    expect(suggestedChanges[0]?.addressesPatternIds).toEqual(['only-this']);
    expect(suggestedChanges[0]?.evidenceSampleIds).toEqual(['s99']);
    expect(suggestedChanges[0]?.affectedCount).toBe(7);
  });

  it('falls back to affectedCountFallback when patterns contribute 0 affected count', () => {
    const { suggestedChanges } = normalizeEvidenceBundle(
      {
        errorPatterns: [],
        suggestedChanges: [baseChange({})],
      },
      { source: 'confusion', bucketKey: 'A→B', affectedCountFallback: 11 },
    );
    expect(suggestedChanges[0]?.affectedCount).toBe(11);
  });
});

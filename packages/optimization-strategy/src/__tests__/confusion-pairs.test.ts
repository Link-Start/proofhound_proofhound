import { describe, expect, it } from 'vitest';
import {
  buildConfusionPairs,
  buildRegressionGroups,
} from '../error-pattern-analysis/confusion-pairs';
import type { FieldWhitelist, RunResultRecord, SampleRecord } from '../loop/types';

const whitelist: FieldWhitelist = {
  promptVariables: ['text'],
  analysisOnlyFields: ['secret_id'],
};

const samples: SampleRecord[] = [
  { id: 's1', input: { text: 'foo', secret_id: 'x1', metadata: 'm' }, expected: 'A' },
  { id: 's2', input: { text: 'bar', secret_id: 'x2', metadata: 'm' }, expected: 'B' },
  { id: 's3', input: { text: 'baz', secret_id: 'x3', metadata: 'm' }, expected: 'A' },
  { id: 's4', input: { text: 'qux', secret_id: 'x4', metadata: 'm' }, expected: 'B' },
  { id: 's5', input: { text: 'aaa', secret_id: 'x5', metadata: 'm' }, expected: 'B' },
  { id: 's6', input: { text: 'bbb', secret_id: 'x6', metadata: 'm' }, expected: 'C' },
];

describe('buildConfusionPairs', () => {
  it('groups failures by (expected, predicted) and sorts by count desc', () => {
    const runResults: RunResultRecord[] = [
      { id: 'r1', sampleId: 's2', decisionOutput: 'A', isCorrect: false }, // B→A
      { id: 'r2', sampleId: 's4', decisionOutput: 'A', isCorrect: false }, // B→A
      { id: 'r3', sampleId: 's5', decisionOutput: 'A', isCorrect: false }, // B→A
      { id: 'r4', sampleId: 's1', decisionOutput: 'B', isCorrect: false }, // A→B
      { id: 'r5', sampleId: 's6', decisionOutput: 'A', isCorrect: false }, // C→A
    ];
    const pairs = buildConfusionPairs({
      runResults,
      samples,
      whitelist,
      topN: 5,
      maxSamplesPerPair: 10,
    });
    expect(pairs).toHaveLength(3);
    expect(pairs[0]).toMatchObject({ expected: 'B', predicted: 'A', count: 3 });
    expect(pairs[1]?.count).toBe(1);
    expect(pairs[2]?.count).toBe(1);
  });

  it('limits to topN', () => {
    const runResults: RunResultRecord[] = [
      { id: 'r1', sampleId: 's2', decisionOutput: 'A', isCorrect: false },
      { id: 'r2', sampleId: 's4', decisionOutput: 'A', isCorrect: false },
      { id: 'r3', sampleId: 's1', decisionOutput: 'B', isCorrect: false },
      { id: 'r4', sampleId: 's6', decisionOutput: 'A', isCorrect: false },
    ];
    const pairs = buildConfusionPairs({ runResults, samples, whitelist, topN: 2, maxSamplesPerPair: 10 });
    expect(pairs).toHaveLength(2);
  });

  it('caps samples per pair to maxSamplesPerPair (count still accurate)', () => {
    const runResults: RunResultRecord[] = [
      { id: 'r1', sampleId: 's2', decisionOutput: 'A', isCorrect: false },
      { id: 'r2', sampleId: 's4', decisionOutput: 'A', isCorrect: false },
      { id: 'r3', sampleId: 's5', decisionOutput: 'A', isCorrect: false },
    ];
    const pairs = buildConfusionPairs({ runResults, samples, whitelist, topN: 5, maxSamplesPerPair: 2 });
    expect(pairs[0]?.count).toBe(3);
    expect(pairs[0]?.samples).toHaveLength(2);
    expect(pairs[0]?.sampleIds).toHaveLength(3);
  });

  it('projects sample input by promptVariables ∪ analysisOnlyFields — strips other fields', () => {
    const runResults: RunResultRecord[] = [
      { id: 'r1', sampleId: 's2', decisionOutput: 'A', isCorrect: false },
    ];
    const pairs = buildConfusionPairs({ runResults, samples, whitelist, topN: 5, maxSamplesPerPair: 5 });
    const view = pairs[0]?.samples[0];
    expect(view?.inputForAnalysis).toEqual({ text: 'bar', secret_id: 'x2' });
    expect(view?.inputForAnalysis).not.toHaveProperty('metadata');
  });

  it('skips isCorrect=true or missing expected/predicted', () => {
    const runResults: RunResultRecord[] = [
      { id: 'r1', sampleId: 's1', decisionOutput: 'A', isCorrect: true }, // correct
      { id: 'r2', sampleId: 's2', decisionOutput: null, isCorrect: false }, // no predicted
      { id: 'r3', sampleId: 'unknown', decisionOutput: 'A', isCorrect: false }, // no sample
    ];
    const pairs = buildConfusionPairs({ runResults, samples, whitelist, topN: 5, maxSamplesPerPair: 5 });
    expect(pairs).toHaveLength(0);
  });
});

describe('buildRegressionGroups', () => {
  it('returns [] when previousRunResults is null', () => {
    const currentRunResults: RunResultRecord[] = [
      { id: 'r1', sampleId: 's2', decisionOutput: 'A', isCorrect: false },
    ];
    const groups = buildRegressionGroups({
      currentRunResults,
      previousRunResults: null,
      samples,
      whitelist,
      maxSamples: 20,
    });
    expect(groups).toEqual([]);
  });

  it('finds samples that were correct in previous round but failed in current', () => {
    const previousRunResults: RunResultRecord[] = [
      { id: 'pr2', sampleId: 's2', decisionOutput: 'B', isCorrect: true }, // was correct
      { id: 'pr4', sampleId: 's4', decisionOutput: 'B', isCorrect: true }, // was correct
      { id: 'pr1', sampleId: 's1', decisionOutput: 'A', isCorrect: true }, // was correct, still correct
    ];
    const currentRunResults: RunResultRecord[] = [
      { id: 'r2', sampleId: 's2', decisionOutput: 'A', isCorrect: false }, // regression
      { id: 'r4', sampleId: 's4', decisionOutput: 'A', isCorrect: false }, // regression
      { id: 'r1', sampleId: 's1', decisionOutput: 'A', isCorrect: true }, // not regression
    ];
    const groups = buildRegressionGroups({
      currentRunResults,
      previousRunResults,
      samples,
      whitelist,
      maxSamples: 20,
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ predicted: 'A', count: 2 });
    expect(groups[0]?.samples.map((s) => s.sampleId).sort()).toEqual(['s2', 's4']);
  });

  it('skips samples that were also failed in previous round (not regression)', () => {
    const previousRunResults: RunResultRecord[] = [
      { id: 'pr2', sampleId: 's2', decisionOutput: 'A', isCorrect: false },
    ];
    const currentRunResults: RunResultRecord[] = [
      { id: 'r2', sampleId: 's2', decisionOutput: 'A', isCorrect: false },
    ];
    const groups = buildRegressionGroups({
      currentRunResults,
      previousRunResults,
      samples,
      whitelist,
      maxSamples: 20,
    });
    expect(groups).toEqual([]);
  });

  it('caps total regression samples to maxSamples', () => {
    const previousRunResults: RunResultRecord[] = samples.map((s) => ({
      id: `pr_${s.id}`,
      sampleId: s.id,
      decisionOutput: String(s.expected),
      isCorrect: true,
    }));
    const currentRunResults: RunResultRecord[] = samples.map((s) => ({
      id: `r_${s.id}`,
      sampleId: s.id,
      decisionOutput: 'A',
      isCorrect: false,
    }));
    const groups = buildRegressionGroups({
      currentRunResults,
      previousRunResults,
      samples,
      whitelist,
      maxSamples: 3,
    });
    const totalSamples = groups.reduce((sum, g) => sum + g.samples.length, 0);
    expect(totalSamples).toBe(3);
  });
});

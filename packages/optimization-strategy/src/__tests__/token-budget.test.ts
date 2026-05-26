import { describe, expect, it } from 'vitest';
import {
  TRUNCATION_MARKER,
  computeSampleBudget,
  estimateMessagesTokens,
  fitSamplesToBudget,
  truncateLongText,
  truncateStringFields,
} from '../error-pattern-analysis/token-budget';

describe('estimateMessagesTokens', () => {
  it('returns input + output + total', () => {
    const r = estimateMessagesTokens('system text', 'user text', 1024);
    expect(r.inputTokens).toBeGreaterThan(0);
    expect(r.outputTokens).toBe(1024);
    expect(r.totalTokens).toBe(r.inputTokens + r.outputTokens);
  });

  it('zero output budget when maxOutput=0', () => {
    const r = estimateMessagesTokens('s', 'u', 0);
    expect(r.outputTokens).toBe(0);
  });
});

describe('computeSampleBudget', () => {
  it('returns max - baseline', () => {
    expect(computeSampleBudget(1000, 300)).toBe(700);
  });
  it('floors to 0 if baseline > max', () => {
    expect(computeSampleBudget(100, 500)).toBe(0);
  });
});

describe('fitSamplesToBudget', () => {
  // 1 token ~= 4 chars；20 char string ≈ 5 tokens
  const sample = (id: string, payload: string) => ({ id, payload });

  it('fits all when budget is generous', () => {
    const samples = [sample('s1', 'short'), sample('s2', 'short')];
    const r = fitSamplesToBudget(samples, 10_000);
    expect(r.fitted).toHaveLength(2);
    expect(r.dropped).toHaveLength(0);
  });

  it('drops tail when budget is tight', () => {
    const big = (id: string) => sample(id, 'x'.repeat(400)); // ~100 tokens each
    const samples = [big('a'), big('b'), big('c'), big('d')];
    const r = fitSamplesToBudget(samples, 200, 0); // ~200 token budget = ~2 samples
    expect(r.fitted.length).toBeLessThan(4);
    expect(r.dropped.length).toBeGreaterThan(0);
    expect(r.fitted.length + r.dropped.length).toBe(4);
  });

  it('respects minSamples even if budget exceeded', () => {
    const big = (id: string) => sample(id, 'x'.repeat(4000));
    const samples = [big('a'), big('b'), big('c')];
    const r = fitSamplesToBudget(samples, 10, 2); // Budget too small but minSamples=2
    expect(r.fitted).toHaveLength(2);
    expect(r.dropped).toHaveLength(1);
  });

  it('returns empty when input is empty', () => {
    expect(fitSamplesToBudget([], 1000)).toEqual({ fitted: [], dropped: [], estimatedTokens: 0 });
  });
});

describe('truncateStringFields', () => {
  it('truncates long strings with marker', () => {
    const long = 'a'.repeat(200);
    const result = truncateStringFields({ x: long }, 50);
    expect(result.x).toBe('a'.repeat(50) + TRUNCATION_MARKER);
  });

  it('keeps short strings intact', () => {
    expect(truncateStringFields({ x: 'short' }, 50)).toEqual({ x: 'short' });
  });

  it('recurses into nested objects + arrays', () => {
    const long = 'b'.repeat(100);
    const input = { outer: { inner: long, list: [long, 'ok'] } };
    const r = truncateStringFields(input, 10);
    expect(r.outer.inner.startsWith('bbbbbbbbbb')).toBe(true);
    expect(r.outer.inner).toContain(TRUNCATION_MARKER);
    expect(r.outer.list[0]).toContain(TRUNCATION_MARKER);
    expect(r.outer.list[1]).toBe('ok');
  });

  it('leaves null / number / boolean unchanged', () => {
    expect(truncateStringFields({ a: null, b: 42, c: true }, 5)).toEqual({ a: null, b: 42, c: true });
  });
});

describe('truncateLongText', () => {
  it('returns input when within budget', () => {
    expect(truncateLongText('short', 100)).toBe('short');
  });

  it('keeps head + tail with marker in middle', () => {
    const long = '1'.repeat(50) + '2'.repeat(50) + '3'.repeat(50);
    const r = truncateLongText(long, 60);
    expect(r).toContain(TRUNCATION_MARKER);
    expect(r.length).toBeLessThanOrEqual(60);
    expect(r.startsWith('1')).toBe(true); // head kept
    expect(r.endsWith('3')).toBe(true); // tail kept
  });
});

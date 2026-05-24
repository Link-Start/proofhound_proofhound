import { describe, expect, it } from 'vitest';
import { isRunResultFailure } from './run-result-failure';

describe('isRunResultFailure', () => {
  it('uses the shared run-result failure definition', () => {
    expect(isRunResultFailure('success', 'correct')).toBe(false);
    expect(isRunResultFailure('success', 'incorrect')).toBe(false);
    expect(isRunResultFailure('error', null)).toBe(true);
    expect(isRunResultFailure('timeout', null)).toBe(true);
    expect(isRunResultFailure('rate_limited', null)).toBe(true);
    expect(isRunResultFailure('success', 'parse_error')).toBe(true);
    expect(isRunResultFailure('success', 'judge_error')).toBe(true);
    expect(isRunResultFailure('success', 'judge_error', 'expected')).toBe(true);
    expect(isRunResultFailure('success', 'judge_error', null)).toBe(false);
    expect(isRunResultFailure('success', 'incorrect', 'expected')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { parseJsonResponseWithMarkdownFallback } from './json-parse';

describe('parseJsonResponseWithMarkdownFallback', () => {
  it('parses strict JSON first', () => {
    expect(parseJsonResponseWithMarkdownFallback('{"expected_output":"negative"}')).toEqual({
      expected_output: 'negative',
    });
  });

  it('falls back to a markdown JSON code fence', () => {
    expect(
      parseJsonResponseWithMarkdownFallback('```json\n{\n  "expected_output": "negative"\n}\n```'),
    ).toEqual({
      expected_output: 'negative',
    });
  });

  it('returns null when strict JSON and markdown JSON parsing both fail', () => {
    expect(parseJsonResponseWithMarkdownFallback('```json\n{bad json}\n```')).toBeNull();
    expect(parseJsonResponseWithMarkdownFallback('not json')).toBeNull();
  });
});

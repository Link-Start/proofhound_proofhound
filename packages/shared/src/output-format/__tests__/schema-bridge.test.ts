import { describe, expect, it } from 'vitest';
import { outputSchemaToJsonSchema } from '../schema-bridge';

describe('outputSchemaToJsonSchema', () => {
  it('returns undefined for null / undefined', () => {
    expect(outputSchemaToJsonSchema(null)).toBeUndefined();
    expect(outputSchemaToJsonSchema(undefined)).toBeUndefined();
  });

  it('returns undefined for empty fields array', () => {
    expect(outputSchemaToJsonSchema({ fields: [] })).toBeUndefined();
  });

  it('converts single-field DTO to JSON Schema with description', () => {
    const result = outputSchemaToJsonSchema({
      fields: [{ key: 'label', value: 'positive 或 negative', isJudgment: true }],
    });

    expect(result).toEqual({
      type: 'object',
      properties: {
        label: { type: 'string', description: 'positive 或 negative' },
      },
      required: ['label'],
      additionalProperties: false,
    });
  });

  it('does NOT filter isJudgment fields (matches experiment.renderer current behavior)', () => {
    const result = outputSchemaToJsonSchema({
      fields: [
        { key: 'label', value: 'positive 或 negative', isJudgment: true },
        { key: 'reason', value: '判定理由', isJudgment: false },
      ],
    });

    expect(result?.properties).toHaveProperty('label');
    expect(result?.properties).toHaveProperty('reason');
    expect(result?.required).toEqual(['label', 'reason']);
  });

  it('sets description undefined when value is empty string', () => {
    const result = outputSchemaToJsonSchema({
      fields: [{ key: 'label', value: '', isJudgment: false }],
    });

    expect(result?.properties.label).toEqual({ type: 'string', description: undefined });
  });

  it('passes through existing JSON Schema shape', () => {
    const input = {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: ['A', 'B'] },
      },
      required: ['decision'],
      additionalProperties: false,
    };
    const result = outputSchemaToJsonSchema(input);

    expect(result?.type).toBe('object');
    expect(result?.properties).toBe(input.properties);
    expect(result?.required).toEqual(['decision']);
    expect(result?.additionalProperties).toBe(false);
  });

  it('infers required from properties keys when missing on JSON Schema input', () => {
    const result = outputSchemaToJsonSchema({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
    });

    expect(result?.required).toEqual(['a', 'b']);
    expect(result?.additionalProperties).toBe(false);
  });

  it('returns undefined for unrecognized shapes', () => {
    expect(outputSchemaToJsonSchema('string-input')).toBeUndefined();
    expect(outputSchemaToJsonSchema(['array'])).toBeUndefined();
    expect(outputSchemaToJsonSchema({})).toBeUndefined();
    expect(outputSchemaToJsonSchema({ unrelated: true })).toBeUndefined();
  });
});

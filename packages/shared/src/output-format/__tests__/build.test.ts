import { describe, expect, it } from 'vitest';
import { buildOutputFormatInstruction, composeFullPrompt } from '../build';

describe('buildOutputFormatInstruction', () => {
  it('returns empty string when schema is missing', () => {
    expect(buildOutputFormatInstruction(undefined)).toBe('');
    expect(buildOutputFormatInstruction(null)).toBe('');
  });

  it('emits enum labels as <a | b | c> placeholder + 字段说明 for object schema', () => {
    const schema = {
      type: 'object',
      properties: {
        sentiment: { enum: ['positive', 'negative'], description: '情感判定' },
      },
    };
    const text = buildOutputFormatInstruction(schema);

    expect(text).toContain('## 输出格式');
    expect(text).toContain('"sentiment": <positive | negative>');
    expect(text).toContain('枚举值，必须是以下之一：`positive` / `negative`');
    expect(text).toContain('情感判定');
    expect(text).not.toContain('必填');
    expect(text).not.toContain('可选');
  });

  it('handles non-enum scalar fields with type-based placeholders without optional markers', () => {
    const schema = {
      type: 'object',
      properties: {
        decision: { enum: ['A', 'B'] },
        confidence: { type: 'number', description: '0-1 之间' },
        notes: { type: 'string' },
      },
    };
    const text = buildOutputFormatInstruction(schema);

    expect(text).toContain('"decision": <A | B>');
    expect(text).toContain('"confidence": <number>');
    expect(text).toContain('"notes": <string>');
    expect(text).toMatch(/`decision`：.*枚举值/);
    expect(text).toMatch(/`confidence`：.*类型 `number`；0-1 之间/);
    expect(text).toMatch(/`notes`：.*类型 `string`/);
    expect(text).not.toContain('必填');
    expect(text).not.toContain('可选');
  });

  it('emits trailing comma between fields and no trailing comma on last field', () => {
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'string' },
        b: { type: 'string' },
      },
    };
    const text = buildOutputFormatInstruction(schema);

    expect(text).toContain('"a": <string>,');
    expect(text).toContain('"b": <string>');
    expect(text).not.toContain('"b": <string>,');
  });

  it('falls back to raw JSON Schema dump when shape is not a recognized object schema', () => {
    const schema = { kind: 'custom', fields: [{ name: 'x' }] };
    const text = buildOutputFormatInstruction(schema);

    expect(text).toContain('## 输出格式');
    expect(text).toContain('JSON Schema');
    expect(text).toContain('"kind": "custom"');
  });

  it('handles array type with item placeholder', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    const text = buildOutputFormatInstruction(schema);
    expect(text).toContain('"tags": [<string>, ...]');
  });

  it('omits 字段说明 block but still returns 输出格式 when properties are empty', () => {
    const text = buildOutputFormatInstruction({ type: 'object', properties: {} });
    expect(text).toContain('## 输出格式');
    expect(text).toContain('合法 JSON 对象');
    expect(text).not.toContain('字段说明：');
  });

  it('emits English output-format instructions when language is en-US', () => {
    const schema = {
      type: 'object',
      properties: {
        label: { enum: ['refund', 'shipping'], description: 'Intent label' },
        confidence: { type: 'number' },
      },
    };
    const text = buildOutputFormatInstruction(schema, { language: 'en-US' });

    expect(text).toContain('## Output Format');
    expect(text).toContain('Output only a JSON object');
    expect(text).toContain('"label": <refund | shipping>');
    expect(text).toContain('Field descriptions:');
    expect(text).toContain('Enum value; must be one of: `refund` / `shipping`');
    expect(text).toContain('`confidence`: Type `number`');
    expect(text).not.toContain('## 输出格式');
  });
});

describe('composeFullPrompt', () => {
  it('appends output format section separated by blank line', () => {
    const body = '判断 {{review_text}} 的情感';
    const schema = {
      type: 'object',
      properties: { sentiment: { enum: ['positive', 'negative'] } },
    };
    const full = composeFullPrompt(body, schema);

    expect(full.startsWith('判断 {{review_text}} 的情感')).toBe(true);
    expect(full).toContain('\n\n## 输出格式');
    expect(full).toContain('<positive | negative>');
  });

  it('returns body unchanged when outputSchema is missing', () => {
    expect(composeFullPrompt('hello', undefined)).toBe('hello');
    expect(composeFullPrompt('hello', null)).toBe('hello');
  });

  it('trims trailing whitespace from body before appending', () => {
    const full = composeFullPrompt('body\n\n\n', {
      type: 'object',
      properties: { x: { type: 'string' } },
    });
    expect(full).toContain('body\n\n## 输出格式');
  });

  it('appends the output format in the requested language', () => {
    const full = composeFullPrompt(
      'Classify {{ticket}}',
      {
        type: 'object',
        properties: { intent: { type: 'string' } },
      },
      { language: 'en-US' },
    );

    expect(full).toContain('Classify {{ticket}}\n\n## Output Format');
  });
});

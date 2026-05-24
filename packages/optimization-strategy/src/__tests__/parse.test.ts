// safeParseJson 容错路径测试 — 复现并验证 LLM JSON 输出常见非严格合规问题的修复
// 详见 plan 2026-05-20-23-49-08-731：Claude 在 ```json``` 代码块内输出长字符串时
// 常以真实换行代替 \n 转义，导致 strict JSON.parse 失败。
import { describe, expect, it } from 'vitest';
import { safeParseJson } from '../error-pattern-analysis/parse';

describe('safeParseJson', () => {
  it('fast path: parses already-valid JSON without repair', () => {
    const input = '{"a": 1, "b": "hello", "c": [1, 2, 3]}';
    expect(safeParseJson(input)).toEqual({ a: 1, b: 'hello', c: [1, 2, 3] });
  });

  it('repairs raw newlines inside a multi-line Chinese string literal (reported Claude case)', () => {
    // 真实生产报错复现：Claude opus 4.7 输出的 ```json``` 代码块里，newPromptBody
    // 字符串值含真实换行（不是 \n 转义），JSON.parse 直接抛错。
    const broken = `{
  "newPromptBody": "你是一名中文文本情感分析专家。

## 任务
判定情感倾向。

## 待判定评论
{{text}}",
  "variables": [{"name": "text", "type": "text", "required": true}],
  "outputSchema": {"fields": [{"key": "sentiment", "value": "positive | negative", "isJudgment": true}]},
  "changeSummary": "二分类情感任务"
}`;
    const out = safeParseJson(broken);
    expect(out).not.toBeNull();
    expect(typeof out).toBe('object');
    const obj = out as Record<string, unknown>;
    expect(typeof obj.newPromptBody).toBe('string');
    const body = obj.newPromptBody as string;
    expect(body).toContain('## 任务');
    expect(body).toContain('{{text}}');
    expect(obj.variables).toEqual([{ name: 'text', type: 'text', required: true }]);
    expect(obj.changeSummary).toBe('二分类情感任务');
  });

  it('repairs trailing commas', () => {
    expect(safeParseJson('{"a": 1, "b": 2,}')).toEqual({ a: 1, b: 2 });
    expect(safeParseJson('[1, 2, 3,]')).toEqual([1, 2, 3]);
  });

  it('repairs raw newlines inside nested object string literals', () => {
    const broken = `{
  "outputSchema": {
    "fields": [
      {
        "key": "decision",
        "description": "第一行
第二行
第三行",
        "isJudgment": true
      }
    ]
  }
}`;
    const out = safeParseJson(broken) as
      | { outputSchema: { fields: Array<{ description: string; isJudgment: boolean }> } }
      | null;
    expect(out).not.toBeNull();
    const desc = out!.outputSchema.fields[0]!.description;
    expect(desc).toContain('第一行');
    expect(desc).toContain('第三行');
    expect(out!.outputSchema.fields[0]!.isJudgment).toBe(true);
  });

  it('repairs single-quoted JSON-like input (another common LLM slip)', () => {
    expect(safeParseJson("{'a': 1, 'b': 'x'}")).toEqual({ a: 1, b: 'x' });
  });

  it('returns null when input cannot be repaired', () => {
    expect(safeParseJson('')).toBeNull();
  });
});

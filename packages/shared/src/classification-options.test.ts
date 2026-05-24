import { describe, expect, it } from 'vitest';
import {
  deriveClassificationOptionsFromAnnotationSchema,
  deriveClassificationOptionsFromPromptOutputSchema,
  deriveClassificationOptionsFromPromptVersionSnapshot,
  extractClassificationOptionsFromText,
  formatClassificationAnnotationValue,
  normalizeClassificationAnnotationValue,
  parseClassificationAnnotationValue,
} from './classification-options';

describe('classification options', () => {
  it('splits Chinese classification labels joined by 或', () => {
    expect(extractClassificationOptionsFromText('正向 或 负向 或 中立')).toEqual(['正向', '负向', '中立']);
  });

  it('splits common enum separators without losing CJK labels', () => {
    expect(extractClassificationOptionsFromText('类别：退款、物流，其他')).toEqual(['退款', '物流', '其他']);
  });

  it('reads quoted enum values', () => {
    expect(extractClassificationOptionsFromText('Enum: "refund" / "shipping" / "other"')).toEqual([
      'refund',
      'shipping',
      'other',
    ]);
  });

  it('collects categories from judgment fields only', () => {
    expect(
      deriveClassificationOptionsFromPromptOutputSchema({
        fields: [
          { key: 'label', value: '正确 或 错误', isJudgment: true },
          { key: 'reason', value: 'text', isJudgment: false },
        ],
      }),
    ).toEqual(['正确', '错误']);
  });

  it('derives categories from prompt version snapshots', () => {
    expect(
      deriveClassificationOptionsFromPromptVersionSnapshot({
        outputSchema: {
          fields: [{ key: 'topic', value: '账单 / 账号 / 技术支持', isJudgment: true }],
        },
      }),
    ).toEqual(['账单', '账号', '技术支持']);
  });

  it('reads expected_output options from annotation schema', () => {
    expect(
      deriveClassificationOptionsFromAnnotationSchema([
        {
          name: 'expected_output',
          type: 'select',
          options: ['退款', '物流'],
        },
      ]),
    ).toEqual(['退款', '物流']);
  });

  it('formats and parses a single annotation value', () => {
    const value = formatClassificationAnnotationValue('  退款  ');
    expect(value).toBe('退款');
    expect(normalizeClassificationAnnotationValue(value, ['退款', '物流'])).toBe('退款');
  });

  it('does not normalize combined annotation values as a single category', () => {
    expect(parseClassificationAnnotationValue('退款 或 物流')).toEqual(['退款', '物流']);
    expect(normalizeClassificationAnnotationValue('退款 或 物流', ['退款', '物流'])).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { promptVersionLabelNameSchema } from './prompt.dto';

describe('promptVersionLabelNameSchema', () => {
  it('accepts Chinese prompt version labels', () => {
    expect(promptVersionLabelNameSchema.safeParse('回归集').success).toBe(true);
    expect(promptVersionLabelNameSchema.safeParse('客户A:灰度-1').success).toBe(true);
  });

  it('keeps rejecting labels with unsupported separators or leading punctuation', () => {
    expect(promptVersionLabelNameSchema.safeParse('灰度 发布').success).toBe(false);
    expect(promptVersionLabelNameSchema.safeParse('-灰度').success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { DEV_EXPERIMENT_DATASETS } from './experiments';

describe('DEV_EXPERIMENT_DATASETS', () => {
  it('每个数据集的 sampleCount 必须等于实际 samples.length', () => {
    for (const fixture of DEV_EXPERIMENT_DATASETS) {
      expect(fixture.sampleCount, `${fixture.name} sampleCount 与 samples.length 不一致`).toBe(fixture.samples.length);
    }
  });

  it('每个数据集最多包含 1 个 expected_output 字段', () => {
    for (const fixture of DEV_EXPERIMENT_DATASETS) {
      const expectedOutputCount = fixture.fieldSchema.filter((field) => field.role === 'expected_output').length;
      expect(
        expectedOutputCount,
        `${fixture.name} 含 ${expectedOutputCount} 个 expected_output 字段`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('当前 dev 数据集存在并符合约束', () => {
    expect(DEV_EXPERIMENT_DATASETS.length).toBeGreaterThan(0);

    for (const dataset of DEV_EXPERIMENT_DATASETS) {
      expect(dataset.samples.length, `${dataset.name} 必须包含样本`).toBeGreaterThan(0);
      expect(
        dataset.fieldSchema.some((field) => field.role === 'expected_output'),
        `${dataset.name} 必须声明 expected_output 字段`,
      ).toBe(true);
    }
  });

  it('每条样本 data 的字段必须是 fieldSchema 字段集合的子集', () => {
    for (const fixture of DEV_EXPERIMENT_DATASETS) {
      const allowed = new Set(fixture.fieldSchema.map((field) => field.name));
      for (const sample of fixture.samples) {
        const stray = Object.keys(sample.data).filter((key) => !allowed.has(key));
        expect(
          stray,
          `${fixture.name} 样本 ${sample.externalId} 含 fieldSchema 未声明的字段: ${stray.join(',')}`,
        ).toEqual([]);
      }
    }
  });

  it('所有 fixture 的 sample.id 全局唯一（避免 onConflict 跨数据集错位）', () => {
    const seen = new Map<string, string>();
    for (const fixture of DEV_EXPERIMENT_DATASETS) {
      for (const sample of fixture.samples) {
        const prev = seen.get(sample.id);
        expect(prev, `sample.id ${sample.id} 在 ${prev} 与 ${fixture.name} 中重复`).toBeUndefined();
        seen.set(sample.id, fixture.name);
      }
    }
  });
});

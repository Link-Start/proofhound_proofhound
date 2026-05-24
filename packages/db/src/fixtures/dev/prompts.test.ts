import { describe, expect, it } from 'vitest';
import { DEV_PROMPTS } from './prompts';

describe('DEV_PROMPTS', () => {
  it('每个提示词版本必须从 v1 开始并保持连续', () => {
    for (const fixture of DEV_PROMPTS) {
      const versions = fixture.versions.map((version) => version.versionNumber).sort((left, right) => left - right);

      expect(versions[0], `${fixture.name} 必须从 v1 开始`).toBe(1);

      versions.forEach((version, index) => {
        expect(version, `${fixture.name} 版本号必须连续`).toBe(index + 1);
      });
    }
  });

  it('当前在线版本必须存在于版本清单中', () => {
    for (const fixture of DEV_PROMPTS) {
      if (!fixture.currentOnlineVersionId) continue;
      expect(
        fixture.versions.some((version) => version.id === fixture.currentOnlineVersionId),
        `${fixture.name} currentOnlineVersionId 不在 versions 中`,
      ).toBe(true);
    }
  });

  it('每个提示词都绑定了默认数据集（便于打开编辑器时自动加载）', () => {
    for (const fixture of DEV_PROMPTS) {
      expect(
        fixture.defaultDatasetId,
        `${fixture.name} 缺少 defaultDatasetId，编辑器打开时数据集会未选中`,
      ).toBeTruthy();
    }
  });
});

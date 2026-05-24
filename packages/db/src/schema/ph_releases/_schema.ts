// ph_releases — 共享 schema 对象
// 同一个 phReleases 实例被同 schema 下多张表文件 import，避免重复 pgSchema 调用

import { pgSchema } from 'drizzle-orm/pg-core';

export const phReleases = pgSchema('ph_releases');

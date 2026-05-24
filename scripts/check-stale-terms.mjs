#!/usr/bin/env node
/**
 * 防术语漂移 — 扫描代码与文档里是否出现 CLAUDE.md §4.1 禁用的旧术语。
 *
 * 出现即 exit 1；CI 跑 `pnpm spec:terms` 强校验。
 *
 * 当前是占位实现，覆盖最关键的旧词；后续可扩。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

// CLAUDE.md §4.1 明确禁用
const FORBIDDEN_TERMS = [
  { term: '调用记录' },
  { term: 'Provider', proseOnly: true }, // 仅在中文用户面禁用 Provider 这个词；代码内 "provider" 仍然允许
  { term: 'Project administrator' },
  { term: 'Project Administrator' },
  { term: 'roles.developer' },
  { term: 'countProjectDevelopers' },
  { term: 'role-dev' },
  { term: '操作员' },
  { term: '审核员' },
  { term: '观察员' },
  // 2026-05-17 编排栈从 Temporal 切到 DBOS + BullMQ
  { term: '@temporalio' },
  { term: 'Temporal Workflow' },
  { term: 'TEMPORAL_ADDRESS' },
  { term: 'TEMPORAL_NAMESPACE' },
  { term: '@proofhound/temporal-shared' },
  { term: 'ph_temporal_mirror' },
];

// 只扫这些扩展名
const EXTS = new Set(['.md', '.mdx', '.tsx', '.ts', '.json', '.yml', '.yaml']);
const CODE_EXTS = new Set(['.tsx', '.ts']);

// 不扫这些目录
const EXCLUDE_DIRS = new Set(['node_modules', '.next', 'dist', '.turbo', '.git', 'coverage']);
const EXCLUDE_FILES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'scripts/check-stale-terms.mjs',
  'pnpm-lock.yaml',
]);

// 用户面 vs 代码内的区分：默认全扫，但允许在 *.code-allow.json 里加白名单。
// 简化起见：先全扫，发现 false positive 再加白名单文件。
let violations = 0;

/**
 * @param {string} dir
 */
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      walk(p);
    } else {
      const ext = entry.slice(entry.lastIndexOf('.'));
      if (!EXTS.has(ext)) continue;
      const content = readFileSync(p, 'utf8');
      const rel = relative(ROOT, p);
      // 跳过 SPEC 自身（00–32 是事实来源，其中可能在历史变更说明里提到旧词）
      if (rel.startsWith('docs/specs/')) continue;
      // 跳过约束说明文件与本脚本（它们需要列出禁用词本身）
      if (EXCLUDE_FILES.has(rel)) continue;

      for (const { term, proseOnly } of FORBIDDEN_TERMS) {
        if (proseOnly && CODE_EXTS.has(ext)) continue;
        if (content.includes(term)) {
          console.error(`[stale-term] ${rel} contains forbidden term: "${term}"`);
          violations++;
        }
      }
    }
  }
}

walk(ROOT);

if (violations > 0) {
  console.error(`\n${violations} stale term(s) found. See CLAUDE.md §4.1.`);
  process.exit(1);
}

console.log('No stale terms found.');

// V1 默认策略 — 错误模式分析 + 生成新版本
// 详见 docs/specs/25-optimizations.md §3
//
// 关键 system prompt 模板存放在 ./prompts/*.md，由 ./prompts/loader.ts 同步加载。
// 修改 prompt → 编辑 .md 文件 → 重启进程生效。
export * from './config.schema';
export * from './parse';
export * from './prompts';
export * from './confusion-pairs';
export * from './analyze';
export * from './generate';
export * from './generate-initial';

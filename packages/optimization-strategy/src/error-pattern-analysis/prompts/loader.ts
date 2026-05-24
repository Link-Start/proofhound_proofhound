// 同步加载本目录下的所有 prompt 模板（.md 文件）
// 模块初始化时一次性 readFileSync — 启动后修改 .md 不会热生效（需要重启进程）
//
// 为什么用 .md：
// - 开发者可以直接看 / 改 prompt，无需 round-trip 到 .ts 文件
// - git diff 友好（修改 prompt 时变更明显、便于 code review）
// - 未来社区贡献者无需懂 TypeScript 也能调 prompt
//
// 路径解析：使用 CommonJS 的 __dirname；strategy 包目前由 CJS 消费者（apps/server Node16 模式）和
// vitest（ESM 模式）共同使用，__dirname 在两种 runtime 都可用（Node CJS 原生，Node ESM 通过 polyfill）。
// 之前用 import.meta.url 触发 TS Node16 模块检查报错（TS1470），故改回 __dirname。
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PROMPT_LANGUAGE, type PromptLanguageDto } from '@proofhound/shared';

declare const __dirname: string;
declare const require: { resolve(id: string): string } | undefined;

function resolveHere(): string {
  if (typeof __dirname !== 'undefined') return __dirname;
  // ESM 兜底：vitest 等 ESM runtime 走 fileURLToPath(import.meta.url)
  // 用 Function 包一层规避 TS Node16 模式对 import.meta 的禁用
  try {
    const meta = new Function('return import.meta')() as { url: string };
    return dirname(fileURLToPath(meta.url));
  } catch {
    return process.cwd();
  }
}

const here = resolveHere();
void require;

function load(name: string): string {
  return readFileSync(join(here, name), 'utf8').trim();
}

export const PROMPT_FILES = {
  analyzeConfusionSystem: 'analyze-confusion.system.md',
  analyzeConfusionSystemEn: 'analyze-confusion.system.en-US.md',
  analyzeRegressionSystem: 'analyze-regression.system.md',
  analyzeRegressionSystemEn: 'analyze-regression.system.en-US.md',
  summarizeSystem: 'summarize.system.md',
  summarizeSystemEn: 'summarize.system.en-US.md',
  generateSystem: 'generate.system.md',
  generateSystemEn: 'generate.system.en-US.md',
  generateInitialSystem: 'generate-initial.system.md',
  generateInitialSystemEn: 'generate-initial.system.en-US.md',
  optimizationTips: 'optimization-tips.md',
  optimizationTipsEn: 'optimization-tips.en-US.md',
} as const;

// 工具箱条目名 — 与 optimization-tips.md 的 8 节标题一一对应；用于「## 工具箱轮换提示」段渲染
// (docs/specs/25 §11.3 「工具箱轮换提示」)。新增 / 重命名 md 条目时同步更新。
export const OPTIMIZATION_TIP_NAMES = [
  '思维链',
  'Few-shot 示例',
  '术语 / 类别明确化',
  '输出约束硬性化',
  '分步推理',
  '错误避免举例',
  'Chain-of-Verification',
  '否定示例引导',
] as const;

export const OPTIMIZATION_TIP_NAMES_EN = [
  'Chain-of-Thought',
  'Few-shot examples',
  'Terminology / class boundary clarification',
  'Hard output constraints',
  'Decomposition',
  'Negative examples',
  'Chain-of-Verification',
  'Boundary pinning',
] as const;

// 注意：optimization-tips 不是独立 system prompt，而是被 generate.system.md 中
// {{OPTIMIZATION_TIPS}} 占位符引用，由本 loader 在 generate prompt 加载时替换。
export const OPTIMIZATION_TIPS = load(PROMPT_FILES.optimizationTips);
export const OPTIMIZATION_TIPS_EN = load(PROMPT_FILES.optimizationTipsEn);

export const ANALYZE_CONFUSION_SYSTEM_PROMPT = load(PROMPT_FILES.analyzeConfusionSystem);
export const ANALYZE_CONFUSION_SYSTEM_PROMPT_EN = load(PROMPT_FILES.analyzeConfusionSystemEn);
export const ANALYZE_REGRESSION_SYSTEM_PROMPT = load(PROMPT_FILES.analyzeRegressionSystem);
export const ANALYZE_REGRESSION_SYSTEM_PROMPT_EN = load(PROMPT_FILES.analyzeRegressionSystemEn);
export const SUMMARIZE_SYSTEM_PROMPT = load(PROMPT_FILES.summarizeSystem);
export const SUMMARIZE_SYSTEM_PROMPT_EN = load(PROMPT_FILES.summarizeSystemEn);
export const GENERATE_SYSTEM_PROMPT = load(PROMPT_FILES.generateSystem).replace(
  '{{OPTIMIZATION_TIPS}}',
  OPTIMIZATION_TIPS,
);
export const GENERATE_SYSTEM_PROMPT_EN = load(PROMPT_FILES.generateSystemEn).replace(
  '{{OPTIMIZATION_TIPS}}',
  OPTIMIZATION_TIPS_EN,
);
export const GENERATE_INITIAL_SYSTEM_PROMPT = load(PROMPT_FILES.generateInitialSystem);
export const GENERATE_INITIAL_SYSTEM_PROMPT_EN = load(PROMPT_FILES.generateInitialSystemEn);

export const SYSTEM_PROMPTS = {
  analyzeConfusion: ANALYZE_CONFUSION_SYSTEM_PROMPT,
  analyzeRegression: ANALYZE_REGRESSION_SYSTEM_PROMPT,
  summarize: SUMMARIZE_SYSTEM_PROMPT,
  generate: GENERATE_SYSTEM_PROMPT,
  generateInitial: GENERATE_INITIAL_SYSTEM_PROMPT,
} as const;

export const SYSTEM_PROMPTS_EN = {
  analyzeConfusion: ANALYZE_CONFUSION_SYSTEM_PROMPT_EN,
  analyzeRegression: ANALYZE_REGRESSION_SYSTEM_PROMPT_EN,
  summarize: SUMMARIZE_SYSTEM_PROMPT_EN,
  generate: GENERATE_SYSTEM_PROMPT_EN,
  generateInitial: GENERATE_INITIAL_SYSTEM_PROMPT_EN,
} as const;

export function getSystemPrompts(
  language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE,
): Record<keyof typeof SYSTEM_PROMPTS, string> {
  return language === 'en-US' ? SYSTEM_PROMPTS_EN : SYSTEM_PROMPTS;
}

export function getOptimizationTipNames(language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE): readonly string[] {
  return language === 'en-US' ? OPTIMIZATION_TIP_NAMES_EN : OPTIMIZATION_TIP_NAMES;
}

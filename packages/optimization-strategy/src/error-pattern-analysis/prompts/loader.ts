// Synchronously loads all prompt templates (.md files) under this directory
// One-shot readFileSync at module init — modifying .md after startup does not hot-reload (process restart needed)
//
// Why use .md:
// - Developers can directly view / modify prompts without a round-trip to .ts files
// - git diff friendly (prompt changes are obvious, easy to code review)
// - Future community contributors do not need TypeScript to tune prompts
//
// Path resolution: use CommonJS's __dirname; the strategy package is currently consumed by both CJS consumers (apps/server Node16 mode) and
// vitest (ESM mode); __dirname is available in both runtimes (native in Node CJS, polyfilled in Node ESM).
// Previously using import.meta.url triggered the TS Node16 module-check error (TS1470), so we switched back to __dirname.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PROMPT_LANGUAGE, type PromptLanguageDto } from '@proofhound/shared';

declare const __dirname: string;
declare const require: { resolve(id: string): string } | undefined;

function resolveHere(): string {
  if (typeof __dirname !== 'undefined') return __dirname;
  // ESM fallback: vitest and other ESM runtimes use fileURLToPath(import.meta.url)
  // Wrap with Function to bypass TS Node16 mode's disabling of import.meta
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

// Toolbox entry names — one-to-one with the 8 section titles in optimization-tips.md; used by the toolbox-rotation-hint section rendering
// (docs/specs/25 §11.3 "toolbox rotation hint"). Update synchronously when adding / renaming md entries.
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

// Note: optimization-tips is not a standalone system prompt; it is referenced by the {{OPTIMIZATION_TIPS}} placeholder
// inside generate.system.md, replaced by this loader when the generate prompt is loaded.
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

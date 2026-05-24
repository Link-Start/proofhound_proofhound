// LLM prompt 构造 — system prompt 全部来自 prompts/*.md（由 prompts/loader.ts 加载）
// 本文件只负责拼 user prompt（含动态变量替换）。
import { compare, readMetric } from '../loop/goals';
import type { OptimizationGoal, FieldWhitelist, MetricSnapshot, PromptVersionRef, RoundHistoryEntry } from '../loop/types';
import { DEFAULT_PROMPT_LANGUAGE, buildOutputFormatInstruction, type PromptLanguageDto } from '@proofhound/shared';
import type { ConfusionPair, RegressionGroup } from './confusion-pairs';
import type { AnalysisEvidenceBundle } from './analysis-types';
import { getSystemPrompts } from './prompts/loader';
import { estimateMessagesTokens, truncateLongText } from './token-budget';

// 重新 re-export system prompt + SYSTEM_PROMPTS map（保持向后兼容 API）
export {
  ANALYZE_CONFUSION_SYSTEM_PROMPT,
  ANALYZE_REGRESSION_SYSTEM_PROMPT,
  GENERATE_SYSTEM_PROMPT,
  OPTIMIZATION_TIPS,
  OPTIMIZATION_TIP_NAMES,
  OPTIMIZATION_TIP_NAMES_EN,
  PROMPT_FILES,
  SUMMARIZE_SYSTEM_PROMPT,
  SYSTEM_PROMPTS,
  SYSTEM_PROMPTS_EN,
  getOptimizationTipNames,
  getSystemPrompts,
} from './prompts/loader';

// =========================
// 公共片段
// =========================

function scopeLabel(scope: OptimizationGoal['scope'], language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE): string {
  if (language === 'en-US') return scope.kind === 'overall' ? 'overall' : `class "${scope.label}"`;
  return scope.kind === 'overall' ? '整体' : `分类「${scope.label}」`;
}

function fmtNum(n: number | null | undefined, language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE): string {
  if (n === null || n === undefined || Number.isNaN(n)) return language === 'en-US' ? '(missing)' : '（缺失）';
  return n.toFixed(4);
}

function signedGap(observed: number, target: number, op: OptimizationGoal['op']): string {
  // 把差距按 op 方向标准化：正数 = 已超目标，负数 = 还差多少
  // >= / > : gap = observed - target （越大越好）
  // <= : gap = target - observed （越小越好；展示成"还差多少需要再降低"）
  const delta = op === '<=' ? target - observed : observed - target;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(4)}`;
}

// 「优化目标 vs 当前实际」对照表 — 把目标和实际值并排展示
function formatGoalsWithProgress(
  goals: OptimizationGoal[],
  metrics: MetricSnapshot,
  language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE,
): string {
  if (goals.length === 0) return language === 'en-US' ? '(no optimization goals declared)' : '（未声明优化目标）';
  return goals
    .map((g) => {
      const observed = readMetric(metrics, g);
      const achieved = observed !== null && compare(observed, g.op, g.value);
      const gapStr = observed === null ? '?' : signedGap(observed, g.value, g.op);
      const status = achieved
        ? language === 'en-US'
          ? 'achieved'
          : '✅ 已达成'
        : language === 'en-US'
          ? 'not achieved'
          : '❌ 未达成';
      if (language === 'en-US') {
        return `- \`${g.metric}\` for ${scopeLabel(g.scope, language)}: target \`${g.op} ${g.value}\`; observed \`${fmtNum(observed, language)}\`; gap \`${gapStr}\`; ${status}`;
      }
      return `- ${scopeLabel(g.scope, language)} 的 \`${g.metric}\`：目标 \`${g.op} ${g.value}\`；当前实际 \`${fmtNum(observed, language)}\`；差距 \`${gapStr}\`；${status}`;
    })
    .join('\n');
}

// 「涉及范围的完整指标」— 只展示 goals 涉及的 scope（overall / 某些 class）下的所有指标，
// 不涉及的 class 不展示（省 token + 让 LLM 聚焦）
function formatRelevantMetrics(
  goals: OptimizationGoal[],
  metrics: MetricSnapshot,
  language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE,
): string {
  if (goals.length === 0) {
    // 没有 goals 时退化为展示 overall（避免完全空 user prompt）
    return [
      language === 'en-US' ? '### Overall' : '### 整体',
      '```json',
      JSON.stringify(metrics.overall, null, 2),
      '```',
    ].join('\n');
  }
  const involvedClasses = new Set<string>();
  let needsOverall = false;
  for (const g of goals) {
    if (g.scope.kind === 'overall') needsOverall = true;
    else involvedClasses.add(g.scope.label);
  }

  const sections: string[] = [];
  if (needsOverall) {
    sections.push(
      language === 'en-US' ? '### Overall' : '### 整体',
      '```json',
      JSON.stringify(metrics.overall ?? {}, null, 2),
      '```',
    );
  }
  for (const cls of involvedClasses) {
    const slice = metrics.perClass?.[cls];
    sections.push(
      language === 'en-US' ? `### Class "${cls}"` : `### 分类「${cls}」`,
      '```json',
      JSON.stringify(slice ?? {}, null, 2),
      '```',
    );
  }
  return sections.join('\n');
}

function formatVariableList(vars: string[], language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE): string {
  if (vars.length === 0) {
    return language === 'en-US'
      ? '(the current prompt references no dataset field variables)'
      : '（当前 prompt 不引用任何数据集字段变量）';
  }
  return vars.map((v) => `- \`{{${v}}}\``).join('\n');
}

function formatAnalysisOnlyFields(
  fields: string[] | undefined,
  language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE,
): string {
  if (!fields || fields.length === 0) return language === 'en-US' ? '(none)' : '（无）';
  return fields.map((f) => `- \`${f}\``).join('\n');
}

// =========================
// 跨轮历史段渲染 — 详见 docs/specs/25-optimizations.md §11.3 "跨轮历史注入"
// 主指标取 goals[0]（与 deltaFromPrev 计算口径一致）；无 goals 时退化为 metrics.overall.accuracy
// =========================
function fmtDelta(d: number | null): string {
  if (d === null) return 'Δ -- ';
  const sign = d >= 0 ? '+' : '';
  return `Δ ${sign}${d.toFixed(4)}`;
}

function readPrimaryMetric(metrics: MetricSnapshot, goals: OptimizationGoal[]): number | null {
  const primary = goals[0];
  if (primary) {
    const v = readMetric(metrics, primary);
    return v;
  }
  const v = metrics.overall?.accuracy;
  return typeof v === 'number' ? v : null;
}

function primaryMetricName(goals: OptimizationGoal[]): string {
  return goals[0]?.metric ?? 'accuracy';
}

export function formatRoundHistory(
  history: RoundHistoryEntry[],
  goals: OptimizationGoal[],
  language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE,
): string {
  if (history.length === 0) return '';
  const metricName = primaryMetricName(goals);
  const head =
    language === 'en-US'
      ? [
          `## Optimization History (${history.length} rounds, chronological; use it to avoid repeated failed directions)`,
          `> Reading guide: Δ is the change in the primary metric (${metricName}) from the previous round; ★ marks the current best round.`,
          '',
        ]
      : [
          `## 历史优化轨迹（共 ${history.length} 轮，按时间正序；用于避免重复无效尝试）`,
          `> 解读：Δ 是与上一轮主指标 (${metricName}) 的差值；★ 标记当前 best 轮；★+ 表示该 best 同时被采用为下一轮 base`,
          '',
        ];
  const lines = history.map((entry) => {
    const primary = readPrimaryMetric(entry.metrics, goals);
    const primaryStr = primary === null ? (language === 'en-US' ? '(missing)' : '（缺失）') : primary.toFixed(4);
    const bestMark = entry.isBest ? '★' : '';
    const changeIds = entry.appliedChanges.map((c) => c.changeId).filter(Boolean);
    const changeIdsStr =
      changeIds.length > 0 ? `[${changeIds.join(', ')}]` : language === 'en-US' ? '(none)' : '（无）';
    const summary =
      entry.changeSummary.trim().length > 0
        ? entry.changeSummary.trim()
        : language === 'en-US'
          ? '(not provided)'
          : '（未提供）';
    const tips = entry.appliedTips.filter((t) => t.trim().length > 0);
    const tipsStr = tips.length > 0 ? `[${tips.join(', ')}]` : language === 'en-US' ? '(not declared)' : '（未声明）';
    const prefix =
      language === 'en-US'
        ? `- Round ${entry.roundIndex} (${fmtDelta(entry.deltaFromPrev)}) ${bestMark} ${metricName} ${primaryStr}`
        : `- 第 ${entry.roundIndex} 轮 (${fmtDelta(entry.deltaFromPrev)}) ${bestMark} ${metricName} ${primaryStr}`;
    return [
      prefix,
      `  - changeSummary: ${summary}`,
      `  - appliedChanges: ${changeIdsStr}`,
      `  - appliedTips: ${tipsStr}`,
    ].join('\n');
  });
  return [...head, ...lines].join('\n');
}

// 「## 工具箱轮换提示」段渲染 — 当连续 ≥2 轮 !isBest 时由 caller 注入到 generate user prompt。
// 软提示：列出已尝试技巧 + 工具箱全集 + 建议措辞;不强制 LLM 必须切换。
// 详见 docs/specs/25 §11.3「工具箱轮换提示」
export function formatToolboxSwitchHint(
  recentlyUsedTips: string[],
  allTipNames: readonly string[],
  language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE,
): string {
  const usedSet = new Set(recentlyUsedTips.filter((t) => t.trim().length > 0));
  const usedList =
    usedSet.size > 0
      ? Array.from(usedSet)
          .map((t) => `\`${t}\``)
          .join(', ')
      : language === 'en-US'
        ? '(no historical technique names recognized)'
        : '（无法识别历史技巧名）';
  const toolboxList = allTipNames.map((t) => `\`${t}\``).join(', ');
  if (language === 'en-US') {
    return [
      '## Toolbox Rotation Hint',
      '> The last 2 new versions did not improve the historical best metric. Prefer techniques not already tried.',
      '',
      `- Techniques tried in the last 2 rounds (appliedTips): ${usedList}`,
      `- All toolbox techniques: ${toolboxList}`,
      "- Suggestion: include at least one toolbox item outside the tried list in this round's `appliedTips`, unless the evidence bundle clearly requires staying with the same direction.",
    ].join('\n');
  }
  return [
    '## 工具箱轮换提示',
    '> 近 2 轮的新版本均未刷新历史最佳指标，可能在某种技巧组合上原地转圈。请优先尝试**未使用过**的优化技巧。',
    '',
    `- 近 2 轮已尝试技巧（appliedTips）：${usedList}`,
    `- 工具箱全部技巧（见 optimization-tips.md）：${toolboxList}`,
    '- 建议：本轮 `appliedTips` 中至少包含一个上面"已尝试"清单外的工具箱条目；若 evidenceBundle 确无对应方向证据，可在 `changeSummary` 说明仍沿用原方向的理由。',
  ].join('\n');
}

// 通用：把"## 历史优化轨迹"段拼进 user prompt 数组中
// 调用方：在"## 优化目标 vs 当前实际"段后那个 '' 分隔符之后展开 ...renderRoundHistorySection(history, goals)
// 返回 [formatted, ''] 维持现有段落分隔风格；history 为空时返回 [] 完全不渲染（向后兼容首轮）
function renderRoundHistorySection(
  history: RoundHistoryEntry[] | undefined,
  goals: OptimizationGoal[],
  language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE,
): string[] {
  if (!history || history.length === 0) return [];
  return [formatRoundHistory(history, goals, language), ''];
}

// 「## 工具箱轮换提示」拼装 — caller 在 generate user prompt 的「## 历史优化轨迹」段后展开
// hint 为 undefined 时返回 [] 完全不渲染（streak < 2 / 首轮场景）
function renderToolboxSwitchHintSection(
  hint: { recentlyUsedTips: string[]; allTipNames: readonly string[] } | undefined,
  language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE,
): string[] {
  if (!hint) return [];
  return [formatToolboxSwitchHint(hint.recentlyUsedTips, hint.allTipNames, language), ''];
}

// =========================
// 跨轮历史 token budget 降级 — 详见 docs/specs/25-optimizations.md §11.3
// L0 全量 → L1 早期轮 changeSummary 截 200 字 + appliedChanges 仅留 changeId →
// L2 早期轮 changeSummary 截 50 字 + appliedChanges 清空 →
// L3 仅最近 1 轮含 changeSummary / appliedChanges，其余清空
// 估算口径走 formatRoundHistory + estimateMessagesTokens（与 caller probe 用同一函数避免漂移）
// =========================
const HISTORY_RECENT_KEEP = 3;
const HISTORY_L1_CHANGE_SUMMARY_CHARS = 200;
const HISTORY_L2_CHANGE_SUMMARY_CHARS = 50;

export interface FitRoundHistoryResult {
  fitted: RoundHistoryEntry[] | undefined;
  level: 0 | 1 | 2 | 3;
  truncated: boolean;
  entryCount: number;
  budgetTokens: number;
  estimatedTokens: number;
}

function estimateRoundHistoryTokens(
  history: RoundHistoryEntry[],
  goals: OptimizationGoal[],
  language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE,
): number {
  if (history.length === 0) return 0;
  return estimateMessagesTokens('', formatRoundHistory(history, goals, language), 0).inputTokens;
}

export function fitRoundHistoryToBudget(
  history: RoundHistoryEntry[] | undefined,
  budgetTokens: number,
  goals: OptimizationGoal[],
  language: PromptLanguageDto = DEFAULT_PROMPT_LANGUAGE,
): FitRoundHistoryResult {
  if (!history || history.length === 0) {
    return {
      fitted: history,
      level: 0,
      truncated: false,
      entryCount: 0,
      budgetTokens,
      estimatedTokens: 0,
    };
  }

  const l0Tokens = estimateRoundHistoryTokens(history, goals, language);
  if (l0Tokens <= budgetTokens) {
    return {
      fitted: history,
      level: 0,
      truncated: false,
      entryCount: history.length,
      budgetTokens,
      estimatedTokens: l0Tokens,
    };
  }

  const earlyCount = Math.max(0, history.length - HISTORY_RECENT_KEEP);

  // L1: 早期轮压缩 changeSummary + 精简 appliedChanges
  const l1: RoundHistoryEntry[] = history.map((entry, i) => {
    if (i >= earlyCount) return entry;
    return {
      ...entry,
      changeSummary: truncateLongText(entry.changeSummary, HISTORY_L1_CHANGE_SUMMARY_CHARS),
      appliedChanges: entry.appliedChanges.map((c) => ({ changeId: c.changeId })),
    };
  });
  const l1Tokens = estimateRoundHistoryTokens(l1, goals, language);
  if (l1Tokens <= budgetTokens) {
    return {
      fitted: l1,
      level: 1,
      truncated: true,
      entryCount: l1.length,
      budgetTokens,
      estimatedTokens: l1Tokens,
    };
  }

  // L2: 早期轮 changeSummary 进一步截短 + appliedChanges 清空
  const l2: RoundHistoryEntry[] = history.map((entry, i) => {
    if (i >= earlyCount) return entry;
    return {
      ...entry,
      changeSummary: truncateLongText(entry.changeSummary, HISTORY_L2_CHANGE_SUMMARY_CHARS),
      appliedChanges: [],
    };
  });
  const l2Tokens = estimateRoundHistoryTokens(l2, goals, language);
  if (l2Tokens <= budgetTokens) {
    return {
      fitted: l2,
      level: 2,
      truncated: true,
      entryCount: l2.length,
      budgetTokens,
      estimatedTokens: l2Tokens,
    };
  }

  // L3: 仅最近 1 轮含 changeSummary / appliedChanges；其余清空（但保留 metrics + delta）
  const l3: RoundHistoryEntry[] = history.map((entry, i) => {
    if (i === history.length - 1) return entry;
    return { ...entry, changeSummary: '', appliedChanges: [] };
  });
  const l3Tokens = estimateRoundHistoryTokens(l3, goals, language);
  return {
    fitted: l3,
    level: 3,
    truncated: true,
    entryCount: l3.length,
    budgetTokens,
    estimatedTokens: l3Tokens,
  };
}

// =========================
// 1) analyze-confusion user prompt
// =========================

export interface BuildConfusionAnalyzeArgs {
  pair: ConfusionPair;
  currentVersion: PromptVersionRef;
  metrics: MetricSnapshot;
  goals: OptimizationGoal[];
  fieldWhitelist: FieldWhitelist;
  roundHistory?: RoundHistoryEntry[];
  promptLanguage?: PromptLanguageDto;
}

export function buildAnalyzeConfusionMessages(args: BuildConfusionAnalyzeArgs): {
  system: string;
  user: string;
} {
  const { pair, currentVersion, metrics, goals, fieldWhitelist, roundHistory } = args;
  const language = args.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE;
  const system = getSystemPrompts(language).analyzeConfusion;
  const user =
    language === 'en-US'
      ? [
          `## Confusion Pair: \`${pair.expected}\` -> \`${pair.predicted}\` (${pair.count} failed samples; showing ${pair.samples.length})`,
          '',
          '## Current Prompt',
          '```',
          currentVersion.body,
          '```',
          '',
          '## promptVariables (available, immutable)',
          formatVariableList(fieldWhitelist.promptVariables, language),
          '',
          '## analysisOnlyFields (read-only; forbidden in the final prompt)',
          formatAnalysisOnlyFields(fieldWhitelist.analysisOnlyFields, language),
          '',
          '## Optimization Goals vs Current Metrics',
          formatGoalsWithProgress(goals, metrics, language),
          '',
          ...renderRoundHistorySection(roundHistory, goals, language),
          '## Relevant Metrics',
          formatRelevantMetrics(goals, metrics, language),
          '',
          `## Failed Samples (${pair.samples.length})`,
          '```json',
          JSON.stringify(pair.samples, null, 2),
          '```',
          '',
          'Output JSON according to the system instructions.',
        ].join('\n')
      : [
          `## 本批混淆对：\`${pair.expected}\` → \`${pair.predicted}\`（共 ${pair.count} 条失败样本，本批展示 ${pair.samples.length} 条）`,
          '',
          '## 当前提示词全文',
          '```',
          currentVersion.body,
          '```',
          '',
          '## promptVariables（可用、不可改）',
          formatVariableList(fieldWhitelist.promptVariables, language),
          '',
          '## analysisOnlyFields（仅可阅读、严禁出现在最终 prompt 中）',
          formatAnalysisOnlyFields(fieldWhitelist.analysisOnlyFields, language),
          '',
          '## 优化目标 vs 当前实际',
          formatGoalsWithProgress(goals, metrics, language),
          '',
          ...renderRoundHistorySection(roundHistory, goals, language),
          '## 涉及范围的完整指标（仅展示与优化目标相关的范围）',
          formatRelevantMetrics(goals, metrics, language),
          '',
          `## 本批失败样本（共 ${pair.samples.length} 条）`,
          '```json',
          JSON.stringify(pair.samples, null, 2),
          '```',
          '',
          '请按 system 指令输出 JSON。',
        ].join('\n');
  return { system, user };
}

// =========================
// 2) analyze-regression user prompt
// =========================

export interface BuildRegressionAnalyzeArgs {
  group: RegressionGroup;
  currentVersion: PromptVersionRef;
  previousVersion?: PromptVersionRef | null;
  metrics: MetricSnapshot;
  goals: OptimizationGoal[];
  fieldWhitelist: FieldWhitelist;
  roundHistory?: RoundHistoryEntry[];
  promptLanguage?: PromptLanguageDto;
}

export function buildAnalyzeRegressionMessages(args: BuildRegressionAnalyzeArgs): {
  system: string;
  user: string;
} {
  const { group, currentVersion, previousVersion, metrics, goals, fieldWhitelist, roundHistory } = args;
  const language = args.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE;
  const system = getSystemPrompts(language).analyzeRegression;
  const previousPromptSection =
    language === 'en-US'
      ? previousVersion
        ? [
            `## Previous Comparable Prompt (v${previousVersion.versionNumber}; for regression attribution only)`,
            '```',
            previousVersion.body,
            '```',
          ]
        : ['## Previous Comparable Prompt', '(not provided; do not claim a specific prompt change caused regression)']
      : previousVersion
        ? [
            `## 上一可比 prompt 模板（v${previousVersion.versionNumber}；仅用于回归归因）`,
            '```',
            previousVersion.body,
            '```',
          ]
        : [
            '## 上一可比 prompt 模板',
            '（未提供上一版 prompt / diff；不得声称某段具体改动导致回归，只能基于样本描述当前 prompt 的风险倾向。）',
          ];
  const user =
    language === 'en-US'
      ? [
          `## Regression Samples (predicted=\`${group.predicted}\`, count ${group.count})`,
          '',
          ...previousPromptSection,
          '',
          '## Current Prompt',
          '```',
          currentVersion.body,
          '```',
          '',
          '## promptVariables (available, immutable)',
          formatVariableList(fieldWhitelist.promptVariables, language),
          '',
          '## analysisOnlyFields (read-only; forbidden in the final prompt)',
          formatAnalysisOnlyFields(fieldWhitelist.analysisOnlyFields, language),
          '',
          '## Optimization Goals vs Current Metrics',
          formatGoalsWithProgress(goals, metrics, language),
          '',
          ...renderRoundHistorySection(roundHistory, goals, language),
          '## Relevant Metrics',
          formatRelevantMetrics(goals, metrics, language),
          '',
          `## Regression Samples (${group.samples.length})`,
          '```json',
          JSON.stringify(group.samples, null, 2),
          '```',
          '',
          'Output JSON according to the system instructions.',
        ].join('\n')
      : [
          `## 本批回归样本（predicted=\`${group.predicted}\`，共 ${group.count} 条）`,
          '',
          ...previousPromptSection,
          '',
          '## 当前提示词全文',
          '```',
          currentVersion.body,
          '```',
          '',
          '## promptVariables（可用、不可改）',
          formatVariableList(fieldWhitelist.promptVariables, language),
          '',
          '## analysisOnlyFields（仅可阅读、严禁出现在最终 prompt 中）',
          formatAnalysisOnlyFields(fieldWhitelist.analysisOnlyFields, language),
          '',
          '## 优化目标 vs 当前实际',
          formatGoalsWithProgress(goals, metrics, language),
          '',
          ...renderRoundHistorySection(roundHistory, goals, language),
          '## 涉及范围的完整指标（仅展示与优化目标相关的范围）',
          formatRelevantMetrics(goals, metrics, language),
          '',
          `## 回归样本（共 ${group.samples.length} 条）`,
          '```json',
          JSON.stringify(group.samples, null, 2),
          '```',
          '',
          '请按 system 指令输出 JSON。',
        ].join('\n');
  return { system, user };
}

// =========================
// 3) summarize user prompt
// =========================

export interface BuildSummarizeArgs {
  goals: OptimizationGoal[];
  metrics: MetricSnapshot;
  collectedBatches: Array<{
    source: 'confusion' | 'regression';
    title: string;
    payload: unknown;
  }>;
  roundHistory?: RoundHistoryEntry[];
  promptLanguage?: PromptLanguageDto;
}

export function buildSummarizeMessages(args: BuildSummarizeArgs): { system: string; user: string } {
  const language = args.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE;
  const system = getSystemPrompts(language).summarize;
  const user =
    language === 'en-US'
      ? [
          '## Optimization Goals vs Current Metrics',
          formatGoalsWithProgress(args.goals, args.metrics, language),
          '',
          ...renderRoundHistorySection(args.roundHistory, args.goals, language),
          '## Relevant Metrics',
          formatRelevantMetrics(args.goals, args.metrics, language),
          '',
          `## Child Analysis Results (${args.collectedBatches.length} batches)`,
          '```json',
          JSON.stringify(args.collectedBatches, null, 2),
          '```',
          '',
          'Summarize these batches into final JSON according to the system instructions.',
        ].join('\n')
      : [
          '## 优化目标 vs 当前实际',
          formatGoalsWithProgress(args.goals, args.metrics, language),
          '',
          ...renderRoundHistorySection(args.roundHistory, args.goals, language),
          '## 涉及范围的完整指标（仅展示与优化目标相关的范围）',
          formatRelevantMetrics(args.goals, args.metrics, language),
          '',
          `## 子分析结果汇总（${args.collectedBatches.length} 个 batch）`,
          '```json',
          JSON.stringify(args.collectedBatches, null, 2),
          '```',
          '',
          '请按 system 指令把这些 batch 汇总成最终 JSON。',
        ].join('\n');
  return { system, user };
}

// =========================
// 4) generate user prompt
// =========================

export interface BuildGenerateArgs {
  currentVersion: PromptVersionRef;
  errorAnalysisText: string;
  analysisEvidenceBundle?: AnalysisEvidenceBundle;
  metrics: MetricSnapshot;
  goals: OptimizationGoal[];
  fieldWhitelist: FieldWhitelist;
  optimizationHint?: string;
  roundHistory?: RoundHistoryEntry[];
  // 「## 工具箱轮换提示」段输入（docs/specs/25 §11.3「工具箱轮换提示」）
  // caller 在 streak >= 2 时构造;undefined 时不渲染该段(首轮 / streak < 2 场景)
  toolboxSwitchHint?: { recentlyUsedTips: string[]; allTipNames: readonly string[] };
  promptLanguage?: PromptLanguageDto;
}

export function buildGenerateMessages(args: BuildGenerateArgs): { system: string; user: string } {
  const {
    currentVersion,
    errorAnalysisText,
    analysisEvidenceBundle,
    metrics,
    goals,
    fieldWhitelist,
    optimizationHint,
    roundHistory,
    toolboxSwitchHint,
  } = args;
  const language = args.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE;
  const system = getSystemPrompts(language).generate;

  // output schema 不再让 LLM 复述 — 系统会在运行时自动从 schema 拼出「## 输出格式」段追加到 body 尾部。
  // 这里把"自动拼接后的输出格式段"原样塞进 user prompt 仅为让 LLM 看到完整 prompt 长啥样，
  // 避免它重复造轮子（system prompt 第 6 条硬约束已禁止 newPromptBody 复述输出格式）。
  const autoOutputFormat = buildOutputFormatInstruction(currentVersion.outputSchema, { language });
  const schemaSection = autoOutputFormat
    ? language === 'en-US'
      ? [
          '## Runtime Output-Format Section (reference only; do not restate it in newPromptBody)',
          '> The system appends this section to newPromptBody at runtime. The output format is determined only by output schema.',
          '',
          autoOutputFormat,
        ]
      : [
          '## 运行时自动拼接的输出格式段（仅供参考；禁止在 newPromptBody 中复述任何输出格式 / JSON schema / 字段说明）',
          '> 下面这段会由系统在运行时拼接到 newPromptBody 尾部，输出格式由 output schema 唯一决定，不需要你写。',
          '',
          autoOutputFormat,
        ]
    : [];
  const judgmentSection = currentVersion.judgmentRules
    ? [
        language === 'en-US' ? '## Immutable Judgment Rules' : '## 不可改动的 judgment rules',
        '```json',
        JSON.stringify(currentVersion.judgmentRules, null, 2),
        '```',
      ]
    : [];

  // base 已经用过 ∩ 白名单 = 必须在 newPromptBody 里逐字保留（system 硬约束 #1）
  // 显式列出比埋在文字里更不容易被 LLM 在整段重写时漏掉
  const allowedSet = new Set(fieldWhitelist.promptVariables);
  const requiredVariables = extractVariableNames(currentVersion.body).filter((v) => allowedSet.has(v));
  const requiredVariablesSection =
    requiredVariables.length > 0
      ? [
          language === 'en-US'
            ? '## Required Variable Placeholders (used by base; do not remove)'
            : '## 必须保留的变量占位（base 已使用，禁止删除 — 硬约束 #1）',
          language === 'en-US'
            ? '> These placeholders must appear exactly in newPromptBody. They are the only runtime path from sample data into the business model.'
            : '> 下列占位**必须逐字、原样**出现在 newPromptBody 中（位置随意）。它们是运行时把样本数据注入业务模型的唯一通道；删掉它们模型推理时根本看不到样本，整批输出会立即塌缩到同一标签。',
          '',
          ...requiredVariables.map((v) => `- \`{{${v}}}\``),
          '',
        ]
      : [];

  const user =
    language === 'en-US'
      ? [
          `## Current Prompt Template (v${currentVersion.versionNumber})`,
          '```',
          currentVersion.body,
          '```',
          '',
          ...requiredVariablesSection,
          '## Structured Evidence Bundle (primary source)',
          analysisEvidenceBundle
            ? ['```json', JSON.stringify(analysisEvidenceBundle, null, 2), '```'].join('\n')
            : '(no structured evidence bundle; use fallback summary below)',
          '',
          '## Error Analysis Fallback Summary',
          errorAnalysisText,
          '',
          '## Optimization Goals vs Current Metrics',
          formatGoalsWithProgress(goals, metrics, language),
          '',
          ...renderRoundHistorySection(roundHistory, goals, language),
          ...renderToolboxSwitchHintSection(toolboxSwitchHint, language),
          '## Relevant Metrics',
          formatRelevantMetrics(goals, metrics, language),
          '',
          '## promptVariables (available, immutable)',
          formatVariableList(fieldWhitelist.promptVariables, language),
          '',
          '## analysisOnlyFields (forbidden in the new prompt)',
          formatAnalysisOnlyFields(fieldWhitelist.analysisOnlyFields, language),
          '',
          '## modifiableSections',
          fieldWhitelist.modifiableSections && fieldWhitelist.modifiableSections.length > 0
            ? fieldWhitelist.modifiableSections.map((s) => `- \`${s}\``).join('\n')
            : '(not constrained; rewrite as needed while respecting all other constraints)',
          '',
          ...schemaSection,
          '',
          ...judgmentSection,
          '',
          '## User Generation Guidance',
          optimizationHint && optimizationHint.trim().length > 0 ? optimizationHint : '(none)',
          '',
          'Output JSON according to the system instructions.',
        ].join('\n')
      : [
          '## 当前 prompt 模板（v' + currentVersion.versionNumber + '）',
          '```',
          currentVersion.body,
          '```',
          '',
          ...requiredVariablesSection,
          '## 结构化错误证据包（来自 analyze / summarize 阶段，优先依据）',
          analysisEvidenceBundle
            ? ['```json', JSON.stringify(analysisEvidenceBundle, null, 2), '```'].join('\n')
            : '（无结构化证据包，使用下方旧摘要 fallback）',
          '',
          '## 错误分析摘要 fallback（仅在证据包缺字段时参考）',
          errorAnalysisText,
          '',
          '## 优化目标 vs 当前实际',
          formatGoalsWithProgress(goals, metrics, language),
          '',
          ...renderRoundHistorySection(roundHistory, goals, language),
          ...renderToolboxSwitchHintSection(toolboxSwitchHint, language),
          '## 涉及范围的完整指标（仅展示与优化目标相关的范围）',
          formatRelevantMetrics(goals, metrics, language),
          '',
          '## promptVariables（可用、不可改）',
          formatVariableList(fieldWhitelist.promptVariables, language),
          '',
          '## analysisOnlyFields（严禁出现在新 prompt 中）',
          formatAnalysisOnlyFields(fieldWhitelist.analysisOnlyFields, language),
          '',
          '## modifiableSections（仅可在这些段落内改）',
          fieldWhitelist.modifiableSections && fieldWhitelist.modifiableSections.length > 0
            ? fieldWhitelist.modifiableSections.map((s) => `- \`${s}\``).join('\n')
            : '（未限定 — 可在不违反其它约束的前提下整体改写）',
          '',
          ...schemaSection,
          '',
          ...judgmentSection,
          '',
          '## 用户给的提示词生成指引',
          optimizationHint && optimizationHint.trim().length > 0 ? optimizationHint : '（无）',
          '',
          '请按 system 指令输出 JSON。',
        ].join('\n');

  return { system, user };
}

// =========================
// 变量名提取 — 用于校验「新 prompt 只能用 promptVariables 子集」
// =========================
export function extractVariableNames(promptBody: string): string[] {
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  const set = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(promptBody)) !== null) {
    set.add(m[1]!);
  }
  return [...set];
}

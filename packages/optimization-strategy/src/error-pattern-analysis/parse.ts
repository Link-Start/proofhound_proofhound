// LLM JSON 输出解析 — 严格 JSON + 容错回退 + 截断检测

interface JsonRepairModule {
  jsonrepair: (text: string) => string;
}

import type {
  AnalysisPattern,
  SuggestedChange,
  SummarizeConflict,
} from './analysis-types';

export type {
  AnalysisEvidenceBundle,
  AnalysisPattern,
  SuggestedChange,
  SummarizeConflict,
} from './analysis-types';

// jsonrepair 同时发布 ESM/CJS，但 server 的 Node16 CJS 编译不能静态 import 它的 ESM 类型入口。
// 这里显式走 package exports 的 require 条件，保持 safeParseJson 的同步 API 不变。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { jsonrepair } = require('jsonrepair') as JsonRepairModule;

export class MalformedGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedGenerationError';
  }
}

export class InvalidVariableUsageError extends Error {
  readonly disallowedVariables: string[];
  readonly missingVariables: string[];
  readonly removedVariables: string[];
  constructor(disallowed: string[], missing: string[], removed: string[] = []) {
    super(
      `new prompt body violates variable whitelist — disallowed: [${disallowed.join(', ')}], missing: [${missing.join(', ')}], removed: [${removed.join(', ')}]`,
    );
    this.name = 'InvalidVariableUsageError';
    this.disallowedVariables = disallowed;
    this.missingVariables = missing;
    this.removedVariables = removed;
  }
}

export class InvalidAppliedChangeReferenceError extends Error {
  readonly invalidChangeIds: string[];
  constructor(invalidChangeIds: string[]) {
    super(`generate output references unknown suggestedChanges — invalid changeIds: [${invalidChangeIds.join(', ')}]`);
    this.name = 'InvalidAppliedChangeReferenceError';
    this.invalidChangeIds = invalidChangeIds;
  }
}

export function isTruncated(finishReason: string | null | undefined): boolean {
  return finishReason === 'length' || finishReason === 'max_tokens';
}

// 从 LLM 输出抽出第一个 JSON 对象 — 优先匹配 ```json ... ``` 块，回退到裸 JSON
export function extractJsonObject(text: string): string | null {
  if (!text) return null;
  // 优先 ```json fenced block
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)```/m.exec(text);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  // 回退：找第一个 { 到最后一个 }（保守 — 适合纯 JSON 输出无 markdown 包裹）
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }
  return null;
}

export function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // LLM 常输出非严格合规 JSON — 典型如字符串字面量内裸换行（Claude 在 ```json``` 代码块里
    // 写长字符串时常忘记 \n 转义）/ 尾随逗号 / 单引号 / 未转义反斜杠。strict 失败时用
    // jsonrepair 修复后再 parse，仍失败才放弃。快路径合法 JSON 保持零开销。
    try {
      return JSON.parse(jsonrepair(text));
    } catch {
      return null;
    }
  }
}

// =========================
// 三种 analyze 输出的解析
// =========================

export interface ConfusionAnalysisOutput {
  confusionPair?: string;
  errorPatterns: AnalysisPattern[];
  suggestedChanges: SuggestedChange[];
  truncated: boolean;
  rawContent: string;
}

export interface RegressionAnalysisOutput {
  errorPatterns: AnalysisPattern[];
  suggestedChanges: SuggestedChange[];
  truncated: boolean;
  rawContent: string;
}

export interface SummarizeOutput {
  summary: string;
  errorPatterns: Array<AnalysisPattern & { source?: 'confusion' | 'regression' }>;
  suggestedChanges: SuggestedChange[];
  conflicts?: SummarizeConflict[];
  evidenceBundleVersion: 1;
  truncated: boolean;
  rawContent: string;
}

function asStringArr(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === 'string');
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asPriority(value: unknown): SuggestedChange['priority'] {
  return value === 'high' || value === 'medium' || value === 'low' ? value : undefined;
}

function slugIdPart(value: string): string {
  const ascii = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (ascii) return ascii.slice(0, 48);
  let hash = 0;
  for (const ch of value) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return hash.toString(36);
}

function fallbackPatternId(input: {
  source?: 'confusion' | 'regression';
  bucketKey?: string;
  label: string;
  index: number;
}): string {
  const source = input.source ?? 'summary';
  const bucket = input.bucketKey ? `${slugIdPart(input.bucketKey)}-` : '';
  return `${source}:${bucket}p${input.index + 1}:${slugIdPart(input.label)}`;
}

function fallbackChangeId(input: {
  source?: 'confusion' | 'regression';
  bucketKey?: string;
  section: string;
  index: number;
}): string {
  const source = input.source ?? 'summary';
  const bucket = input.bucketKey ? `${slugIdPart(input.bucketKey)}-` : '';
  return `${source}:${bucket}c${input.index + 1}:${slugIdPart(input.section)}`;
}

interface ParsePatternOptions {
  source?: 'confusion' | 'regression';
  bucketKey?: string;
}

function parsePatterns(value: unknown, options: ParsePatternOptions = {}): AnalysisPattern[] {
  if (!Array.isArray(value)) return [];
  const out: AnalysisPattern[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const label = typeof obj.label === 'string' ? obj.label : null;
    if (!label) continue;
    const source =
      obj.source === 'confusion' || obj.source === 'regression' ? obj.source : options.source;
    const bucketKey =
      typeof obj.bucketKey === 'string'
        ? obj.bucketKey
        : typeof obj.confusionPair === 'string'
          ? obj.confusionPair
          : options.bucketKey;
    const count = typeof obj.count === 'number' ? obj.count : 0;
    out.push({
      patternId:
        typeof obj.patternId === 'string' && obj.patternId.length > 0
          ? obj.patternId
          : fallbackPatternId({ source, bucketKey, label, index }),
      source,
      bucketKey,
      affectedCount: asNumber(obj.affectedCount) ?? count,
      label,
      count,
      reason: typeof obj.reason === 'string' ? obj.reason : '',
      exampleSampleIds: asStringArr(obj.exampleSampleIds),
    });
  }
  return out;
}

interface ParseChangeOptions {
  source?: 'confusion' | 'regression';
  bucketKey?: string;
}

function parseSuggestedChanges(value: unknown, options: ParseChangeOptions = {}): SuggestedChange[] {
  if (!Array.isArray(value)) return [];
  const out: SuggestedChange[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const section = typeof obj.section === 'string' ? obj.section : null;
    const change = typeof obj.change === 'string' ? obj.change : null;
    if (!section || !change) continue;
    out.push({
      changeId:
        typeof obj.changeId === 'string' && obj.changeId.length > 0
          ? obj.changeId
          : fallbackChangeId({ source: options.source, bucketKey: options.bucketKey, section, index }),
      section,
      change,
      rationale: typeof obj.rationale === 'string' ? obj.rationale : '',
      addressesPatternIds: asStringArr(obj.addressesPatternIds ?? obj.patternIds ?? obj.patternId),
      evidenceSampleIds: asStringArr(obj.evidenceSampleIds ?? obj.exampleSampleIds),
      affectedCount: asNumber(obj.affectedCount),
      priority: asPriority(obj.priority),
      conflictGroup: typeof obj.conflictGroup === 'string' ? obj.conflictGroup : undefined,
      resolutionReason: typeof obj.resolutionReason === 'string' ? obj.resolutionReason : undefined,
    });
  }
  return out;
}

// 单批次（confusion 或 regression）evidence 归一化的上下文。
// analyze.ts 内 enrich 阶段的逻辑全部收敛到这里 —— 让 parse 出口直接吐出
// 「字段完整、ID 稳定、源信息齐全、聚合值已补」的稳定形态，上层只消费一种形态。
export interface NormalizeEvidenceContext {
  source: 'confusion' | 'regression';
  bucketKey: string;
  // 当 LLM 没给 affectedCount 时回填用 — 通常是 batch 的 count（confusion pair / regression group）
  affectedCountFallback: number;
}

export interface NormalizedEvidenceBatch {
  errorPatterns: AnalysisPattern[];
  suggestedChanges: SuggestedChange[];
}

// 给单个 batch 的 parse 结果做最后一层归一化:
// - errorPatterns: 补 patternId / source / bucketKey / affectedCount(fallback)
// - suggestedChanges: 推导 addressesPatternIds(空时落 batch 内所有 patternIds)、
//                     evidenceSampleIds(空时落 batch 内所有 exampleSampleIds)、
//                     affectedCount(空时取 patterns 求和或 fallback)
export function normalizeEvidenceBundle(
  raw: { errorPatterns: AnalysisPattern[]; suggestedChanges: SuggestedChange[] },
  ctx: NormalizeEvidenceContext,
): NormalizedEvidenceBatch {
  const errorPatterns = raw.errorPatterns.map((pattern, index) => ({
    ...pattern,
    patternId:
      pattern.patternId ?? `${ctx.source}:${slugIdPart(ctx.bucketKey)}:p${index + 1}`,
    source: pattern.source ?? ctx.source,
    bucketKey: pattern.bucketKey ?? ctx.bucketKey,
    affectedCount: pattern.affectedCount ?? pattern.count ?? ctx.affectedCountFallback,
  }));

  const patternIds = errorPatterns
    .map((p) => p.patternId)
    .filter((id): id is string => Boolean(id));
  const sampleIds = Array.from(new Set(errorPatterns.flatMap((p) => p.exampleSampleIds)));
  const patternsAffectedSum = errorPatterns.reduce(
    (sum, p) => sum + (p.affectedCount ?? p.count ?? 0),
    0,
  );

  const suggestedChanges = raw.suggestedChanges.map((change, index) => ({
    ...change,
    changeId:
      change.changeId ?? `${ctx.source}:${slugIdPart(ctx.bucketKey)}:c${index + 1}`,
    addressesPatternIds:
      change.addressesPatternIds && change.addressesPatternIds.length > 0
        ? change.addressesPatternIds
        : patternIds,
    evidenceSampleIds:
      change.evidenceSampleIds && change.evidenceSampleIds.length > 0
        ? change.evidenceSampleIds
        : sampleIds,
    affectedCount: change.affectedCount ?? (patternsAffectedSum || ctx.affectedCountFallback),
  }));

  return { errorPatterns, suggestedChanges };
}

function parseConflicts(value: unknown): SummarizeConflict[] {
  if (!Array.isArray(value)) return [];
  const out: SummarizeConflict[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    out.push({
      conflictGroup:
        typeof obj.conflictGroup === 'string' && obj.conflictGroup.length > 0
          ? obj.conflictGroup
          : `conflict:${index + 1}`,
      patternIds: asStringArr(obj.patternIds),
      changeIds: asStringArr(obj.changeIds),
      resolution: typeof obj.resolution === 'string' ? obj.resolution : '',
      reason: typeof obj.reason === 'string' ? obj.reason : '',
    });
  }
  return out;
}

export function parseConfusionAnalysisOutput(
  content: string,
  finishReason: string | null | undefined,
): ConfusionAnalysisOutput {
  const truncated = isTruncated(finishReason);
  const jsonText = extractJsonObject(content);
  if (!jsonText) {
    return { errorPatterns: [], suggestedChanges: [], truncated, rawContent: content };
  }
  const parsed = safeParseJson(jsonText);
  if (!parsed || typeof parsed !== 'object') {
    return { errorPatterns: [], suggestedChanges: [], truncated, rawContent: content };
  }
  const obj = parsed as Record<string, unknown>;
  const bucketKey = typeof obj.confusionPair === 'string' ? obj.confusionPair : undefined;
  return {
    confusionPair: bucketKey,
    errorPatterns: parsePatterns(obj.errorPatterns, { source: 'confusion', bucketKey }),
    suggestedChanges: parseSuggestedChanges(obj.suggestedChanges, { source: 'confusion', bucketKey }),
    truncated,
    rawContent: content,
  };
}

export function parseRegressionAnalysisOutput(
  content: string,
  finishReason: string | null | undefined,
): RegressionAnalysisOutput {
  const truncated = isTruncated(finishReason);
  const jsonText = extractJsonObject(content);
  if (!jsonText) {
    return { errorPatterns: [], suggestedChanges: [], truncated, rawContent: content };
  }
  const parsed = safeParseJson(jsonText);
  if (!parsed || typeof parsed !== 'object') {
    return { errorPatterns: [], suggestedChanges: [], truncated, rawContent: content };
  }
  const obj = parsed as Record<string, unknown>;
  return {
    errorPatterns: parsePatterns(obj.errorPatterns, { source: 'regression' }),
    suggestedChanges: parseSuggestedChanges(obj.suggestedChanges, { source: 'regression' }),
    truncated,
    rawContent: content,
  };
}

export function parseSummarizeOutput(
  content: string,
  finishReason: string | null | undefined,
): SummarizeOutput {
  const truncated = isTruncated(finishReason);
  const jsonText = extractJsonObject(content);
  if (!jsonText) {
    return {
      summary: content,
      errorPatterns: [],
      suggestedChanges: [],
      conflicts: [],
      evidenceBundleVersion: 1,
      truncated,
      rawContent: content,
    };
  }
  const parsed = safeParseJson(jsonText);
  if (!parsed || typeof parsed !== 'object') {
    return {
      summary: content,
      errorPatterns: [],
      suggestedChanges: [],
      conflicts: [],
      evidenceBundleVersion: 1,
      truncated,
      rawContent: content,
    };
  }
  const obj = parsed as Record<string, unknown>;
  const patterns = parsePatterns(obj.errorPatterns).map((p) => {
    const raw = (obj.errorPatterns as unknown[])?.find?.(
      (x) => x && typeof x === 'object' && (x as Record<string, unknown>).label === p.label,
    ) as Record<string, unknown> | undefined;
    const source = raw?.source === 'confusion' || raw?.source === 'regression' ? raw.source : undefined;
    return { ...p, source } as AnalysisPattern & { source?: 'confusion' | 'regression' };
  });
  return {
    summary: typeof obj.summary === 'string' && obj.summary.length > 0 ? obj.summary : content,
    errorPatterns: patterns,
    suggestedChanges: parseSuggestedChanges(obj.suggestedChanges),
    conflicts: parseConflicts(obj.conflicts),
    evidenceBundleVersion: 1,
    truncated,
    rawContent: content,
  };
}

// =========================
// generate 输出解析
// =========================

export interface GenerateOutput {
  newPromptBody: string;
  changeSummary: string;
  appliedTips: string[];
  variablesUsed: string[];
  truncated: boolean;
  rawContent: string;
  // 可选：LLM 在错误分析报告明确指出 schema 不足时输出的新 outputSchema（完整 JSON Schema 对象）。
  // 缺省 / 校验失败时上层降级为沿用旧 schema。
  newOutputSchema?: unknown;
  outputSchemaChangeReason?: string;
  appliedChanges?: Array<{ changeId: string; patternIds: string[]; summary: string }>;
  unappliedSuggestions?: Array<{ changeId: string; reason: string }>;
}

export interface OutputSchemaValidationResult {
  ok: boolean;
  errors: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// 校验 LLM 输出的 newOutputSchema 是否安全可接受。
// 规则（与 generate.system.md 第 3 条约束对齐）：
// - 新 schema 必须是 type=object 的 JSON Schema 对象，且 properties 是对象
// - 老 schema 的 properties keys ⊆ 新 schema 的 properties keys（不允许删字段）
// - 老字段的 type 必须保持不变（防止破坏解析契约）
// 若老 schema 不是 type=object 形态（极少见 — 自由形态 schema），仅校验新 schema 自身结构。
export function safeValidateNewOutputSchema(
  newSchema: unknown,
  oldSchema: unknown,
): OutputSchemaValidationResult {
  const errors: string[] = [];
  if (!isPlainObject(newSchema)) {
    errors.push('newOutputSchema must be a plain object');
    return { ok: false, errors };
  }
  const newType = (newSchema as { type?: unknown }).type;
  if (newType !== undefined && newType !== 'object') {
    errors.push(`newOutputSchema.type must be "object", got ${JSON.stringify(newType)}`);
  }
  const newProps = (newSchema as { properties?: unknown }).properties;
  if (!isPlainObject(newProps)) {
    errors.push('newOutputSchema.properties must be a plain object');
    return { ok: false, errors };
  }
  if (isPlainObject(oldSchema)) {
    const oldType = (oldSchema as { type?: unknown }).type;
    const oldProps = (oldSchema as { properties?: unknown }).properties;
    if ((oldType === undefined || oldType === 'object') && isPlainObject(oldProps)) {
      for (const [name, oldProp] of Object.entries(oldProps)) {
        if (!(name in newProps)) {
          errors.push(`existing field "${name}" was removed (not allowed)`);
          continue;
        }
        const oldPropType = isPlainObject(oldProp) ? (oldProp as { type?: unknown }).type : undefined;
        const newPropRaw = (newProps as Record<string, unknown>)[name];
        const newPropType = isPlainObject(newPropRaw) ? (newPropRaw as { type?: unknown }).type : undefined;
        if (oldPropType !== undefined && newPropType !== undefined && oldPropType !== newPropType) {
          errors.push(
            `existing field "${name}" type changed from ${JSON.stringify(oldPropType)} to ${JSON.stringify(newPropType)} (not allowed)`,
          );
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function parseGenerateOutput(
  content: string,
  finishReason: string | null | undefined,
): GenerateOutput {
  const truncated = isTruncated(finishReason);
  const jsonText = extractJsonObject(content);
  if (!jsonText) {
    throw new MalformedGenerationError('generate output: missing JSON block');
  }
  const parsed = safeParseJson(jsonText);
  if (!parsed || typeof parsed !== 'object') {
    throw new MalformedGenerationError('generate output: JSON parse failed');
  }
  const obj = parsed as Record<string, unknown>;
  const body = typeof obj.newPromptBody === 'string' ? obj.newPromptBody : null;
  if (!body || body.length === 0) {
    throw new MalformedGenerationError('generate output: newPromptBody is empty or missing');
  }
  const result: GenerateOutput = {
    newPromptBody: body,
    changeSummary: typeof obj.changeSummary === 'string' ? obj.changeSummary : '',
    appliedTips: asStringArr(obj.appliedTips),
    variablesUsed: asStringArr(obj.variablesUsed),
    truncated,
    rawContent: content,
  };
  if (isPlainObject(obj.newOutputSchema)) {
    result.newOutputSchema = obj.newOutputSchema;
  }
  if (typeof obj.outputSchemaChangeReason === 'string' && obj.outputSchemaChangeReason.length > 0) {
    result.outputSchemaChangeReason = obj.outputSchemaChangeReason;
  }
  const appliedChanges = parseAppliedChanges(obj.appliedChanges);
  if (appliedChanges.length > 0) result.appliedChanges = appliedChanges;
  const unappliedSuggestions = parseUnappliedSuggestions(obj.unappliedSuggestions);
  if (unappliedSuggestions.length > 0) result.unappliedSuggestions = unappliedSuggestions;
  return result;
}

function parseAppliedChanges(value: unknown): NonNullable<GenerateOutput['appliedChanges']> {
  if (!Array.isArray(value)) return [];
  const out: NonNullable<GenerateOutput['appliedChanges']> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const changeId = typeof obj.changeId === 'string' ? obj.changeId : null;
    if (!changeId) continue;
    out.push({
      changeId,
      patternIds: asStringArr(obj.patternIds ?? obj.addressesPatternIds),
      summary: typeof obj.summary === 'string' ? obj.summary : '',
    });
  }
  return out;
}

function parseUnappliedSuggestions(value: unknown): NonNullable<GenerateOutput['unappliedSuggestions']> {
  if (!Array.isArray(value)) return [];
  const out: NonNullable<GenerateOutput['unappliedSuggestions']> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const changeId = typeof obj.changeId === 'string' ? obj.changeId : null;
    if (!changeId) continue;
    out.push({
      changeId,
      reason: typeof obj.reason === 'string' ? obj.reason : '',
    });
  }
  return out;
}

// =========================
// 变量白名单校验
// =========================

import { extractVariableNames } from './prompts';

export interface VariableValidationResult {
  ok: boolean;
  disallowed: string[];
  missing: string[];
  // base 已经用过的变量被新版本丢弃（如 base 用 {{text}}、新版没占位）— ok 需为 false
  removed: string[];
  detected: string[];
}

// 校验新 prompt body 引用的变量 ⊆ promptVariables，且包含 LLM 自报的 variablesUsed；
// requiredVariables（通常 = base body 已用且仍在白名单内的变量）必须都保留在 newPromptBody。
export function validatePromptVariables(
  newPromptBody: string,
  promptVariables: string[],
  reportedVariablesUsed: string[],
  requiredVariables: string[] = [],
): VariableValidationResult {
  const detected = extractVariableNames(newPromptBody);
  const allowedSet = new Set(promptVariables);
  const disallowed = detected.filter((v) => !allowedSet.has(v));
  const reportedSet = new Set(reportedVariablesUsed);
  // 不强制 reported = detected — 只要 detected ⊆ promptVariables 即 OK
  // missing 字段保留：上层可警告 LLM 自报与实际不符
  const missing = detected.filter((v) => !reportedSet.has(v));
  const detectedSet = new Set(detected);
  const removed = requiredVariables.filter((v) => !detectedSet.has(v));
  return {
    ok: disallowed.length === 0 && removed.length === 0,
    disallowed,
    missing,
    removed,
    detected,
  };
}

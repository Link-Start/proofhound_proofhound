// 混淆对 TOP N + 回归样本检测
import type { FieldWhitelist, RunResultRecord, SampleRecord } from '../loop/types';

export interface SampleView {
  sampleId: string;
  // 给「分析 LLM」看的字段集合（含 promptVariables ∪ analysisOnlyFields）
  inputForAnalysis: Record<string, unknown>;
  expected: string | null;
  predicted: string | null;
  errorMessage?: string | null;
}

export interface ConfusionPair {
  expected: string;
  predicted: string;
  count: number;
  sampleIds: string[];
  // 该对下面的样本视图（已按 maxSamplesPerPair 截取）
  samples: SampleView[];
}

export interface RegressionGroup {
  // 上一轮预测正确、本轮预测错误 — 按 predicted 聚类便于分析
  predicted: string;
  count: number;
  samples: SampleView[];
}

function projectInput(sample: SampleRecord, whitelist: FieldWhitelist): Record<string, unknown> {
  const allowed = new Set<string>([
    ...whitelist.promptVariables,
    ...(whitelist.analysisOnlyFields ?? []),
  ]);
  // 没配置任何字段 → 原样返回（防御性兜底）
  if (allowed.size === 0) return sample.input;
  const projected: Record<string, unknown> = {};
  for (const field of allowed) {
    if (field in sample.input) projected[field] = sample.input[field];
  }
  return projected;
}

function asLabel(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function buildSampleView(
  sample: SampleRecord,
  rr: RunResultRecord,
  whitelist: FieldWhitelist,
): SampleView {
  return {
    sampleId: sample.id,
    inputForAnalysis: projectInput(sample, whitelist),
    expected: asLabel(sample.expected),
    predicted: rr.decisionOutput ?? asLabel(rr.parsedOutput),
    errorMessage: rr.errorMessage ?? null,
  };
}

function indexById<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function indexResultsBySampleId(runResults: RunResultRecord[]): Map<string, RunResultRecord> {
  const m = new Map<string, RunResultRecord>();
  for (const rr of runResults) m.set(rr.sampleId, rr);
  return m;
}

export interface BuildConfusionPairsArgs {
  runResults: RunResultRecord[];
  samples: SampleRecord[];
  whitelist: FieldWhitelist;
  topN: number;
  maxSamplesPerPair: number;
}

export function buildConfusionPairs(args: BuildConfusionPairsArgs): ConfusionPair[] {
  const sampleById = indexById(args.samples);
  const pairs = new Map<string, ConfusionPair>();

  for (const rr of args.runResults) {
    const sample = sampleById.get(rr.sampleId);
    if (!sample) continue;
    // 只考虑可判定的错误（has expected + has predicted + isCorrect===false）
    const expected = asLabel(sample.expected);
    const predicted = rr.decisionOutput ?? asLabel(rr.parsedOutput);
    if (rr.isCorrect !== false) continue;
    if (expected == null || predicted == null) continue;

    const key = `${expected}→${predicted}`;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { expected, predicted, count: 0, sampleIds: [], samples: [] };
      pairs.set(key, pair);
    }
    pair.count++;
    pair.sampleIds.push(sample.id);
    if (pair.samples.length < args.maxSamplesPerPair) {
      pair.samples.push(buildSampleView(sample, rr, args.whitelist));
    }
  }

  return [...pairs.values()].sort((a, b) => b.count - a.count).slice(0, args.topN);
}

export interface BuildRegressionGroupsArgs {
  currentRunResults: RunResultRecord[];
  previousRunResults: RunResultRecord[] | null;
  samples: SampleRecord[];
  whitelist: FieldWhitelist;
  maxSamples: number;
}

export function buildRegressionGroups(args: BuildRegressionGroupsArgs): RegressionGroup[] {
  if (!args.previousRunResults || args.previousRunResults.length === 0) return [];
  const sampleById = indexById(args.samples);
  const prevBySample = indexResultsBySampleId(args.previousRunResults);

  const regressionViews: SampleView[] = [];
  for (const curr of args.currentRunResults) {
    if (curr.isCorrect !== false) continue;
    const prev = prevBySample.get(curr.sampleId);
    if (!prev || prev.isCorrect !== true) continue;
    const sample = sampleById.get(curr.sampleId);
    if (!sample) continue;
    regressionViews.push(buildSampleView(sample, curr, args.whitelist));
    if (regressionViews.length >= args.maxSamples) break;
  }

  if (regressionViews.length === 0) return [];

  const groups = new Map<string, RegressionGroup>();
  for (const view of regressionViews) {
    const key = view.predicted ?? '__unknown__';
    let g = groups.get(key);
    if (!g) {
      g = { predicted: key, count: 0, samples: [] };
      groups.set(key, g);
    }
    g.count++;
    g.samples.push(view);
  }

  return [...groups.values()].sort((a, b) => b.count - a.count);
}

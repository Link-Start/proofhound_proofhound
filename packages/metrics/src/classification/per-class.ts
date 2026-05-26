// Bucket by expected_output category; count TP/FP/FN/support per class
// See docs/specs/24-experiments.md §6
import type { ClassificationAggregateRow, MetricsStrategy } from '../types';

interface ConfusionCounts {
  tp: number;
  fp: number;
  fn: number;
  support: number;
}

const NULL_LABEL = '__null__';
function labelOf(value: string | null): string {
  if (value === null || value === undefined) return NULL_LABEL;
  return value;
}

export function computePerClassConfusion(rows: ClassificationAggregateRow[]): Record<string, ConfusionCounts> {
  const buckets = new Map<string, ConfusionCounts>();
  function bucket(label: string): ConfusionCounts {
    let entry = buckets.get(label);
    if (!entry) {
      entry = { tp: 0, fp: 0, fn: 0, support: 0 };
      buckets.set(label, entry);
    }
    return entry;
  }

  for (const row of rows) {
    if (row.status !== 'success') continue;
    if (row.judgmentStatus === 'parse_error' || row.judgmentStatus === 'judge_error') continue;
    const decisionLabel = labelOf(row.decisionOutput);
    const expectedLabel = labelOf(row.expectedOutput);

    if (row.judgmentStatus === 'correct') {
      const b = bucket(decisionLabel);
      b.tp += row.count;
      b.support += row.count;
    } else if (row.judgmentStatus === 'incorrect') {
      bucket(decisionLabel).fp += row.count;
      const expectedBucket = bucket(expectedLabel);
      expectedBucket.fn += row.count;
      expectedBucket.support += row.count;
    }
  }

  const result: Record<string, ConfusionCounts> = {};
  for (const [label, counts] of buckets) {
    if (label === NULL_LABEL) continue;
    result[label] = counts;
  }
  return result;
}

export const perClassStrategy: MetricsStrategy = {
  projectType: 'classification',
  metricName: 'per-class',
  compute(rows) {
    return computePerClassConfusion(rows);
  },
};

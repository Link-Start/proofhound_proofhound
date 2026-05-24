// 准确率：正确数 / 已写入运行结果总数
// 详见 docs/specs/24-experiments.md §6
import type { ClassificationAggregateRow, MetricsStrategy } from '../types';

export function computeAccuracy(rows: ClassificationAggregateRow[]): { accuracy: number | null; correct: number; total: number } {
  let correct = 0;
  let total = 0;
  for (const row of rows) {
    total += row.count;
    if (row.status === 'success' && row.judgmentStatus === 'correct') {
      correct += row.count;
    }
  }
  return {
    accuracy: total === 0 ? null : correct / total,
    correct,
    total,
  };
}

export const accuracyStrategy: MetricsStrategy = {
  projectType: 'classification',
  metricName: 'accuracy',
  compute(rows) {
    return computeAccuracy(rows);
  },
};

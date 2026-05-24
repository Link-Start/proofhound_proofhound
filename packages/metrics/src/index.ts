// 离线实验指标策略出口
// 详见 docs/specs/07-code-structure.md §12 + docs/specs/24-experiments.md
import './classification';
import { computeClassificationMetrics } from './classification';
import type { ClassificationAggregateRow, ClassificationMetrics, ProjectType } from './types';

export * from './types';
export * from './registry';
export * from './classification';

export function computeMetrics(projectType: ProjectType, rows: ClassificationAggregateRow[]): ClassificationMetrics | null {
  if (projectType === 'classification') {
    return computeClassificationMetrics(rows);
  }
  return null;
}

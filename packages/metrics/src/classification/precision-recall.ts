// Precision / Recall — per-class + macro average
// See docs/specs/24-experiments.md §6
import type { ClassificationPerClassEntry, MetricsStrategy } from '../types';

interface ConfusionCounts {
  tp: number;
  fp: number;
  fn: number;
  support: number;
}

export function computePrecisionRecall(confusion: Record<string, ConfusionCounts>): {
  perClass: ClassificationPerClassEntry[];
  macroPrecision: number | null;
  macroRecall: number | null;
} {
  const entries: ClassificationPerClassEntry[] = Object.entries(confusion).map(([label, counts]) => {
    const precision = counts.tp + counts.fp === 0 ? null : counts.tp / (counts.tp + counts.fp);
    const recall = counts.tp + counts.fn === 0 ? null : counts.tp / (counts.tp + counts.fn);
    return {
      label,
      tp: counts.tp,
      fp: counts.fp,
      fn: counts.fn,
      support: counts.support,
      precision,
      recall,
      f1: null,
    };
  });

  const precisions = entries.map((e) => e.precision).filter((v): v is number => v !== null);
  const recalls = entries.map((e) => e.recall).filter((v): v is number => v !== null);

  return {
    perClass: entries,
    macroPrecision: precisions.length === 0 ? null : precisions.reduce((s, v) => s + v, 0) / precisions.length,
    macroRecall: recalls.length === 0 ? null : recalls.reduce((s, v) => s + v, 0) / recalls.length,
  };
}

export const precisionRecallStrategy: MetricsStrategy = {
  projectType: 'classification',
  metricName: 'precision-recall',
  compute() {
    // Placeholder: this strategy needs the confusion to be passed in externally; call computePrecisionRecall directly
    return null;
  },
};

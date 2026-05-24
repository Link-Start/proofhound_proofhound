// F1: 2 * P * R / (P + R) —— per-class + macro
// 详见 docs/specs/24-experiments.md §6
import type { ClassificationPerClassEntry, MetricsStrategy } from '../types';

export function computeF1(entries: ClassificationPerClassEntry[]): {
  perClass: ClassificationPerClassEntry[];
  macroF1: number | null;
} {
  const withF1 = entries.map((entry) => {
    if (entry.precision === null || entry.recall === null || entry.precision + entry.recall === 0) {
      return { ...entry, f1: entry.precision === 0 && entry.recall === 0 ? 0 : null };
    }
    const f1 = (2 * entry.precision * entry.recall) / (entry.precision + entry.recall);
    return { ...entry, f1 };
  });

  const f1Values = withF1.map((e) => e.f1).filter((v): v is number => v !== null);
  return {
    perClass: withF1,
    macroF1: f1Values.length === 0 ? null : f1Values.reduce((s, v) => s + v, 0) / f1Values.length,
  };
}

export const f1Strategy: MetricsStrategy = {
  projectType: 'classification',
  metricName: 'f1',
  compute() {
    return null;
  },
};

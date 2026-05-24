import type { MetricsStrategy, ProjectType } from './types';

const registry = new Map<string, MetricsStrategy>();

function key(projectType: ProjectType, metricName: string) {
  return `${projectType}::${metricName}`;
}

export function registerMetric(s: MetricsStrategy) {
  registry.set(key(s.projectType, s.metricName), s);
}

export function getMetric(projectType: ProjectType, metricName: string): MetricsStrategy {
  const s = registry.get(key(projectType, metricName));
  if (!s) throw new Error(`Unknown metric: ${projectType}::${metricName}`);
  return s;
}

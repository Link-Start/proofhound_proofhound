import type { OptimizationStrategy, ProjectType } from './types';

const registry = new Map<string, OptimizationStrategy>();

export function registerStrategy(s: OptimizationStrategy) {
  registry.set(s.key, s);
}

export function getStrategy(key: string): OptimizationStrategy {
  const s = registry.get(key);
  if (!s) throw new Error(`Unknown optimization strategy: ${key}`);
  return s;
}

export function listStrategiesFor(projectType: ProjectType) {
  return [...registry.values()].filter((s) => s.projectTypes.includes(projectType));
}

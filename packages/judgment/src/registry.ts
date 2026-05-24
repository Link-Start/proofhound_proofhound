// 按 (projectType, ruleName) 二级 key 注册
// 详见 docs/specs/07-code-structure.md §12.2
import type { JudgmentStrategy, ProjectType } from './types';

const registry = new Map<string, JudgmentStrategy>();

function key(projectType: ProjectType, ruleName: string) {
  return `${projectType}::${ruleName}`;
}

export function registerJudgment(s: JudgmentStrategy) {
  registry.set(key(s.projectType, s.ruleName), s);
}

export function getJudgment(projectType: ProjectType, ruleName: string): JudgmentStrategy {
  const s = registry.get(key(projectType, ruleName));
  if (!s) throw new Error(`Unknown judgment strategy: ${projectType}::${ruleName}`);
  return s;
}

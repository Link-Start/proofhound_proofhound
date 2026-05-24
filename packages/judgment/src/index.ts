// 判定策略出口 — V1 注册 classification
// 详见 docs/specs/07-code-structure.md §12（扩展点）+ docs/specs/24-experiments.md §7
import './classification';
import { evaluateClassificationJudgment } from './classification';
import type { JudgmentContext, JudgmentOutcome, ProjectType } from './types';

export * from './types';
export * from './registry';
export * from './classification';

export function evaluateJudgment(
  projectType: ProjectType,
  parsedOutput: unknown,
  context: JudgmentContext,
): JudgmentOutcome {
  if (projectType === 'classification') {
    return evaluateClassificationJudgment(parsedOutput, context);
  }
  return { decisionOutput: null, isCorrect: null, judgmentStatus: 'judge_error' };
}

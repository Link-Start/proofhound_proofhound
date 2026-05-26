// Judgment strategy exports — V1 registers classification
// See docs/specs/07-code-structure.md §12 (extension points) + docs/specs/24-experiments.md §7
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

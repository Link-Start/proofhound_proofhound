// JudgmentStrategy interface — see docs/specs/07-code-structure.md §12.2 + docs/specs/24-experiments.md §7
export type ProjectType = 'classification' | 'generative' | 'agent';

export type JudgmentStatus = 'correct' | 'incorrect' | 'parse_error' | 'judge_error';

export interface JudgmentContext {
  outputSchema: unknown;
  judgmentRules: unknown;
  expectedOutput: unknown;
}

export interface JudgmentOutcome {
  decisionOutput: string | null;
  isCorrect: boolean | null;
  judgmentStatus: JudgmentStatus;
}

export interface JudgmentStrategy {
  projectType: ProjectType;
  ruleName: string;
  evaluate(parsedOutput: unknown, context: JudgmentContext): JudgmentOutcome;
}

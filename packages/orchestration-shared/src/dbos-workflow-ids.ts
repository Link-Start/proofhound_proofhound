// DBOS workflow inventory
// See docs/specs/03-orchestration.md §3
export const DBOS_WORKFLOW_NAMES = ['ExperimentWorkflow', 'OptimizationWorkflow'] as const;

export type DbosWorkflowName = (typeof DBOS_WORKFLOW_NAMES)[number];

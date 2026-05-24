// BullMQ handler / DBOS step 抛出后不应再重试的错误类名
// 详见 docs/specs/03-orchestration.md §4.2
export const NON_RETRYABLE_ERROR_TYPES = ['ValidationError', 'PermissionDenied', 'PromptVersionFrozen'] as const;

export type NonRetryableErrorType = (typeof NON_RETRYABLE_ERROR_TYPES)[number];

export function isNonRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (NON_RETRYABLE_ERROR_TYPES as readonly string[]).includes(error.name);
}

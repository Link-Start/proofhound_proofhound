export interface RateLimitConfig {
  rpmLimit: number;
  tpmLimit: number;
  concurrencyLimit: number;
}

export interface AcquireArgs {
  modelId: string;
  estimatedTokens: number;
  limits: RateLimitConfig;
  // When true, concurrencyLimit is treated as a ceiling and the effective concurrency
  // is auto-derived (Little's Law + AIMD backoff). See docs/specs/21-models.md §6.1
  autoConcurrency?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

// Auto-concurrency derivation surfaced by a successful acquire (for observability/logging).
export interface AcquireResult {
  effectiveConcurrency: number;
  backoffFactor: number;
  latencyEwmaMs: number;
}

export interface ReleaseArgs {
  modelId: string;
}

// Feedback signal used to adapt the auto-concurrency state for a model.
export interface ReportOutcomeArgs {
  modelId: string;
  kind: 'success' | 'upstream_throttle';
  latencyMs?: number; // success only
  tokens?: number; // success only: input + output
}

export interface UsageSnapshot {
  modelId: string;
  rpmUsed: number;
  tpmUsed: number;
  concurrencyInUse: number;
  windowMs: number;
  windowEndsAt: string;
  // Auto-concurrency observability (present once the model has accumulated autostate).
  backoffFactor?: number;
  latencyEwmaMs?: number;
  tokensEwma?: number;
}

export interface RateLimiter {
  acquire(args: AcquireArgs): Promise<AcquireResult | void>;
  release(args: ReleaseArgs): Promise<void>;
  getUsage?(modelId: string): Promise<UsageSnapshot>;
  reportOutcome?(args: ReportOutcomeArgs): Promise<void>;
}

export class RateLimitExceededError extends Error {
  readonly reason: 'rpm' | 'tpm' | 'concurrency';
  readonly retryAfterMs: number;

  constructor(reason: 'rpm' | 'tpm' | 'concurrency', retryAfterMs: number) {
    super(`rate limit exceeded: ${reason}`);
    this.name = 'RateLimitExceededError';
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}

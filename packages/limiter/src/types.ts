export interface RateLimitConfig {
  rpmLimit: number;
  tpmLimit: number;
  concurrencyLimit: number;
}

export interface AcquireArgs {
  modelId: string;
  estimatedTokens: number;
  limits: RateLimitConfig;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface ReleaseArgs {
  modelId: string;
}

export interface UsageSnapshot {
  modelId: string;
  rpmUsed: number;
  tpmUsed: number;
  concurrencyInUse: number;
  windowMs: number;
  windowEndsAt: string;
}

export interface RateLimiter {
  acquire(args: AcquireArgs): Promise<void>;
  release(args: ReleaseArgs): Promise<void>;
  getUsage?(modelId: string): Promise<UsageSnapshot>;
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

import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import {
  RateLimitExceededError,
  type AcquireArgs,
  type RateLimiter,
  type ReleaseArgs,
  type UsageSnapshot,
} from './types';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 250;
// concurrency key 自愈窗口：进程崩溃后超过此时长无新 acquire，则 slot 自动归零
// 与 SPEC 03 §4.3 的 LLM job timeout 对齐（5 min）
const DEFAULT_CONCURRENCY_TTL_MS = 5 * 60_000;

const SLIDING_WINDOW_HELPERS = `
local function member_tokens(member)
  local raw = string.match(member, ':(%d+)$')
  return tonumber(raw or '0') or 0
end

local function sum_tpm_members(tpm_key)
  local members = redis.call('ZRANGE', tpm_key, 0, -1)
  local total = 0
  for _, member in ipairs(members) do
    total = total + member_tokens(member)
  end
  return total
end

local function prune_rpm(rpm_key, cutoff_ms)
  redis.call('ZREMRANGEBYSCORE', rpm_key, '-inf', cutoff_ms)
  local count = tonumber(redis.call('ZCARD', rpm_key) or '0')
  if count == 0 then
    redis.call('DEL', rpm_key)
  end
  return count
end

local function prune_tpm(tpm_key, tpm_total_key, cutoff_ms, ttl_ms)
  local expired = redis.call('ZRANGEBYSCORE', tpm_key, '-inf', cutoff_ms)
  local expired_tokens = 0
  for _, member in ipairs(expired) do
    expired_tokens = expired_tokens + member_tokens(member)
  end

  local raw_total = redis.call('GET', tpm_total_key)
  local had_total = raw_total ~= false
  local total = tonumber(raw_total or '0') or 0

  if #expired > 0 then
    redis.call('ZREMRANGEBYSCORE', tpm_key, '-inf', cutoff_ms)
  end

  local remaining = tonumber(redis.call('ZCARD', tpm_key) or '0')
  if remaining == 0 then
    redis.call('DEL', tpm_key)
    redis.call('DEL', tpm_total_key)
    return 0
  end

  if had_total then
    total = total - expired_tokens
  else
    total = sum_tpm_members(tpm_key)
  end

  if total > 0 then
    redis.call('SET', tpm_total_key, total)
    redis.call('PEXPIRE', tpm_total_key, ttl_ms)
    return total
  end

  redis.call('DEL', tpm_total_key)
  return 0
end
`;

const ACQUIRE_SCRIPT = `
${SLIDING_WINDOW_HELPERS}
local rpm_key = KEYS[1]
local tpm_key = KEYS[2]
local tpm_total_key = KEYS[3]
local concurrency_key = KEYS[4]

local rpm_limit = tonumber(ARGV[1])
local tpm_limit = tonumber(ARGV[2])
local concurrency_limit = tonumber(ARGV[3])
local requested_tokens = tonumber(ARGV[4])
local window_ms = tonumber(ARGV[5])
local concurrency_ttl_ms = tonumber(ARGV[6])
local request_member = ARGV[7]
local ttl_ms = window_ms * 2

local now = redis.call('TIME')
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local cutoff_ms = now_ms - window_ms

local rpm = prune_rpm(rpm_key, cutoff_ms)
local tpm = prune_tpm(tpm_key, tpm_total_key, cutoff_ms, ttl_ms)
local concurrency = tonumber(redis.call('GET', concurrency_key) or '0')

if rpm_limit > 0 and rpm + 1 > rpm_limit then
  local oldest = redis.call('ZRANGE', rpm_key, 0, 0, 'WITHSCORES')
  local retry_after_ms = window_ms
  if oldest[2] then
    retry_after_ms = math.max(0, tonumber(oldest[2]) + window_ms - now_ms)
  end
  return {0, retry_after_ms, 'rpm'}
end

if tpm_limit > 0 and tpm + requested_tokens > tpm_limit then
  local events = redis.call('ZRANGE', tpm_key, 0, -1, 'WITHSCORES')
  local projected = tpm
  local retry_at_ms = nil
  for i = 1, #events, 2 do
    projected = projected - member_tokens(events[i])
    if projected + requested_tokens <= tpm_limit then
      retry_at_ms = tonumber(events[i + 1]) + window_ms
      break
    end
  end

  local retry_after_ms = window_ms
  if retry_at_ms ~= nil then
    retry_after_ms = math.max(0, retry_at_ms - now_ms)
  end
  return {0, retry_after_ms, 'tpm'}
end

if concurrency_limit > 0 and concurrency + 1 > concurrency_limit then
  return {0, 250, 'concurrency'}
end

redis.call('ZADD', rpm_key, now_ms, request_member)
redis.call('ZADD', tpm_key, now_ms, request_member .. ':' .. requested_tokens)
redis.call('PEXPIRE', rpm_key, ttl_ms)
redis.call('PEXPIRE', tpm_key, ttl_ms)

local updated_tpm = tpm + requested_tokens
if updated_tpm > 0 then
  redis.call('SET', tpm_total_key, updated_tpm)
  redis.call('PEXPIRE', tpm_total_key, ttl_ms)
else
  redis.call('DEL', tpm_total_key)
end

redis.call('INCR', concurrency_key)
redis.call('PEXPIRE', concurrency_key, concurrency_ttl_ms)

return {1, 0, 'ok'}
`;

const USAGE_SCRIPT = `
${SLIDING_WINDOW_HELPERS}
local window_ms = tonumber(ARGV[1])
local ttl_ms = window_ms * 2
local now = redis.call('TIME')
local now_ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local cutoff_ms = now_ms - window_ms

local rpm = prune_rpm(KEYS[1], cutoff_ms)
local tpm = prune_tpm(KEYS[2], KEYS[3], cutoff_ms, ttl_ms)
local concurrency = tonumber(redis.call('GET', KEYS[4]) or '0')

return {rpm, tpm, concurrency, now_ms}
`;

// RELEASE_SCRIPT — floor at 0：避免误调让 concurrency 计数变负
// 计数 <= 0 时直接 DEL 并 return 0，调用方可据此判断"没东西可释放"
const RELEASE_SCRIPT = `
local concurrency = tonumber(redis.call('GET', KEYS[1]) or '0')
local concurrency_ttl_ms = tonumber(ARGV[1])

if concurrency <= 0 then
  redis.call('DEL', KEYS[1])
  return 0
end

if concurrency <= 1 then
  redis.call('DEL', KEYS[1])
  return 1
end

redis.call('DECR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], concurrency_ttl_ms)
return 1
`;

interface RedisEvalClient {
  eval(script: string, keyCount: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface RedisLimiterOptions {
  keyPrefix?: string;
  windowMs?: number;
  concurrencyTtlMs?: number;
}

// Redis 滑动窗口 + Lua 原子脚本实现
// 详见 docs/specs/02-tech-stack.md §6
export class RedisLimiter implements RateLimiter {
  private readonly keyPrefix: string;
  private readonly windowMs: number;
  private readonly concurrencyTtlMs: number;

  constructor(
    private readonly redis: Redis | RedisEvalClient,
    options: RedisLimiterOptions = {},
  ) {
    this.keyPrefix = options.keyPrefix ?? 'ph:limiter:llm';
    this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    this.concurrencyTtlMs = options.concurrencyTtlMs ?? DEFAULT_CONCURRENCY_TTL_MS;
  }

  async acquire(args: AcquireArgs): Promise<void> {
    const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pollIntervalMs = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const startedAt = Date.now();
    let lastFailure: RateLimitExceededError | undefined;
    const requestMember = randomUUID();

    while (true) {
      const [rpmKey, tpmKey, tpmTotalKey, concurrencyKey] = this.keys(args.modelId);
      const result = await this.redis.eval(
        ACQUIRE_SCRIPT,
        4,
        rpmKey,
        tpmKey,
        tpmTotalKey,
        concurrencyKey,
        args.limits.rpmLimit,
        args.limits.tpmLimit,
        args.limits.concurrencyLimit,
        Math.max(0, Math.ceil(args.estimatedTokens)),
        this.windowMs,
        this.concurrencyTtlMs,
        requestMember,
      );
      const [acquired, retryAfterMs, reason] = normalizeAcquireResult(result);

      if (acquired) return;

      lastFailure = new RateLimitExceededError(reason, retryAfterMs);
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0) break;

      await sleep(Math.min(Math.max(retryAfterMs, pollIntervalMs), remainingMs));
    }

    throw lastFailure ?? new RateLimitExceededError('concurrency', pollIntervalMs);
  }

  async release(args: ReleaseArgs): Promise<void> {
    const concurrencyKey = this.concurrencyKey(args.modelId);
    await this.redis.eval(RELEASE_SCRIPT, 1, concurrencyKey, this.concurrencyTtlMs);
  }

  async getUsage(modelId: string): Promise<UsageSnapshot> {
    const [rpmKey, tpmKey, tpmTotalKey, concurrencyKey] = this.keys(modelId);
    const result = await this.redis.eval(
      USAGE_SCRIPT,
      4,
      rpmKey,
      tpmKey,
      tpmTotalKey,
      concurrencyKey,
      this.windowMs,
    );
    const [rpmUsed, tpmUsed, concurrencyInUse, sampledAtMs] = normalizeUsageResult(result);

    return {
      modelId,
      rpmUsed,
      tpmUsed,
      concurrencyInUse,
      windowMs: this.windowMs,
      windowEndsAt: new Date(sampledAtMs).toISOString(),
    };
  }

  private keys(modelId: string): [string, string, string, string] {
    return [
      `${this.keyPrefix}:${modelId}:rpm`,
      `${this.keyPrefix}:${modelId}:tpm`,
      `${this.keyPrefix}:${modelId}:tpm:total`,
      this.concurrencyKey(modelId),
    ];
  }

  private concurrencyKey(modelId: string): string {
    return `${this.keyPrefix}:${modelId}:concurrency`;
  }
}

function normalizeAcquireResult(result: unknown): [boolean, number, 'rpm' | 'tpm' | 'concurrency'] {
  if (!Array.isArray(result)) {
    throw new Error('unexpected Redis limiter result');
  }

  const acquired = Number(result[0]) === 1;
  const retryAfterMs = Math.max(0, Number(result[1]) || 0);
  const reason = result[2] === 'rpm' || result[2] === 'tpm' ? result[2] : 'concurrency';

  return [acquired, retryAfterMs, reason];
}

function normalizeUsageResult(result: unknown): [number, number, number, number] {
  if (!Array.isArray(result)) {
    throw new Error('unexpected Redis limiter usage result');
  }

  const sampledAtMs = parseCount(result[3]) || Date.now();
  return [parseCount(result[0]), parseCount(result[1]), parseCount(result[2]), sampledAtMs];
}

function parseCount(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { describe, expect, it, vi } from 'vitest';
import { RedisLimiter } from './redis-limiter';
import { RateLimitExceededError } from './types';

describe('RedisLimiter', () => {
  it('acquires and releases model concurrency through Redis scripts', async () => {
    const evalMock = vi.fn(async (script: string, _keyCount: number, ..._args: Array<string | number>) =>
      script.includes('return {1, 0') ? [1, 0, 'ok'] : 1,
    );
    const redis = { eval: evalMock };
    const limiter = new RedisLimiter(redis);

    await limiter.acquire({
      modelId: 'model-1',
      estimatedTokens: 12,
      limits: { rpmLimit: 60, tpmLimit: 1000, concurrencyLimit: 2 },
    });
    await limiter.release({ modelId: 'model-1' });

    expect(evalMock).toHaveBeenCalledTimes(2);
    expect(evalMock.mock.calls[0]?.[1]).toBe(4);
    expect(evalMock.mock.calls[1]?.[1]).toBe(1);

    // The 6th ARGV of ACQUIRE is concurrency_ttl_ms (default 5 min)
    const acquireArgs = evalMock.mock.calls[0]!;
    expect(acquireArgs[acquireArgs.length - 2]).toBe(5 * 60_000);
    expect(typeof acquireArgs[acquireArgs.length - 1]).toBe('string');
  });

  it('uses Redis sorted sets for RPM and TPM sliding windows', async () => {
    const evalMock = vi.fn(
      async (_script: string, _keyCount: number, ..._args: Array<string | number>) => [1, 0, 'ok'],
    );
    const redis = { eval: evalMock };
    const limiter = new RedisLimiter(redis);

    await limiter.acquire({
      modelId: 'model-1',
      estimatedTokens: 12,
      limits: { rpmLimit: 60, tpmLimit: 1000, concurrencyLimit: 2 },
    });

    const acquireScript = evalMock.mock.calls[0]?.[0] as string;
    expect(acquireScript).toMatch(/ZREMRANGEBYSCORE/);
    expect(acquireScript).toMatch(/ZADD', rpm_key/);
    expect(acquireScript).toMatch(/ZADD', tpm_key/);
    expect(acquireScript).toMatch(/tpm_total_key/);
  });

  it('raises a typed error when the Redis script keeps rejecting on rpm', async () => {
    const redis = { eval: vi.fn(async () => [0, 0, 'rpm']) };
    const limiter = new RedisLimiter(redis);

    await expect(
      limiter.acquire({
        modelId: 'm',
        estimatedTokens: 12,
        timeoutMs: 0,
        pollIntervalMs: 0,
        limits: { rpmLimit: 1, tpmLimit: 1000, concurrencyLimit: 2 },
      }),
    ).rejects.toMatchObject({
      name: 'RateLimitExceededError',
      reason: 'rpm',
    });
  });

  it('raises with reason=tpm when TPM is the binding limit', async () => {
    const redis = { eval: vi.fn(async () => [0, 0, 'tpm']) };
    const limiter = new RedisLimiter(redis);

    await expect(
      limiter.acquire({
        modelId: 'm',
        estimatedTokens: 5000,
        timeoutMs: 0,
        pollIntervalMs: 0,
        limits: { rpmLimit: 60, tpmLimit: 1000, concurrencyLimit: 2 },
      }),
    ).rejects.toMatchObject({ reason: 'tpm' });
  });

  it('raises with reason=concurrency when slots are exhausted', async () => {
    const redis = { eval: vi.fn(async () => [0, 250, 'concurrency']) };
    const limiter = new RedisLimiter(redis);

    await expect(
      limiter.acquire({
        modelId: 'm',
        estimatedTokens: 10,
        timeoutMs: 0,
        pollIntervalMs: 0,
        limits: { rpmLimit: 60, tpmLimit: 1000, concurrencyLimit: 1 },
      }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);
  });

  it('does not call release when acquire throws', async () => {
    const evalMock = vi.fn(async () => [0, 0, 'rpm']);
    const redis = { eval: evalMock };
    const limiter = new RedisLimiter(redis);

    await expect(
      limiter.acquire({
        modelId: 'm',
        estimatedTokens: 10,
        timeoutMs: 0,
        pollIntervalMs: 0,
        limits: { rpmLimit: 1, tpmLimit: 1000, concurrencyLimit: 2 },
      }),
    ).rejects.toBeInstanceOf(RateLimitExceededError);

    // One ACQUIRE call, no RELEASE
    expect(evalMock).toHaveBeenCalledTimes(1);
  });

  it('release script floors at zero (regression: never decrement below 0)', async () => {
    // Verify the floor branch by asserting against the script body itself, avoiding having to replicate Lua semantics in the mock
    const evalMock = vi.fn(async (_script: string) => 0);
    const redis = { eval: evalMock };
    const limiter = new RedisLimiter(redis);

    await limiter.release({ modelId: 'm' });
    const releaseScript = evalMock.mock.calls[0]?.[0] as string;
    expect(releaseScript).toMatch(/if concurrency <= 0 then/);
    expect(releaseScript).toMatch(/redis\.call\('DEL', KEYS\[1\]\)/);
  });

  it('getUsage reads sliding-window counters through Redis script', async () => {
    const sampledAtMs = Date.UTC(2026, 4, 20, 1, 2, 3);
    const evalMock = vi.fn(
      async (_script: string, _keyCount: number, ..._args: Array<string | number>) => [3, 450, 2, sampledAtMs],
    );
    const redis = { eval: evalMock };
    const limiter = new RedisLimiter(redis as never);

    const usage = await limiter.getUsage('model-9');

    expect(usage).toMatchObject({
      modelId: 'model-9',
      rpmUsed: 3,
      tpmUsed: 450,
      concurrencyInUse: 2,
      windowMs: 60_000,
    });
    expect(usage.windowEndsAt).toBe(new Date(sampledAtMs).toISOString());
    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(evalMock.mock.calls[0]?.[1]).toBe(4);
  });

  it('getUsage returns zeros when keys are missing', async () => {
    const redis = { eval: vi.fn(async () => [0, 0, 0, Date.now()]) };
    const limiter = new RedisLimiter(redis as never);

    const usage = await limiter.getUsage('cold-model');
    expect(usage).toMatchObject({
      modelId: 'cold-model',
      rpmUsed: 0,
      tpmUsed: 0,
      concurrencyInUse: 0,
    });
  });
});

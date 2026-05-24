import type { AcquireArgs, RateLimiter, ReleaseArgs, UsageSnapshot } from './types';

// 测试 stub — 直接放行，便于单元测试
export class StubLimiter implements RateLimiter {
  async acquire(_args: AcquireArgs) {
    return;
  }

  async release(_args: ReleaseArgs) {
    return;
  }

  async getUsage(modelId: string): Promise<UsageSnapshot> {
    return {
      modelId,
      rpmUsed: 0,
      tpmUsed: 0,
      concurrencyInUse: 0,
      windowMs: 60_000,
      windowEndsAt: new Date().toISOString(),
    };
  }
}

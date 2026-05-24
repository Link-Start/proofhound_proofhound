import Redis from 'ioredis';

import type { RedisOutputConfig } from '@proofhound/shared';

import type { OutputDriver, RedisBrokerCredentials } from '../types';

type RedisXadd = (key: string, ...args: string[]) => Promise<string>;

function serializeMessage(message: unknown): string {
  const serialized = JSON.stringify(message);
  return serialized === undefined ? 'null' : serialized;
}

function createRedis(credentials: RedisBrokerCredentials, timeoutMs?: number): Redis {
  return new Redis({
    host: credentials.host,
    port: credentials.port,
    username: credentials.username ?? undefined,
    password: credentials.password ?? undefined,
    db: credentials.db ?? undefined,
    lazyConnect: true,
    connectTimeout: timeoutMs ?? 5_000,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function appendScalarField(fields: string[], name: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    fields.push(name, String(value));
  }
}

export function buildRedisStreamFieldPairs(message: unknown): string[] {
  const fields = ['payload', serializeMessage(message)];
  const record = asRecord(message);
  if (!record) return fields;
  appendScalarField(fields, 'external_id', record['external_id']);
  appendScalarField(fields, 'run_result_id', record['run_result_id']);
  appendScalarField(fields, 'status', record['status']);
  return fields;
}

export const redisOutputDriver: OutputDriver<RedisBrokerCredentials, RedisOutputConfig> = {
  async push(params): Promise<void> {
    const { brokerCredentials, connectorConfig, messages } = params;
    if (messages.length === 0) return;
    if (connectorConfig.mode !== 'list' && connectorConfig.mode !== 'stream') {
      throw new Error(`redis-output driver expects mode='list' or 'stream', got '${connectorConfig.mode}'`);
    }

    const redis = createRedis(brokerCredentials, params.timeoutMs);
    try {
      await redis.connect();
      if (connectorConfig.mode === 'list') {
        await redis.lpush(connectorConfig.key, ...messages.map(serializeMessage));
        if (connectorConfig.maxLen) {
          await redis.ltrim(connectorConfig.key, 0, connectorConfig.maxLen - 1);
        }
        return;
      }

      for (const message of messages) {
        const fields = buildRedisStreamFieldPairs(message);
        const args = connectorConfig.maxLen
          ? ['MAXLEN', '~', String(connectorConfig.maxLen), '*', ...fields]
          : ['*', ...fields];
        await (redis.xadd as RedisXadd).call(redis, connectorConfig.key, ...args);
      }
    } finally {
      try {
        redis.disconnect();
      } catch {
        /* ignore */
      }
    }
  },
};

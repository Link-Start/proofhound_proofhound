import Redis from 'ioredis';

import type { RedisInputConfig } from '@proofhound/shared';

import type {
  ConsumeMessage,
  ConsumeParams,
  ConsumeResult,
  InputDriver,
  PeekMessage,
  PeekParams,
  PeekResult,
  RedisBrokerCredentials,
} from '../types';

// Redis Stream:用 XREVRANGE key + - COUNT N 读最新 N 条,不消费 / 不提交
// id 形如 `1700000000000-0`,可解析出毫秒时间戳作为 receivedAt
function parseStreamIdTimestamp(id: string): string | null {
  const dashIndex = id.indexOf('-');
  if (dashIndex === -1) return null;
  const ms = Number(id.slice(0, dashIndex));
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

// XREVRANGE 返回 `[id, [field1, value1, field2, value2, ...]]`,把扁平 KV 数组拼成对象
function fieldsToObject(fields: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key === undefined || value === undefined) continue;
    obj[key] = value;
  }
  return obj;
}

export const redisStreamInputDriver: InputDriver<RedisBrokerCredentials, RedisInputConfig> = {
  async peek(params: PeekParams<RedisBrokerCredentials, RedisInputConfig>): Promise<PeekResult> {
    const { brokerCredentials, connectorConfig, limit } = params;
    if (connectorConfig.mode !== 'stream') {
      return { messages: [], error: `redis-stream driver expects mode='stream', got '${connectorConfig.mode}'` };
    }

    const redis = new Redis({
      host: brokerCredentials.host,
      port: brokerCredentials.port,
      username: brokerCredentials.username ?? undefined,
      password: brokerCredentials.password ?? undefined,
      db: brokerCredentials.db ?? undefined,
      lazyConnect: true,
      connectTimeout: params.timeoutMs ?? 5_000,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });

    try {
      await redis.connect();
      // XREVRANGE: 从最新往旧返回,COUNT N
      const rows = (await redis.xrevrange(connectorConfig.key, '+', '-', 'COUNT', limit)) as Array<[string, string[]]>;
      const messages: PeekMessage[] = rows.map(([id, fields]) => ({
        id,
        receivedAt: parseStreamIdTimestamp(id),
        payload: fieldsToObject(fields),
        metadata: { mode: 'stream', streamKey: connectorConfig.key },
      }));
      return { messages, error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown redis error';
      return { messages: [], error: message };
    } finally {
      try {
        redis.disconnect();
      } catch {
        /* ignore */
      }
    }
  },

  async consume(params: ConsumeParams<RedisBrokerCredentials, RedisInputConfig>): Promise<ConsumeResult> {
    const { brokerCredentials, connectorConfig } = params;
    if (connectorConfig.mode !== 'stream') {
      return { error: `redis-stream driver expects mode='stream', got '${connectorConfig.mode}'` };
    }

    const redis = new Redis({
      host: brokerCredentials.host,
      port: brokerCredentials.port,
      username: brokerCredentials.username ?? undefined,
      password: brokerCredentials.password ?? undefined,
      db: brokerCredentials.db ?? undefined,
      lazyConnect: true,
      connectTimeout: params.timeoutMs ?? 5_000,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });

    const group = `proofhound-${params.consumerName ?? 'runner'}`;
    const consumer = params.consumerName ?? `runner-${Date.now()}`;
    const batchSize = Math.max(1, params.batchSize ?? connectorConfig.batchSize ?? 10);
    const blockMs = Math.max(1, connectorConfig.blockMs ?? params.timeoutMs ?? 1_000);

    try {
      await redis.connect();
      try {
        await redis.xgroup('CREATE', connectorConfig.key, group, '0', 'MKSTREAM');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('BUSYGROUP')) throw error;
      }

      while (!params.signal?.aborted) {
        const result = (await redis.xreadgroup(
          'GROUP',
          group,
          consumer,
          'COUNT',
          batchSize,
          'BLOCK',
          blockMs,
          'STREAMS',
          connectorConfig.key,
          '>',
        )) as Array<[string, Array<[string, string[]]>]> | null;
        if (!result) continue;

        for (const [, rows] of result) {
          for (const [id, fields] of rows) {
            if (params.signal?.aborted) break;
            const message: ConsumeMessage = {
              id,
              receivedAt: parseStreamIdTimestamp(id),
              payload: fieldsToObject(fields),
              metadata: { mode: 'stream', streamKey: connectorConfig.key },
            };
            await params.onMessage(message);
            await redis.xack(connectorConfig.key, group, id);
          }
        }
      }
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown redis error';
      return { error: message };
    } finally {
      try {
        redis.disconnect();
      } catch {
        /* ignore */
      }
    }
  },
};

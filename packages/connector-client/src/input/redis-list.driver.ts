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

// Redis List: LRANGE key 0 limit-1 reads the latest N entries (does not consume)
// Business convention: the head of the list is the newest (BRPOPLPUSH / LPUSH writes here); index 0 onward goes from newest to oldest
function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export const redisListInputDriver: InputDriver<RedisBrokerCredentials, RedisInputConfig> = {
  async peek(params: PeekParams<RedisBrokerCredentials, RedisInputConfig>): Promise<PeekResult> {
    const { brokerCredentials, connectorConfig, limit } = params;
    if (connectorConfig.mode !== 'list') {
      return { messages: [], error: `redis-list driver expects mode='list', got '${connectorConfig.mode}'` };
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
      const rows = await redis.lrange(connectorConfig.key, 0, limit - 1);
      const messages: PeekMessage[] = rows.map((raw, index) => ({
        id: `${connectorConfig.key}#${index}`,
        receivedAt: null,
        payload: tryParseJson(raw),
        metadata: { mode: 'list', listKey: connectorConfig.key, index },
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
    if (connectorConfig.mode !== 'list') {
      return { error: `redis-list driver expects mode='list', got '${connectorConfig.mode}'` };
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

    const timeoutSeconds = Math.max(1, Math.ceil((params.timeoutMs ?? 1_000) / 1_000));
    let sequence = 0;

    try {
      await redis.connect();
      while (!params.signal?.aborted) {
        const row = (await redis.brpop(connectorConfig.key, timeoutSeconds)) as [string, string] | null;
        if (!row) continue;
        const [, raw] = row;
        sequence += 1;
        const message: ConsumeMessage = {
          id: `${connectorConfig.key}:${Date.now()}:${sequence}`,
          receivedAt: new Date().toISOString(),
          payload: tryParseJson(raw),
          metadata: { mode: 'list', listKey: connectorConfig.key },
        };
        await params.onMessage(message);
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

// 连接器驱动出口
// 详见 docs/specs/26-connectors.md

import type { KafkaInputConfig, KafkaOutputConfig, RedisInputConfig, RedisOutputConfig } from '@proofhound/shared';
import type {
  InputDriver,
  KafkaBrokerCredentials,
  KafkaProbeConfig,
  OutputDriver,
  ProbeParams,
  ProbeResult,
  RedisBrokerCredentials,
  RedisProbeConfig,
} from './types';

export type * from './types';

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

import { redisListInputDriver } from './input/redis-list.driver';
import { redisStreamInputDriver } from './input/redis-stream.driver';
import { kafkaInputDriver } from './input/kafka.driver';
import { redisOutputDriver } from './output/redis-list.driver';
import { kafkaOutputDriver } from './output/kafka.driver';
import Redis from 'ioredis';
import { Kafka, type SASLOptions } from 'kafkajs';

export type ConnectorKind = 'redis' | 'kafka' | 'webhook';

export function getInputDriver(
  type: ConnectorKind,
  subMode?: 'list' | 'stream',
):
  | InputDriver<RedisBrokerCredentials, RedisInputConfig>
  | InputDriver<KafkaBrokerCredentials, KafkaInputConfig>
  | null {
  if (type === 'redis') {
    return subMode === 'stream' ? redisStreamInputDriver : redisListInputDriver;
  }
  if (type === 'kafka') {
    return kafkaInputDriver;
  }
  // webhook input peek 由 server 端降级处理,driver 不参与
  return null;
}

export function getOutputDriver(
  type: ConnectorKind,
  _subMode?: 'list' | 'stream',
):
  | OutputDriver<RedisBrokerCredentials, RedisOutputConfig>
  | OutputDriver<KafkaBrokerCredentials, KafkaOutputConfig>
  | null {
  if (type === 'redis') {
    return redisOutputDriver;
  }
  if (type === 'kafka') {
    return kafkaOutputDriver;
  }
  return null;
}

function buildKafkaSasl(credentials: KafkaBrokerCredentials): SASLOptions | undefined {
  if (!credentials.saslMechanism || !credentials.saslUsername || !credentials.saslPassword) {
    return undefined;
  }
  if (credentials.saslMechanism === 'PLAIN') {
    return { mechanism: 'plain', username: credentials.saslUsername, password: credentials.saslPassword };
  }
  if (credentials.saslMechanism === 'SCRAM-SHA-256') {
    return { mechanism: 'scram-sha-256', username: credentials.saslUsername, password: credentials.saslPassword };
  }
  return { mechanism: 'scram-sha-512', username: credentials.saslUsername, password: credentials.saslPassword };
}

export async function probeRedisKey(
  params: ProbeParams<RedisBrokerCredentials, RedisProbeConfig>,
): Promise<ProbeResult> {
  const { brokerCredentials, connectorConfig } = params;
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
    await redis.ping();
    const keyType = await redis.type(connectorConfig.key);
    if (keyType === 'none') {
      return { error: `redis key not found: ${connectorConfig.key}`, metadata: { exists: false } };
    }
    if (connectorConfig.mode === 'stream' && keyType !== 'stream') {
      return {
        error: `redis key ${connectorConfig.key} is ${keyType}, expected stream`,
        metadata: { exists: true, keyType },
      };
    }
    if (connectorConfig.mode === 'list' && keyType !== 'list') {
      return {
        error: `redis key ${connectorConfig.key} is ${keyType}, expected list`,
        metadata: { exists: true, keyType },
      };
    }
    return { error: null, metadata: { exists: true, keyType } };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'unknown redis error' };
  } finally {
    try {
      redis.disconnect();
    } catch {
      /* ignore */
    }
  }
}

export async function probeKafkaTopic(
  params: ProbeParams<KafkaBrokerCredentials, KafkaProbeConfig>,
): Promise<ProbeResult> {
  const { brokerCredentials, connectorConfig } = params;
  const timeoutMs = params.timeoutMs ?? 10_000;
  const useSsl = brokerCredentials.securityProtocol === 'SSL' || brokerCredentials.securityProtocol === 'SASL_SSL';
  const kafka = new Kafka({
    clientId: `proofhound-probe-${Math.random().toString(36).slice(2)}`,
    brokers: brokerCredentials.bootstrapBrokers,
    ssl: useSsl,
    sasl: buildKafkaSasl(brokerCredentials),
    connectionTimeout: timeoutMs,
    requestTimeout: timeoutMs,
    retry: { retries: 0 },
  });
  const admin = kafka.admin();

  try {
    await admin.connect();
    const metadata = await admin.fetchTopicMetadata({ topics: [connectorConfig.topic] });
    const topic = metadata.topics.find((item) => item.name === connectorConfig.topic);
    if (!topic || topic.partitions.length === 0) {
      return { error: `kafka topic not found: ${connectorConfig.topic}`, metadata: { exists: false } };
    }
    return {
      error: null,
      metadata: { exists: true, partitions: topic.partitions.length },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'unknown kafka error' };
  } finally {
    try {
      await admin.disconnect();
    } catch {
      /* ignore */
    }
  }
}

export { redisListInputDriver, redisStreamInputDriver, kafkaInputDriver, redisOutputDriver, kafkaOutputDriver };
export type { KafkaInputConfig, KafkaOutputConfig, RedisInputConfig, RedisOutputConfig };

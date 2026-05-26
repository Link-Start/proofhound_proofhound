import { Kafka, type Admin, type Consumer, type SASLOptions } from 'kafkajs';
import { randomUUID } from 'node:crypto';

import type { KafkaInputConfig } from '@proofhound/shared';

import type {
  ConsumeMessage,
  ConsumeParams,
  ConsumeResult,
  InputDriver,
  PeekMessage,
  PeekParams,
  PeekResult,
  KafkaBrokerCredentials,
} from '../types';

// Kafka peek strategy:
// 1. admin.fetchTopicOffsets gets the latestOffset for each partition
// 2. Create a one-shot consumer group `peek-${uuid}`, autoCommit:false
// 3. For each partition, seek to max(latestOffset - limit, 0)
// 4. Use consumer.run to pull at most limit records, then disconnect; do not commit offset
function buildSasl(credentials: KafkaBrokerCredentials): SASLOptions | undefined {
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

function decodeValue(value: Buffer | null): unknown {
  if (!value) return null;
  const str = value.toString('utf-8');
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

export const kafkaInputDriver: InputDriver<KafkaBrokerCredentials, KafkaInputConfig> = {
  async peek(params: PeekParams<KafkaBrokerCredentials, KafkaInputConfig>): Promise<PeekResult> {
    const { brokerCredentials, connectorConfig, limit } = params;
    const timeoutMs = params.timeoutMs ?? 10_000;
    const useSsl = brokerCredentials.securityProtocol === 'SSL' || brokerCredentials.securityProtocol === 'SASL_SSL';
    const sasl = buildSasl(brokerCredentials);

    const kafka = new Kafka({
      clientId: `proofhound-peek-${randomUUID()}`,
      brokers: brokerCredentials.bootstrapBrokers,
      ssl: useSsl,
      sasl,
      connectionTimeout: timeoutMs,
      requestTimeout: timeoutMs,
      retry: { retries: 0 },
    });

    let admin: Admin | null = null;
    let consumer: Consumer | null = null;
    const collected: PeekMessage[] = [];

    try {
      admin = kafka.admin();
      await admin.connect();
      const offsets = await admin.fetchTopicOffsets(connectorConfig.topic);
      await admin.disconnect();
      admin = null;

      const groupId = `peek-${randomUUID()}`;
      consumer = kafka.consumer({ groupId, sessionTimeout: 10_000, allowAutoTopicCreation: false });
      await consumer.connect();
      await consumer.subscribe({ topic: connectorConfig.topic, fromBeginning: false });

      // Run with autoCommit:false; seek is called after 'group.join'
      const completePromise = new Promise<void>((resolve) => {
        const timeoutHandle = setTimeout(resolve, timeoutMs);
        consumer!
          .run({
            autoCommit: false,
            eachMessage: async ({ topic, partition, message }) => {
              if (collected.length >= limit) {
                clearTimeout(timeoutHandle);
                resolve();
                return;
              }
              collected.push({
                id: `${topic}:${partition}:${message.offset}`,
                receivedAt: message.timestamp ? new Date(Number(message.timestamp)).toISOString() : null,
                payload: decodeValue(message.value),
                metadata: {
                  topic,
                  partition,
                  offset: message.offset,
                  key: message.key ? message.key.toString('utf-8') : null,
                },
              });
              if (collected.length >= limit) {
                clearTimeout(timeoutHandle);
                resolve();
              }
            },
          })
          .catch(() => {
            clearTimeout(timeoutHandle);
            resolve();
          });
      });

      // For each partition, seek to latestOffset - perPartition
      const perPartition = Math.max(1, Math.ceil(limit / offsets.length));
      for (const partitionOffset of offsets) {
        const latest = Number(partitionOffset.offset);
        const start = Number.isFinite(latest) && latest > 0 ? Math.max(latest - perPartition, 0) : 0;
        consumer.seek({ topic: connectorConfig.topic, partition: partitionOffset.partition, offset: String(start) });
      }

      await completePromise;
      return { messages: collected.slice(0, limit), error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown kafka error';
      return { messages: collected.slice(0, limit), error: message };
    } finally {
      try {
        if (consumer) await consumer.disconnect();
      } catch {
        /* ignore */
      }
      try {
        if (admin) await admin.disconnect();
      } catch {
        /* ignore */
      }
    }
  },

  async consume(params: ConsumeParams<KafkaBrokerCredentials, KafkaInputConfig>): Promise<ConsumeResult> {
    const { brokerCredentials, connectorConfig } = params;
    const timeoutMs = params.timeoutMs ?? 10_000;
    const useSsl = brokerCredentials.securityProtocol === 'SSL' || brokerCredentials.securityProtocol === 'SASL_SSL';
    const sasl = buildSasl(brokerCredentials);
    const groupId = connectorConfig.consumerGroup;

    const kafka = new Kafka({
      clientId: `proofhound-canary-${params.consumerName ?? randomUUID()}`,
      brokers: brokerCredentials.bootstrapBrokers,
      ssl: useSsl,
      sasl,
      connectionTimeout: timeoutMs,
      requestTimeout: timeoutMs,
      retry: { retries: 0 },
    });

    const consumer = kafka.consumer({ groupId, sessionTimeout: 10_000, allowAutoTopicCreation: false });
    let abortHandler: (() => void) | null = null;

    try {
      await consumer.connect();
      await consumer.subscribe({
        topic: connectorConfig.topic,
        fromBeginning: connectorConfig.fromBeginning ?? false,
      });

      abortHandler = () => {
        consumer.stop().catch(() => {
          /* ignore */
        });
      };
      params.signal?.addEventListener('abort', abortHandler, { once: true });

      await consumer.run({
        autoCommit: false,
        eachMessage: async ({ topic, partition, message }) => {
          if (params.signal?.aborted) return;
          const offset = message.offset;
          const consumeMessage: ConsumeMessage = {
            id: `${topic}:${partition}:${offset}`,
            receivedAt: message.timestamp ? new Date(Number(message.timestamp)).toISOString() : null,
            payload: decodeValue(message.value),
            metadata: {
              topic,
              partition,
              offset,
              key: message.key ? message.key.toString('utf-8') : null,
            },
          };
          await params.onMessage(consumeMessage);
          await consumer.commitOffsets([
            {
              topic,
              partition,
              offset: String(Number(offset) + 1),
            },
          ]);
        },
      });

      await waitForAbort(params.signal);
      await consumer.stop();
      return { error: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown kafka error';
      return { error: message };
    } finally {
      if (abortHandler) params.signal?.removeEventListener('abort', abortHandler);
      try {
        await consumer.disconnect();
      } catch {
        /* ignore */
      }
    }
  },
};

function waitForAbort(signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise(() => undefined);
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

import { randomUUID } from 'node:crypto';
import { Kafka, type SASLOptions } from 'kafkajs';

import type { KafkaOutputConfig } from '@proofhound/shared';

import type { KafkaBrokerCredentials, OutputDriver } from '../types';

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

function serializeMessage(message: unknown): string {
  const serialized = JSON.stringify(message);
  return serialized === undefined ? 'null' : serialized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readPath(payload: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  let current: unknown = payload;
  for (const segment of path.split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    const record = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(record, segment)) return undefined;
    current = record[segment];
  }
  return current;
}

function stringifyKeyValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return serializeMessage(value);
}

export function resolveKafkaOutputKey(message: unknown, partitionKey?: string | null): string | null {
  const record = asRecord(message);
  if (!record) return null;
  if (partitionKey && partitionKey.trim().length > 0) {
    return stringifyKeyValue(readPath(record, partitionKey.trim()));
  }
  return stringifyKeyValue(record['external_id']) ?? stringifyKeyValue(record['run_result_id']);
}

export function buildKafkaOutputProducerOptions(): { allowAutoTopicCreation: boolean } {
  return { allowAutoTopicCreation: true };
}

export const kafkaOutputDriver: OutputDriver<KafkaBrokerCredentials, KafkaOutputConfig> = {
  async push(params): Promise<void> {
    const { brokerCredentials, connectorConfig, messages } = params;
    if (messages.length === 0) return;

    const timeoutMs = params.timeoutMs ?? 10_000;
    const useSsl = brokerCredentials.securityProtocol === 'SSL' || brokerCredentials.securityProtocol === 'SASL_SSL';
    const kafka = new Kafka({
      clientId: `proofhound-output-${randomUUID()}`,
      brokers: brokerCredentials.bootstrapBrokers,
      ssl: useSsl,
      sasl: buildSasl(brokerCredentials),
      connectionTimeout: timeoutMs,
      requestTimeout: timeoutMs,
      retry: { retries: 0 },
    });
    const producer = kafka.producer(buildKafkaOutputProducerOptions());

    try {
      await producer.connect();
      await producer.send({
        topic: connectorConfig.topic,
        messages: messages.map((message) => ({
          key: resolveKafkaOutputKey(message, connectorConfig.partitionKey),
          value: serializeMessage(message),
          headers: { 'content-type': 'application/json' },
        })),
      });
    } finally {
      try {
        await producer.disconnect();
      } catch {
        /* ignore */
      }
    }
  },
};

import type { KafkaInputConfig, KafkaOutputConfig, RedisInputConfig, RedisOutputConfig } from '@proofhound/shared';

// ---------------------------------------------------------------------------
// 队列凭证 shape(由 server 端从本地连接器配置解密后传入)
// ---------------------------------------------------------------------------

export interface RedisBrokerCredentials {
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  db?: number | null;
  deploymentType?: 'standalone' | 'sentinel' | 'cluster' | null;
}

export interface KafkaBrokerCredentials {
  bootstrapBrokers: string[];
  securityProtocol?: 'PLAINTEXT' | 'SSL' | 'SASL_PLAINTEXT' | 'SASL_SSL' | null;
  saslMechanism?: 'PLAIN' | 'SCRAM-SHA-256' | 'SCRAM-SHA-512' | null;
  saslUsername?: string | null;
  saslPassword?: string | null;
}

export type BrokerCredentials = RedisBrokerCredentials | KafkaBrokerCredentials;

// ---------------------------------------------------------------------------
// Peek 协议
// ---------------------------------------------------------------------------

export interface PeekMessage {
  id: string;
  receivedAt: string | null;
  payload: unknown;
  metadata?: Record<string, unknown>;
}

export interface PeekParams<TBroker = BrokerCredentials, TConfig = unknown> {
  brokerCredentials: TBroker;
  connectorConfig: TConfig;
  limit: number;
  timeoutMs?: number;
}

export interface PeekResult {
  messages: PeekMessage[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// Consume 协议
// ---------------------------------------------------------------------------

export interface ConsumeMessage {
  id: string;
  receivedAt: string | null;
  payload: unknown;
  metadata?: Record<string, unknown>;
}

export interface ConsumeParams<TBroker = BrokerCredentials, TConfig = unknown> {
  brokerCredentials: TBroker;
  connectorConfig: TConfig;
  batchSize?: number;
  timeoutMs?: number;
  consumerName?: string;
  signal?: AbortSignal;
  onMessage(message: ConsumeMessage): Promise<void>;
}

export interface ConsumeResult {
  error: string | null;
}

export interface InputDriver<TBroker = BrokerCredentials, TConfig = unknown> {
  peek(params: PeekParams<TBroker, TConfig>): Promise<PeekResult>;
  consume?(params: ConsumeParams<TBroker, TConfig>): Promise<ConsumeResult>;
}

// ---------------------------------------------------------------------------
// Probe 协议
// ---------------------------------------------------------------------------

export interface ProbeResult {
  error: string | null;
  metadata?: Record<string, unknown>;
}

export interface ProbeParams<TBroker = BrokerCredentials, TConfig = unknown> {
  brokerCredentials: TBroker;
  connectorConfig: TConfig;
  timeoutMs?: number;
}

export interface OutputDriver<TBroker = BrokerCredentials, TConfig = unknown> {
  push?(params: {
    brokerCredentials: TBroker;
    connectorConfig: TConfig;
    messages: unknown[];
    timeoutMs?: number;
  }): Promise<void>;
}

export type RedisProbeConfig = RedisInputConfig | RedisOutputConfig;
export type KafkaProbeConfig = KafkaInputConfig | KafkaOutputConfig;

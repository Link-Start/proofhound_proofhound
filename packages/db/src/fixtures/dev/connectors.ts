// 本地连接器 fixture:redis/kafka 各 input + output,
// 再加 webhook 输入两条(sync + async,通过 config.webhookMode 区分,type 仍是 'webhook')。
// 业务术语 connector,物理表 ph_assets.connectors,见 docs/specs/26-connectors.md。
//
// fixture 内部用 `kind` 字段做 discriminator(便于 seed-dev.ts switch);实际表里这一列不存在,
// 拆成 direction + type 两列。`config` 形状对齐 packages/shared/src/dto/connector.dto.ts 的
// 6 种 (type, direction) config schema。
//
// 注:webhook 入站 token 不在本 fixture 关联;token 在 fixtures/dev/api-tokens.ts 用 connectorId 反向挂到 connector 上。

const REDIS_CONNECTION = {
  source: 'local_config' as const,
  host: 'localhost',
  port: 6379,
  deploymentType: 'standalone' as const,
};
const KAFKA_CONNECTION = {
  source: 'local_config' as const,
  bootstrapBrokers: ['localhost:9092'],
  securityProtocol: 'PLAINTEXT' as const,
};

const WEBHOOK_INPUT_PAYLOAD_SCHEMA = {
  type: 'object',
  properties: {
    sample_id: { type: 'string', description: '样本 ID' },
    text: { type: 'string', description: '需要提示词处理的文本内容' },
  },
};

export type DevConnectorFixture =
  | {
      kind: 'redis-input';
      id: string;
      name: string;
      description: string;
      config: {
        connection: typeof REDIS_CONNECTION;
        mode: 'list' | 'stream';
        key: string;
        consumerGroup?: string;
        blockMs?: number;
        batchSize?: number;
      };
    }
  | {
      kind: 'redis-output';
      id: string;
      name: string;
      description: string;
      config: {
        connection: typeof REDIS_CONNECTION;
        mode: 'list' | 'stream';
        key: string;
        maxLen?: number;
      };
    }
  | {
      kind: 'kafka-input';
      id: string;
      name: string;
      description: string;
      config: {
        connection: typeof KAFKA_CONNECTION;
        topic: string;
        consumerGroup: string;
        fromBeginning?: boolean;
        batchSize?: number;
      };
    }
  | {
      kind: 'kafka-output';
      id: string;
      name: string;
      description: string;
      config: {
        connection: typeof KAFKA_CONNECTION;
        topic: string;
        partitionKey?: string;
      };
    }
  | {
      kind: 'webhook-input';
      id: string;
      name: string;
      description: string;
      webhookPath: string;
      config: {
        webhookMode: 'sync' | 'async';
        timeoutSeconds?: number;
        expectedPayloadSchema?: Record<string, unknown>;
      };
    };

export const DEV_CONNECTORS: DevConnectorFixture[] = [
  {
    kind: 'redis-input',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
    name: 'yelp-polarity-redis-list-in',
    description: 'Redis list 输入 · Yelp Polarity 随机 50 条样本',
    config: { connection: REDIS_CONNECTION, mode: 'list', key: 'datasets:yelp-polarity:random-50' },
  },
  {
    kind: 'redis-output',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
    name: 'decisions-list-out',
    description: 'Redis list 输出 · 决策推送',
    config: { connection: REDIS_CONNECTION, mode: 'list', key: 'datasets:yelp-polarity:random-50', maxLen: 100000 },
  },
  {
    kind: 'kafka-input',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003',
    name: 'yelp-polarity-kafka-topic-in',
    description: 'Kafka 输入 · Yelp Polarity 随机 50 条样本',
    config: {
      connection: KAFKA_CONNECTION,
      topic: 'datasets.yelp-polarity.random-50',
      consumerGroup: 'yelp-polarity-dev-g1',
      fromBeginning: false,
    },
  },
  {
    kind: 'kafka-output',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004',
    name: 'decisions-topic-out',
    description: 'Kafka 输出 · 决策 topic',
    config: { connection: KAFKA_CONNECTION, topic: 'risk-decisions', partitionKey: 'orderId' },
  },
  {
    kind: 'webhook-input',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005',
    name: 'sync-webhook-in',
    description: 'Webhook 输入 · 同步模式(上游 POST 等待 LLM 完成再返回)',
    webhookPath: 'a3a1b2c3-d4e5-4f60-8788-aabbccddeeff',
    config: {
      webhookMode: 'sync',
      timeoutSeconds: 30,
      expectedPayloadSchema: WEBHOOK_INPUT_PAYLOAD_SCHEMA,
    },
  },
  {
    kind: 'webhook-input',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006',
    name: 'async-webhook-in',
    description: 'Webhook 输入 · 异步模式(立即返回 callId,结果由输出连接器或查询接口取回)',
    webhookPath: 'b4b2c3d4-e5f6-4071-8899-bbccddeeff00',
    config: {
      webhookMode: 'async',
      timeoutSeconds: 120,
      expectedPayloadSchema: WEBHOOK_INPUT_PAYLOAD_SCHEMA,
    },
  },
];

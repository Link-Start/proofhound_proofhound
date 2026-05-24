import { z } from 'zod';

export const kafkaSaslMechanismSchema = z.enum(['PLAIN', 'SCRAM-SHA-256', 'SCRAM-SHA-512']);
export const kafkaSecurityProtocolSchema = z.enum(['PLAINTEXT', 'SASL_PLAINTEXT', 'SASL_SSL', 'SSL']);
export const connectorHealthStatusSchema = z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']);
export const redisDeploymentTypeSchema = z.enum(['standalone', 'sentinel', 'cluster']);
export const redisConsumerModeSchema = z.enum(['list', 'stream']);
export type RedisConsumerMode = z.infer<typeof redisConsumerModeSchema>;

// ---------------------------------------------------------------------------
// 连接器（业务术语 connector，DB 物理表 ph_assets.connectors）
// 详见 docs/specs/26-connectors.md §3 / docs/specs/06-database-schema.md §4.5
// ---------------------------------------------------------------------------

export const connectorDirectionSchema = z.enum(['input', 'output']);
export type ConnectorDirection = z.infer<typeof connectorDirectionSchema>;

export const connectorTypeSchema = z.enum(['redis', 'kafka', 'webhook']);
export type ConnectorType = z.infer<typeof connectorTypeSchema>;

export type ConnectorHealthStatus = z.infer<typeof connectorHealthStatusSchema>;

export const webhookModeSchema = z.enum(['sync', 'async']);
export type WebhookMode = z.infer<typeof webhookModeSchema>;

export const webhookOutputMethodSchema = z.enum(['POST', 'PUT']);
export type WebhookOutputMethod = z.infer<typeof webhookOutputMethodSchema>;

// ---------------------------------------------------------------------------
// config 分支:每种 (type, direction) 一个 schema
// ---------------------------------------------------------------------------

const redisStreamKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[\w:.\-+]+$/u, {
    message: 'key must contain only word characters, ":", ".", "-", "+"',
  });

const kafkaTopicSchema = z
  .string()
  .trim()
  .min(1)
  .max(249)
  .regex(/^[A-Za-z0-9._-]+$/u, {
    message: 'topic must contain only [A-Za-z0-9._-]',
  });

const consumerGroupSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._:-]+$/u, {
    message: 'consumer group must contain only [A-Za-z0-9._:-]',
  });

const jsonSchemaShape = z.record(z.string(), z.unknown());

const localConnectorSourceSchema = z.literal('local_config');

const redisConnectionConfigSchema = z.object({
  source: localConnectorSourceSchema.default('local_config'),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().trim().max(255).nullable().optional(),
  defaultDbIndex: z.coerce.number().int().min(0).max(15).nullable().optional(),
  deploymentType: redisDeploymentTypeSchema.nullable().optional(),
});
export type RedisConnectionConfig = z.infer<typeof redisConnectionConfigSchema>;

const kafkaConnectionConfigSchema = z.object({
  source: localConnectorSourceSchema.default('local_config'),
  bootstrapBrokers: z.array(z.string().trim().min(1).max(255)).min(1),
  securityProtocol: kafkaSecurityProtocolSchema.default('PLAINTEXT'),
  saslMechanism: kafkaSaslMechanismSchema.nullable().optional(),
  saslUsername: z.string().trim().max(255).nullable().optional(),
});
export type KafkaConnectionConfig = z.infer<typeof kafkaConnectionConfigSchema>;

const redisConnectorCredentialsSchema = z.object({
  password: z.string().min(1).optional(),
});
export type RedisConnectorCredentials = z.infer<typeof redisConnectorCredentialsSchema>;

const kafkaConnectorCredentialsSchema = z.object({
  saslPassword: z.string().min(1).optional(),
});
export type KafkaConnectorCredentials = z.infer<typeof kafkaConnectorCredentialsSchema>;

export const peekConnectorMessageSchema = z.object({
  id: z.string(),
  receivedAt: z.string().datetime().nullable(),
  payload: z.unknown(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type PeekConnectorMessageDto = z.infer<typeof peekConnectorMessageSchema>;

const latestPeekConfigSchema = {
  lastPeekPayloadSchema: jsonSchemaShape.nullable().optional(),
  lastPeekMessage: peekConnectorMessageSchema.nullable().optional(),
  lastPeekedAt: z.string().datetime().optional(),
  lastPeekMessageCount: z.coerce.number().int().min(0).max(10).optional(),
};

export const redisInputConfigSchema = z.object({
  connection: redisConnectionConfigSchema.optional(),
  mode: redisConsumerModeSchema,
  key: redisStreamKeySchema,
  blockMs: z.coerce.number().int().min(0).max(60_000).optional(),
  batchSize: z.coerce.number().int().min(1).max(500).optional(),
  ...latestPeekConfigSchema,
});
export type RedisInputConfig = z.infer<typeof redisInputConfigSchema>;

export const redisOutputConfigSchema = z.object({
  connection: redisConnectionConfigSchema.optional(),
  mode: redisConsumerModeSchema,
  key: redisStreamKeySchema,
  maxLen: z.coerce.number().int().min(1).max(1_000_000).optional(),
});
export type RedisOutputConfig = z.infer<typeof redisOutputConfigSchema>;

export const kafkaInputConfigSchema = z.object({
  connection: kafkaConnectionConfigSchema.optional(),
  topic: kafkaTopicSchema,
  consumerGroup: consumerGroupSchema,
  fromBeginning: z.boolean().optional(),
  batchSize: z.coerce.number().int().min(1).max(500).optional(),
  ...latestPeekConfigSchema,
});
export type KafkaInputConfig = z.infer<typeof kafkaInputConfigSchema>;

export const kafkaOutputConfigSchema = z.object({
  connection: kafkaConnectionConfigSchema.optional(),
  topic: kafkaTopicSchema,
  partitionKey: z.string().trim().max(255).optional(),
});
export type KafkaOutputConfig = z.infer<typeof kafkaOutputConfigSchema>;

export const webhookInputConfigSchema = z.object({
  webhookMode: webhookModeSchema,
  webhookSlug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/u, {
      message: 'webhook slug must use lowercase letters, numbers, and hyphens',
    })
    .optional(),
  pathName: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/u, {
      message: 'path name must use letters, numbers, ".", "_", "-", or "/"',
    })
    .optional(),
  timeoutSeconds: z.coerce.number().int().min(1).max(300).optional(),
  expectedPayloadSchema: jsonSchemaShape.optional(),
});
export type WebhookInputConfig = z.infer<typeof webhookInputConfigSchema>;

export const webhookOutputConfigSchema = z.object({
  targetUrl: z.string().trim().url().max(2_048),
  method: webhookOutputMethodSchema.default('POST'),
  headers: z.record(z.string(), z.string().max(2_048)).optional(),
  retryPolicy: z
    .object({
      maxRetries: z.coerce.number().int().min(0).max(10).default(3),
      backoffMs: z.coerce.number().int().min(0).max(60_000).default(1_000),
    })
    .optional(),
});
export type WebhookOutputConfig = z.infer<typeof webhookOutputConfigSchema>;

// 任意已落库的 config(用于响应 DTO 与表单回填):六种之一
export const connectorConfigShapeSchema = z.union([
  redisInputConfigSchema,
  redisOutputConfigSchema,
  kafkaInputConfigSchema,
  kafkaOutputConfigSchema,
  webhookInputConfigSchema,
  webhookOutputConfigSchema,
]);
export type ConnectorConfigShape = z.infer<typeof connectorConfigShapeSchema>;

// ---------------------------------------------------------------------------
// 通用字段
// ---------------------------------------------------------------------------

const connectorNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[\w一-龥][\w一-龥 -]{0,79}$/u, {
    message: 'name must start with letter/digit/underscore/CJK; allow spaces and hyphens; 2-80 chars',
  });

const connectorDescriptionSchema = z.string().trim().max(500).optional();

const ipWhitelistEntrySchema = z
  .string()
  .trim()
  .min(7)
  .max(64)
  .regex(/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/u, {
    message: 'ip whitelist entry must be IPv4 or IPv4/CIDR',
  });
const ipWhitelistSchema = z.array(ipWhitelistEntrySchema).max(64);

// ---------------------------------------------------------------------------
// 创建 DTO:三层嵌套的 discriminatedUnion(先 type 再 direction)
// 6 个具体 schema 各自约束自己的本地连接配置 / webhookPath / config / token / ipWhitelist 等
// ---------------------------------------------------------------------------

const createCommonBase = {
  name: connectorNameSchema,
  description: connectorDescriptionSchema,
};

const createRedisInputSchema = z
  .object({
    ...createCommonBase,
    type: z.literal('redis'),
    direction: z.literal('input'),
    credentials: redisConnectorCredentialsSchema.optional(),
    config: redisInputConfigSchema,
  })
  .superRefine((value, ctx) => {
    if (!value.config.connection) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['config', 'connection'],
        message: 'redis connector requires config.connection',
      });
    }
  });

const createRedisOutputSchema = z
  .object({
    ...createCommonBase,
    type: z.literal('redis'),
    direction: z.literal('output'),
    credentials: redisConnectorCredentialsSchema.optional(),
    config: redisOutputConfigSchema,
  })
  .superRefine((value, ctx) => {
    if (!value.config.connection) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['config', 'connection'],
        message: 'redis connector requires config.connection',
      });
    }
  });

const createKafkaInputSchema = z
  .object({
    ...createCommonBase,
    type: z.literal('kafka'),
    direction: z.literal('input'),
    credentials: kafkaConnectorCredentialsSchema.optional(),
    config: kafkaInputConfigSchema,
  })
  .superRefine((value, ctx) => {
    if (!value.config.connection) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['config', 'connection'],
        message: 'kafka connector requires config.connection',
      });
    }
  });

const createKafkaOutputSchema = z
  .object({
    ...createCommonBase,
    type: z.literal('kafka'),
    direction: z.literal('output'),
    credentials: kafkaConnectorCredentialsSchema.optional(),
    config: kafkaOutputConfigSchema,
  })
  .superRefine((value, ctx) => {
    if (!value.config.connection) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['config', 'connection'],
        message: 'kafka connector requires config.connection',
      });
    }
  });

const createWebhookInputSchema = z.object({
  ...createCommonBase,
  type: z.literal('webhook'),
  direction: z.literal('input'),
  tokenId: z.string().uuid(),
  ipWhitelist: ipWhitelistSchema.optional(),
  config: webhookInputConfigSchema,
});

const createWebhookOutputSchema = z.object({
  ...createCommonBase,
  type: z.literal('webhook'),
  direction: z.literal('output'),
  config: webhookOutputConfigSchema,
});

// 注意:Zod discriminatedUnion 一次只支持一层 discriminator,所以这里用 union(由
// type+direction 共同 narrow),前端构造时按 type/direction 选具体 schema。
export const createConnectorSchema = z.union([
  createRedisInputSchema,
  createRedisOutputSchema,
  createKafkaInputSchema,
  createKafkaOutputSchema,
  createWebhookInputSchema,
  createWebhookOutputSchema,
]);
export type CreateConnectorDto = z.infer<typeof createConnectorSchema>;
export type CreateRedisInputConnectorDto = z.infer<typeof createRedisInputSchema>;
export type CreateRedisOutputConnectorDto = z.infer<typeof createRedisOutputSchema>;
export type CreateKafkaInputConnectorDto = z.infer<typeof createKafkaInputSchema>;
export type CreateKafkaOutputConnectorDto = z.infer<typeof createKafkaOutputSchema>;
export type CreateWebhookInputConnectorDto = z.infer<typeof createWebhookInputSchema>;
export type CreateWebhookOutputConnectorDto = z.infer<typeof createWebhookOutputSchema>;

// 各分支 schema 也对外导出,供前端按 (type, direction) 显式选择校验。
export const createConnectorSchemaByKind = {
  'redis:input': createRedisInputSchema,
  'redis:output': createRedisOutputSchema,
  'kafka:input': createKafkaInputSchema,
  'kafka:output': createKafkaOutputSchema,
  'webhook:input': createWebhookInputSchema,
  'webhook:output': createWebhookOutputSchema,
} as const satisfies Record<string, z.ZodTypeAny>;

// ---------------------------------------------------------------------------
// 更新 DTO:扁平 partial,禁 type / direction
// ---------------------------------------------------------------------------

export const updateConnectorSchema = z
  .object({
    name: connectorNameSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    config: connectorConfigShapeSchema.optional(),
    credentials: z.union([redisConnectorCredentialsSchema, kafkaConnectorCredentialsSchema]).optional(),
    tokenId: z.string().uuid().optional(),
    ipWhitelist: ipWhitelistSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => !('type' in value) && !('direction' in value), {
    message: 'type / direction cannot be changed after creation',
  });
export type UpdateConnectorDto = z.infer<typeof updateConnectorSchema>;

// ---------------------------------------------------------------------------
// 引用统计(本期 stub)
// ---------------------------------------------------------------------------

export const connectorReferencesSummarySchema = z.object({
  canaryReleases: z.number().int().nonnegative(),
  productionReleases: z.number().int().nonnegative(),
});
export type ConnectorReferencesSummaryDto = z.infer<typeof connectorReferencesSummarySchema>;

export const connectorReferenceItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['canary_release', 'production_release']),
  name: z.string().nullable(),
  status: z.string(),
});
export type ConnectorReferenceItemDto = z.infer<typeof connectorReferenceItemSchema>;

export const connectorReferencesResponseSchema = z.object({
  summary: connectorReferencesSummarySchema,
  references: z.array(connectorReferenceItemSchema),
});
export type ConnectorReferencesResponseDto = z.infer<typeof connectorReferencesResponseSchema>;

// ---------------------------------------------------------------------------
// 列表项 / 详情
// ---------------------------------------------------------------------------

export const connectorTokenSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
});
export type ConnectorTokenSummaryDto = z.infer<typeof connectorTokenSummarySchema>;

export const connectorListItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  direction: connectorDirectionSchema,
  type: connectorTypeSchema,
  webhookPath: z.string().nullable(),
  hasToken: z.boolean(),
  ipWhitelistCount: z.number().int().nonnegative(),
  configSummary: z.string(),
  healthStatus: connectorHealthStatusSchema,
  lastProbedAt: z.string().datetime().nullable(),
  lastProbeError: z.string().nullable(),
  references: connectorReferencesSummarySchema,
  createdBy: z.string().uuid(),
  createdByDisplayName: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ConnectorListItemDto = z.infer<typeof connectorListItemSchema>;

export const connectorListResponseSchema = z.object({
  data: z.array(connectorListItemSchema),
  total: z.number().int().nonnegative(),
});
export type ConnectorListResponseDto = z.infer<typeof connectorListResponseSchema>;

export const connectorDetailSchema = connectorListItemSchema.extend({
  config: connectorConfigShapeSchema,
  token: connectorTokenSummarySchema.nullable(),
  ipWhitelist: z.array(z.string()).nullable(),
});
export type ConnectorDetailDto = z.infer<typeof connectorDetailSchema>;

// ---------------------------------------------------------------------------
// Probe / Peek
// ---------------------------------------------------------------------------

export const probeConnectorResponseSchema = z.object({
  connectorId: z.string().uuid(),
  status: z.enum(['success', 'failed']),
  probedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  error: z.string().nullable(),
});
export type ProbeConnectorResponseDto = z.infer<typeof probeConnectorResponseSchema>;

export const peekConnectorRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).default(5),
});
export type PeekConnectorRequestDto = z.infer<typeof peekConnectorRequestSchema>;

export const peekConnectorResponseSchema = z.object({
  connectorId: z.string().uuid(),
  source: z.enum(['driver', 'unavailable']),
  messages: z.array(peekConnectorMessageSchema),
  payloadSchema: jsonSchemaShape.nullable(),
  fetchedAt: z.string().datetime(),
  error: z.string().nullable(),
});
export type PeekConnectorResponseDto = z.infer<typeof peekConnectorResponseSchema>;

// ---------------------------------------------------------------------------
// 批量删除
// ---------------------------------------------------------------------------

export const bulkDeleteConnectorsRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
  force: z.boolean().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type BulkDeleteConnectorsRequestDto = z.infer<typeof bulkDeleteConnectorsRequestSchema>;

export const bulkDeleteConnectorRejectionSchema = z.object({
  id: z.string().uuid(),
  reason: z.string(),
  referencedBy: connectorReferencesSummarySchema.optional(),
});
export type BulkDeleteConnectorRejectionDto = z.infer<typeof bulkDeleteConnectorRejectionSchema>;

export const bulkDeleteConnectorsResponseSchema = z.object({
  deletedIds: z.array(z.string().uuid()),
  rejected: z.array(bulkDeleteConnectorRejectionSchema),
});
export type BulkDeleteConnectorsResponseDto = z.infer<typeof bulkDeleteConnectorsResponseSchema>;

// ---------------------------------------------------------------------------
// param / query
// ---------------------------------------------------------------------------

export const connectorIdParamSchema = z.string().uuid();

export const connectorDeleteQuerySchema = z.object({
  force: z.coerce.boolean().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type ConnectorDeleteQueryDto = z.infer<typeof connectorDeleteQuerySchema>;

export const connectorListQuerySchema = z.object({
  direction: connectorDirectionSchema.optional(),
  type: connectorTypeSchema.optional(),
  healthStatus: connectorHealthStatusSchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
});
export type ConnectorListQueryDto = z.infer<typeof connectorListQuerySchema>;

// ---------------------------------------------------------------------------
// helper: 由 (type, direction) 推 config schema 的运行时函数
// ---------------------------------------------------------------------------

export function getConnectorConfigSchema(type: ConnectorType, direction: ConnectorDirection): z.ZodTypeAny {
  if (type === 'redis') {
    return direction === 'input' ? redisInputConfigSchema : redisOutputConfigSchema;
  }
  if (type === 'kafka') {
    return direction === 'input' ? kafkaInputConfigSchema : kafkaOutputConfigSchema;
  }
  return direction === 'input' ? webhookInputConfigSchema : webhookOutputConfigSchema;
}

import { z } from 'zod';

export const kafkaSaslMechanismSchema = z.enum(['PLAIN', 'SCRAM-SHA-256', 'SCRAM-SHA-512']);
export const kafkaSecurityProtocolSchema = z.enum(['PLAINTEXT', 'SASL_PLAINTEXT', 'SASL_SSL', 'SSL']);
export const connectorHealthStatusSchema = z.enum(['healthy', 'degraded', 'unhealthy', 'unknown']);
export const redisDeploymentTypeSchema = z.enum(['standalone', 'sentinel', 'cluster']);
export const redisConsumerModeSchema = z.enum(['list', 'stream']);
export type RedisConsumerMode = z.infer<typeof redisConsumerModeSchema>;

// ---------------------------------------------------------------------------
// Connector (business term: connector; DB physical table: ph_assets.connectors)
// See docs/specs/26-connectors.md §3 / docs/specs/06-database-schema.md §4.5
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
// config variants: one schema per (type, direction)
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

// Any persisted config (used by response DTO and form rehydration): one of six
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
// Common fields
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
// Create DTO: triple-nested discriminatedUnion (first by type, then by direction)
// Six concrete schemas each constrain their own local connection config / webhookPath / config / token / ipWhitelist, etc.
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
  // @deprecated webhook tokens are now self-managed by the connector (scope='webhook' AND connector_id=...);
  // when creating a connector, the server auto-generates the first webhook token. The tokenId sent by the frontend is silently ignored;
  // the field is kept for short-term compatibility with the legacy frontend form. See docs/specs/06-database-schema.md §3.2 / §4.5.
  tokenId: z.string().uuid().optional(),
  ipWhitelist: ipWhitelistSchema.optional(),
  config: webhookInputConfigSchema,
});

const createWebhookOutputSchema = z.object({
  ...createCommonBase,
  type: z.literal('webhook'),
  direction: z.literal('output'),
  config: webhookOutputConfigSchema,
});

// Note: Zod discriminatedUnion only supports a single-layer discriminator, so we use union here (narrowed by
// the combination of type+direction); on the frontend, pick the concrete schema by type/direction.
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

// Each branch schema is also exported so the frontend can explicitly pick validation by (type, direction).
export const createConnectorSchemaByKind = {
  'redis:input': createRedisInputSchema,
  'redis:output': createRedisOutputSchema,
  'kafka:input': createKafkaInputSchema,
  'kafka:output': createKafkaOutputSchema,
  'webhook:input': createWebhookInputSchema,
  'webhook:output': createWebhookOutputSchema,
} as const satisfies Record<string, z.ZodTypeAny>;

// ---------------------------------------------------------------------------
// Update DTO: flat partial; type / direction are forbidden
// ---------------------------------------------------------------------------

export const updateConnectorSchema = z
  .object({
    name: connectorNameSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    config: connectorConfigShapeSchema.optional(),
    credentials: z.union([redisConnectorCredentialsSchema, kafkaConnectorCredentialsSchema]).optional(),
    // @deprecated see createWebhookInputSchema comment; silently ignored in the update path too.
    tokenId: z.string().uuid().optional(),
    ipWhitelist: ipWhitelistSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => !('type' in value) && !('direction' in value), {
    message: 'type / direction cannot be changed after creation',
  });
export type UpdateConnectorDto = z.infer<typeof updateConnectorSchema>;

// ---------------------------------------------------------------------------
// Reference counting (stubbed in this cycle)
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
// List item / detail
// ---------------------------------------------------------------------------

export const connectorTokenSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
});
export type ConnectorTokenSummaryDto = z.infer<typeof connectorTokenSummarySchema>;

// per-connector webhook token(scope='webhook' AND connector_id=...)
// See docs/specs/06-database-schema.md §3.2 and docs/specs/26-connectors.md
export const connectorWebhookTokenSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  lastUsedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type ConnectorWebhookTokenSummaryDto = z.infer<typeof connectorWebhookTokenSummarySchema>;

export const connectorWebhookTokenListSchema = z.object({
  data: z.array(connectorWebhookTokenSummarySchema),
  total: z.number().int().nonnegative(),
});
export type ConnectorWebhookTokenListDto = z.infer<typeof connectorWebhookTokenListSchema>;

export const createWebhookTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    expiresAt: z.iso
      .datetime()
      .optional()
      .refine((value) => value === undefined || new Date(value).getTime() > Date.now(), {
        message: 'expiresAt must be in the future',
      }),
  })
  .strict();
export type CreateWebhookTokenDto = z.infer<typeof createWebhookTokenSchema>;

export const createWebhookTokenResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  plaintext: z.string(),
  expiresAt: z.iso.datetime().nullable(),
});
export type CreateWebhookTokenResponseDto = z.infer<typeof createWebhookTokenResponseSchema>;

// reveal endpoint: decrypt from token_encrypted and return the plaintext, aligned with user token reveal.
// See docs/specs/06-database-schema.md §3.2 "token_encrypted is used for on-demand reveal of recoverable tokens on the local admin console"
export const revealWebhookTokenResponseSchema = z.object({
  tokenId: z.string().uuid(),
  plaintext: z.string().nullable(),
  available: z.boolean(),
});
export type RevealWebhookTokenResponseDto = z.infer<typeof revealWebhookTokenResponseSchema>;

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
  // Full list of all active webhook tokens currently held by this connector (scope='webhook', revoked_at IS NULL).
  // Always an empty array for non-webhook-input connectors.
  webhookTokens: z.array(connectorWebhookTokenSummarySchema),
  ipWhitelist: z.array(z.string()).nullable(),
});
export type ConnectorDetailDto = z.infer<typeof connectorDetailSchema>;

// The create response additionally returns the plaintext of the first auto-generated webhook token (only appears at creation time).
export const connectorCreateResponseSchema = connectorDetailSchema.extend({
  initialWebhookToken: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      prefix: z.string(),
      plaintext: z.string(),
      expiresAt: z.iso.datetime().nullable(),
    })
    .optional(),
});
export type ConnectorCreateResponseDto = z.infer<typeof connectorCreateResponseSchema>;

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
// Batch delete
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
// Helper: runtime function that derives the config schema from (type, direction)
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

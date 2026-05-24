import { z } from 'zod';

export const WEBHOOK_ASYNC_CALL_TTL_SECONDS = 30 * 60;
export const WEBHOOK_ASYNC_CALL_KEY_PREFIX = 'ph:webhook:call';

export function webhookAsyncCallKey(callId: string): string {
  return `${WEBHOOK_ASYNC_CALL_KEY_PREFIX}:${callId}`;
}

export const webhookAsyncCallContextSchema = z.object({
  callId: z.string().uuid(),
  runResultId: z.string().uuid(),
  projectId: z.string().uuid(),
  connectorId: z.string().uuid(),
  releaseLineEventId: z.string().uuid().optional(),
  canaryId: z.string().uuid().optional(),
  externalId: z.string().nullable(),
  acceptedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type WebhookAsyncCallContext = z.infer<typeof webhookAsyncCallContextSchema>;

const webhookAsyncCallReceiptBaseSchema = webhookAsyncCallContextSchema.extend({
  updatedAt: z.string().datetime(),
});

export const webhookAsyncCallPendingReceiptSchema = webhookAsyncCallReceiptBaseSchema.extend({
  status: z.literal('pending'),
});

export const webhookAsyncCallSuccessReceiptSchema = webhookAsyncCallReceiptBaseSchema.extend({
  status: z.literal('success'),
  completedAt: z.string().datetime(),
  result: z.unknown().nullable(),
  rawResponse: z.string().nullable(),
  parsedOutput: z.unknown().nullable(),
  decisionOutput: z.string().nullable(),
  judgmentStatus: z.string().nullable(),
  latencyMs: z.number().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  costEstimate: z.number().nullable(),
});

export const webhookAsyncCallErrorReceiptSchema = webhookAsyncCallReceiptBaseSchema.extend({
  status: z.literal('error'),
  completedAt: z.string().datetime(),
  runStatus: z.string(),
  errorClass: z.string().nullable(),
  errorMessage: z.string().nullable(),
  latencyMs: z.number().nullable(),
});

export const webhookAsyncCallReceiptSchema = z.discriminatedUnion('status', [
  webhookAsyncCallPendingReceiptSchema,
  webhookAsyncCallSuccessReceiptSchema,
  webhookAsyncCallErrorReceiptSchema,
]);
export type WebhookAsyncCallReceipt = z.infer<typeof webhookAsyncCallReceiptSchema>;
export type WebhookAsyncCallSuccessReceipt = z.infer<typeof webhookAsyncCallSuccessReceiptSchema>;
export type WebhookAsyncCallErrorReceipt = z.infer<typeof webhookAsyncCallErrorReceiptSchema>;

export function remainingWebhookAsyncCallTtlSeconds(
  expiresAt: string,
  nowMs = Date.now(),
): number {
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) return 0;
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
}

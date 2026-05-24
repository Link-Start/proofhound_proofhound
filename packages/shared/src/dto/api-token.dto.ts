import { z } from 'zod';

const apiTokenNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[\w一-龥][\w一-龥 -]{0,79}$/u, {
    message: 'name must start with letter/digit/underscore/CJK; allow spaces and hyphens; 2-80 chars',
  });

const ipWhitelistEntrySchema = z
  .string()
  .trim()
  .min(7)
  .max(64)
  .regex(/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/u, {
    message: 'ip whitelist entry must be IPv4 or IPv4/CIDR',
  });

export const apiTokenSummarySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  ipWhitelist: z.array(z.string()).nullable(),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid(),
  createdByDisplayName: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ApiTokenSummaryDto = z.infer<typeof apiTokenSummarySchema>;

export const revealApiTokenResponseSchema = z.object({
  tokenId: z.string().uuid(),
  plaintext: z.string().nullable(),
  available: z.boolean(),
});
export type RevealApiTokenResponseDto = z.infer<typeof revealApiTokenResponseSchema>;

export const deleteApiTokenResponseSchema = z.object({
  tokenId: z.string().uuid(),
});
export type DeleteApiTokenResponseDto = z.infer<typeof deleteApiTokenResponseSchema>;

export const listApiTokensResponseSchema = z.object({
  data: z.array(apiTokenSummarySchema),
  total: z.number().int().nonnegative(),
});
export type ListApiTokensResponseDto = z.infer<typeof listApiTokensResponseSchema>;

export const createApiTokenSchema = z.object({
  name: apiTokenNameSchema,
  ipWhitelist: z.array(ipWhitelistEntrySchema).max(64).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});
export type CreateApiTokenDto = z.infer<typeof createApiTokenSchema>;

export const createApiTokenResponseSchema = z.object({
  token: apiTokenSummarySchema,
  plaintext: z.string(),
});
export type CreateApiTokenResponseDto = z.infer<typeof createApiTokenResponseSchema>;

export const updateApiTokenSchema = z.object({
  name: apiTokenNameSchema,
  expiresAt: z.string().datetime().nullable().optional(),
});
export type UpdateApiTokenDto = z.infer<typeof updateApiTokenSchema>;

export const updateApiTokenResponseSchema = z.object({
  token: apiTokenSummarySchema,
});
export type UpdateApiTokenResponseDto = z.infer<typeof updateApiTokenResponseSchema>;

export const apiTokenIdParamSchema = z.string().uuid();

export const globalMcpTokenSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  prefix: z.string(),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export type GlobalMcpTokenSummaryDto = z.infer<typeof globalMcpTokenSummarySchema>;

export const getGlobalMcpTokenResponseSchema = z.object({
  token: globalMcpTokenSummarySchema.nullable(),
});
export type GetGlobalMcpTokenResponseDto = z.infer<typeof getGlobalMcpTokenResponseSchema>;

export const createGlobalMcpTokenSchema = z.object({
  name: apiTokenNameSchema,
  expiresAt: z.string().datetime().nullable().optional(),
});
export type CreateGlobalMcpTokenDto = z.infer<typeof createGlobalMcpTokenSchema>;

export const createGlobalMcpTokenResponseSchema = z.object({
  token: globalMcpTokenSummarySchema,
  plaintext: z.string(),
});
export type CreateGlobalMcpTokenResponseDto = z.infer<typeof createGlobalMcpTokenResponseSchema>;

export const updateGlobalMcpTokenSchema = z.object({
  name: apiTokenNameSchema,
  expiresAt: z.string().datetime().nullable().optional(),
});
export type UpdateGlobalMcpTokenDto = z.infer<typeof updateGlobalMcpTokenSchema>;

export const updateGlobalMcpTokenResponseSchema = z.object({
  token: globalMcpTokenSummarySchema,
});
export type UpdateGlobalMcpTokenResponseDto = z.infer<typeof updateGlobalMcpTokenResponseSchema>;

export const revealGlobalMcpTokenResponseSchema = z.object({
  tokenId: z.string().uuid(),
  plaintext: z.string().nullable(),
  available: z.boolean(),
});
export type RevealGlobalMcpTokenResponseDto = z.infer<typeof revealGlobalMcpTokenResponseSchema>;

export const deleteGlobalMcpTokenResponseSchema = z.object({
  tokenId: z.string().uuid(),
});
export type DeleteGlobalMcpTokenResponseDto = z.infer<typeof deleteGlobalMcpTokenResponseSchema>;

import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).optional(),
  PORT: z.coerce.number().int().positive().optional(),
  SERVER_PORT: z.coerce.number().int().positive().default(4000),
  SERVER_PUBLIC_URL: z.string().url().optional(),
  SERVER_BODY_LIMIT: z.string().optional(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MCP_TOKEN_SIGNING_SECRET: z.string().min(16),
  MODEL_API_KEY_ENCRYPTION_KEY: z.string().refine((v) => {
    try {
      return Buffer.from(v, 'base64').length === 32;
    } catch {
      return false;
    }
  }, 'MODEL_API_KEY_ENCRYPTION_KEY must be 32 random bytes encoded as base64'),
});

export type Env = z.infer<typeof envSchema>;

import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug']).optional(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  PORT: z.coerce.number().int().positive().optional(),
  WEBHOOK_BODY_LIMIT: z.string().default('1mb'),
});

export type Env = z.infer<typeof envSchema>;

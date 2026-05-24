import { describe, expect, it } from 'vitest';
import { envSchema } from '../env.schema';
import { resolveListenPort } from '../listen-port';

const requiredEnv = {
  DATABASE_URL: 'postgresql://proofhound:proofhound@localhost:5432/proofhound',
  REDIS_URL: 'redis://localhost:6379',
};

describe('resolveListenPort', () => {
  it('prefers Railway PORT when it is provided', () => {
    const env = envSchema.parse({
      ...requiredEnv,
      PORT: '8080',
    });

    expect(resolveListenPort(env)).toEqual({ port: 8080, source: 'PORT' });
  });

  it('keeps the local default when PORT is not set', () => {
    const env = envSchema.parse(requiredEnv);

    expect(resolveListenPort(env)).toEqual({ port: 4001, source: 'default' });
  });
});

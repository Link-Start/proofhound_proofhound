import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getServerBaseUrl } from './public-env';

const PUBLIC_ENV_KEYS = ['NEXT_PUBLIC_SERVER_URL', 'NEXT_PUBLIC_API_URL'] as const;

beforeEach(() => {
  for (const key of PUBLIC_ENV_KEYS) {
    vi.stubEnv(key, '');
  }
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('public env helpers', () => {
  it('normalizes the preferred server URL', () => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://api.example.com/');

    expect(getServerBaseUrl()).toBe('https://api.example.com');
  });

  it('keeps the legacy API URL fallback available for production deploys', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://legacy-api.example.com/');

    expect(getServerBaseUrl()).toBe('https://legacy-api.example.com');
  });

  it('fails production deploys when no server URL is configured', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(() => getServerBaseUrl()).toThrow(/NEXT_PUBLIC_SERVER_URL/);
  });
});

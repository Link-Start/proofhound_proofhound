import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { httpClient } from './http';

const originalAdapter = httpClient.defaults.adapter;

describe('httpClient', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    httpClient.defaults.adapter = originalAdapter;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends requests without injecting browser auth state', async () => {
    httpClient.defaults.adapter = async (config) =>
      Promise.resolve({
        data: { authorization: config.headers?.Authorization ?? null },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      });

    const response = await httpClient.get<{ authorization: string | null }>('/models');

    expect(response.data.authorization).toBeNull();
  });
});

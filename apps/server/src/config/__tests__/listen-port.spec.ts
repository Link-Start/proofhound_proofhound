import { describe, expect, it } from 'vitest';
import { resolveListenPort } from '../listen-port';

describe('resolveListenPort', () => {
  it('prefers Railway PORT when it is provided', () => {
    expect(resolveListenPort({ PORT: '8080', SERVER_PORT: '4000' })).toEqual({ port: 8080, source: 'PORT' });
  });

  it('falls back to SERVER_PORT for local development', () => {
    expect(resolveListenPort({ SERVER_PORT: '4000' })).toEqual({ port: 4000, source: 'SERVER_PORT' });
  });

  it('keeps the SERVER_PORT default when neither port variable is set', () => {
    expect(resolveListenPort({})).toEqual({ port: 4000, source: 'SERVER_PORT' });
  });

  it('rejects invalid PORT values instead of silently listening elsewhere', () => {
    expect(() => resolveListenPort({ PORT: 'not-a-port', SERVER_PORT: '4000' })).toThrow(
      'PORT_must_be_a_positive_integer',
    );
  });
});

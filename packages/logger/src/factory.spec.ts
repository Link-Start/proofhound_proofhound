import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './factory';

function createCaptureStream() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  return {
    stream,
    readEntries: () =>
      chunks
        .join('')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('createLogger', () => {
  it('emits structured pino logs with ProofHound base fields', () => {
    const capture = createCaptureStream();
    const logger = createLogger('model.service', {
      service: 'api',
      version: 'test-version',
      env: 'test',
      destination: capture.stream,
    });

    logger.info({ modelId: 'model-1' }, 'model_created');

    const [entry] = capture.readEntries();
    expect(entry).toMatchObject({
      level: 30,
      service: 'api',
      version: 'test-version',
      env: 'test',
      namespace: 'model.service',
      modelId: 'model-1',
      msg: 'model_created',
    });
    expect(entry?.time).toEqual(expect.any(String));
    expect(entry?.host).toEqual(expect.any(String));
  });

  it('redacts sensitive fields before output', () => {
    const capture = createCaptureStream();
    const logger = createLogger('redact-test', {
      env: 'test',
      destination: capture.stream,
    });

    logger.info(
      {
        apiKey: 'secret-key',
        token: 'secret-token',
        headers: { authorization: 'Bearer abc' },
      },
      'secret_seen',
    );

    const [entry] = capture.readEntries();
    expect(entry?.apiKey).toBe('[REDACTED]');
    expect(entry?.token).toBe('[REDACTED]');
    expect(entry?.headers).toEqual({ authorization: '[REDACTED]' });
  });
});

import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InvalidApiKeyPayloadError, decryptApiKey, encryptApiKey } from './api-key-crypto';

function freshKey(): string {
  return randomBytes(32).toString('base64');
}

describe('api-key-crypto', () => {
  it('round-trips api keys', () => {
    const key = freshKey();
    const plain = 'sk-test-1234567890';
    const cipher = encryptApiKey(plain, key);
    expect(cipher).not.toBe(plain);
    expect(decryptApiKey(cipher, key)).toBe(plain);
  });

  it('produces a different ciphertext per call (random IV)', () => {
    const key = freshKey();
    const c1 = encryptApiKey('same-value', key);
    const c2 = encryptApiKey('same-value', key);
    expect(c1).not.toBe(c2);
  });

  it('rejects a key that does not decode to 32 bytes', () => {
    const shortKey = Buffer.from('short').toString('base64');
    expect(() => encryptApiKey('plain', shortKey)).toThrowError(InvalidApiKeyPayloadError);
    expect(() => decryptApiKey('payload', shortKey)).toThrowError(InvalidApiKeyPayloadError);
  });

  it('rejects payloads shorter than IV + tag + 1', () => {
    const key = freshKey();
    const tooShort = Buffer.alloc(10).toString('base64');
    expect(() => decryptApiKey(tooShort, key)).toThrowError(InvalidApiKeyPayloadError);
  });

  it('rejects ciphertext when GCM tag is tampered', () => {
    const key = freshKey();
    const cipher = encryptApiKey('sk-real', key);
    const buf = Buffer.from(cipher, 'base64');
    // Flip a single bit in the tag region
    buf[15] = buf[15]! ^ 0x01;
    const tampered = buf.toString('base64');
    expect(() => decryptApiKey(tampered, key)).toThrowError(InvalidApiKeyPayloadError);
  });

  it('rejects ciphertext when decryption key does not match', () => {
    const key1 = freshKey();
    const key2 = freshKey();
    const cipher = encryptApiKey('sk-real', key1);
    expect(() => decryptApiKey(cipher, key2)).toThrowError(InvalidApiKeyPayloadError);
  });
});

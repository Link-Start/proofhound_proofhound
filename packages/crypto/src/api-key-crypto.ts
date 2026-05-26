import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM payload layout: 12B IV ‖ 16B auth tag ‖ ciphertext, base64-encoded.
// server / worker / seed-dev share the same implementation — the single source of truth.
// Key rotation is not yet implemented; if rotation is required later, write a one-shot re-encrypt migration.

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export class InvalidApiKeyPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidApiKeyPayloadError';
  }
}

function loadKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new InvalidApiKeyPayloadError(
      `encryption key must decode to ${KEY_BYTES} random bytes (got ${key.length})`,
    );
  }
  return key;
}

export function encryptApiKey(plain: string, keyBase64: string): string {
  const key = loadKey(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptApiKey(payload: string, keyBase64: string): string {
  const key = loadKey(keyBase64);
  const buf = Buffer.from(payload, 'base64');
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new InvalidApiKeyPayloadError('encrypted api key payload is too short');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    throw new InvalidApiKeyPayloadError(
      `failed to decrypt api key payload: ${(err as Error).message}`,
    );
  }
}

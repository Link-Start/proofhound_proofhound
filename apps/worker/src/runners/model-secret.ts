import { decryptApiKey } from '@proofhound/crypto';

export interface ModelSecretRow {
  apiKeyEncrypted: string;
}

export interface ModelSecretResolver {
  resolveApiKey(model: ModelSecretRow): Promise<string>;
}

export interface ModelSecretResolverOptions {
  encryptionKey: string;
}

// 解密统一走 @proofhound/crypto——与 server CryptoService / seed-dev 共用同一份实现 + 同一个 MODEL_API_KEY_ENCRYPTION_KEY。
// 不再支持 plain: / env: / aes-256-gcm: 三种历史前缀；DB 里只存 server CryptoService.encryptApiKey() 输出的无前缀 base64。
export function createModelSecretResolver(options: ModelSecretResolverOptions): ModelSecretResolver {
  return {
    async resolveApiKey(model) {
      return decryptApiKey(model.apiKeyEncrypted, options.encryptionKey);
    },
  };
}

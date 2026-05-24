import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptApiKey, encryptApiKey } from '@proofhound/crypto';

// API KEY 的加解密算法 / 格式定义在 @proofhound/crypto，server / worker / seed 唯一事实标准。
// 本 service 只负责注入 MODEL_API_KEY_ENCRYPTION_KEY 并暴露 NestJS 友好的封装。

@Injectable()
export class CryptoService {
  private readonly keyBase64: string;

  constructor(configService: ConfigService) {
    this.keyBase64 = configService.getOrThrow<string>('MODEL_API_KEY_ENCRYPTION_KEY');
  }

  encryptApiKey(plain: string): string {
    return encryptApiKey(plain, this.keyBase64);
  }

  decryptApiKey(payload: string): string {
    return decryptApiKey(payload, this.keyBase64);
  }

  getCredentialTail(plain: string): string {
    return plain.length <= 4 ? plain : plain.slice(-4);
  }
}

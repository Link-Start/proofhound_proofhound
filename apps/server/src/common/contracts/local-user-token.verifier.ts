// LocalUserTokenVerifier
// 共享底层：sha256 hash → 查 `ph_core.tokens where scope='user'` → 过期 / IP 校验 → 异步 touch last_used_at。
//
// 设计取舍：这是 infra 层 helper，不是 resolver。
// LocalActorContextResolver（HTTP）与 LocalMcpAuthResolver（MCP）各自持有一个 verifier 实例，
// 两个 resolver 互不引用对方（遵守 SPEC §8 红线）。
//
// IP 白名单的边界：verifier 暴露 `verify(token, { clientIp? })` 接口，
// IP 校验仅在调用方提供 clientIp 时生效。
// - HTTP resolver 从 req.ip / socket.remoteAddress 解析后传入；
// - MCP / `resolveFromUserToken(token)` 直接路径不传，意味着 IP 校验跳过。
//   这与 SPEC §3.2 "ip_whitelist 在 resolveFromHttp 做 IP 检查；resolveFromUserToken 不做" 一致。
//
// Last-used touch：fire-and-forget，错误吞掉只记 warn 不阻塞响应。
//
// 详见 docs/specs/08-saas-adapter-boundary.md §3.2 / §3.3 / §3.5

import { createHash } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createLogger } from '@proofhound/logger';
import type { DbClient } from '@proofhound/db';
import { schema } from '@proofhound/db';
import { DATABASE_CLIENT } from '../../infrastructure/database/database.constants';
import type { ActorContext } from '../actor-context';

const { tokens } = schema;

export interface VerifyUserTokenOptions {
  /**
   * 当前请求的客户端 IP（仅在 HTTP 路径提供）。
   * 提供时若 token 配置了 ip_whitelist 且不命中，抛 `ip_not_allowed`。
   * 不提供时跳过 IP 校验（resolveFromUserToken / MCP 路径）。
   */
  clientIp?: string;
}

interface UserTokenRowMinimal {
  id: string;
  ipWhitelist: unknown;
  expiresAt: Date | null;
}

@Injectable()
export class LocalUserTokenVerifier {
  private readonly logger = createLogger('auth.user-token-verifier', { service: 'api' });

  constructor(@Inject(DATABASE_CLIENT) private readonly db: DbClient) {}

  async verify(token: string, options: VerifyUserTokenOptions = {}): Promise<ActorContext> {
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('invalid_user_token');
    }
    const tokenHash = this.hashToken(token);
    const rows = await this.db
      .select({
        id: tokens.id,
        ipWhitelist: tokens.ipWhitelist,
        expiresAt: tokens.expiresAt,
      })
      .from(tokens)
      .where(and(eq(tokens.tokenHash, tokenHash), eq(tokens.scope, 'user'), isNull(tokens.revokedAt)))
      .limit(1);

    const row: UserTokenRowMinimal | undefined = rows[0];
    if (!row) throw new UnauthorizedException('invalid_user_token');

    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('expired_user_token');
    }

    if (options.clientIp && Array.isArray(row.ipWhitelist) && row.ipWhitelist.length > 0) {
      const allow = (row.ipWhitelist as string[]).includes(options.clientIp);
      if (!allow) throw new UnauthorizedException('ip_not_allowed');
    }

    // Fire-and-forget touch last_used_at
    this.touchLastUsed(row.id);

    // TODO(spec-§3.2-actor-kind): SPEC 草案讨论将 HTTP user token 的 actor.kind 细化为
    // `script:<tokenId>`，OSS 当前 ActorKind 枚举只有 'user_token'，保留不动；
    // 待 ZiqiXiao 在 ActorContext shape 演进时一并决定。
    return {
      actorId: row.id,
      actorKind: 'user_token',
    };
  }

  private hashToken(plaintext: string): string {
    return createHash('sha256').update(plaintext).digest('hex');
  }

  private touchLastUsed(tokenId: string): void {
    this.db
      .update(tokens)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(tokens.id, tokenId))
      .then(() => undefined)
      .catch((err: unknown) => {
        this.logger.warn({ tokenId, err }, 'user_token_last_used_touch_failed');
      });
  }
}

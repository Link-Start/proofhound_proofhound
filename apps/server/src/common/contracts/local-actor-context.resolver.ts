// LocalActorContextResolver — HTTP 入口默认实现
// 详见 docs/specs/08-saas-adapter-boundary.md §3.2
//
// 行为：
//   - 从 `Authorization: Bearer <token>` 解析；缺失 / 格式错抛 401
//   - 调 LocalUserTokenVerifier（sha256 比对 ph_core.tokens scope='user'）
//   - 提供 req.ip 给 verifier 做 ip_whitelist 校验
//   - 成功后返回 ActorContext，由 LocalActorGuard 适配成 CurrentUserPayload

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ActorContextResolver } from './actor-context.resolver';
import { LocalUserTokenVerifier } from './local-user-token.verifier';
import type { HttpRequestLike } from './types';
import type { ActorContext } from '../actor-context';

@Injectable()
export class LocalActorContextResolver extends ActorContextResolver {
  constructor(private readonly verifier: LocalUserTokenVerifier) {
    super();
  }

  async resolveFromHttp(req: HttpRequestLike): Promise<ActorContext> {
    const token = this.extractBearerToken(req);
    const clientIp = req.ip ?? req.socket?.remoteAddress;
    return this.verifier.verify(token, { clientIp });
  }

  async resolveFromUserToken(token: string): Promise<ActorContext> {
    // ip_whitelist 跳过：本接口不持有请求 IP，SPEC §3.2 明确这条路径不校验 IP
    return this.verifier.verify(token);
  }

  private extractBearerToken(req: HttpRequestLike): string {
    const raw = req.headers['authorization'] ?? req.headers['Authorization'];
    if (!raw) throw new UnauthorizedException('missing_user_token');
    const header = Array.isArray(raw) ? raw[0] : raw;
    if (!header) throw new UnauthorizedException('missing_user_token');
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) throw new UnauthorizedException('invalid_authorization_header');
    const token = match[1]?.trim();
    if (!token) throw new UnauthorizedException('invalid_authorization_header');
    return token;
  }
}

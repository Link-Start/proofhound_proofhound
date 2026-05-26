// LocalActorContextResolver — default implementation for the HTTP entry
// See docs/specs/08-saas-adapter-boundary.md §3.2
//
// Behavior:
//   - Parses `Authorization: Bearer <token>`; throws 401 if missing / malformed
//   - Calls LocalUserTokenVerifier (sha256 compare against ph_core.tokens where scope='user')
//   - Provides req.ip to the verifier for ip_whitelist validation
//   - On success returns ActorContext, which LocalActorGuard adapts into CurrentUserPayload

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
    // ip_whitelist skip: this entry does not carry the request IP; SPEC §3.2 explicitly states this path does not check IP
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

import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalActorContextResolver } from '../local-actor-context.resolver';
import type { LocalUserTokenVerifier } from '../local-user-token.verifier';
import type { HttpRequestLike } from '../types';

describe('LocalActorContextResolver', () => {
  let verifier: { verify: ReturnType<typeof vi.fn> };
  let resolver: LocalActorContextResolver;

  beforeEach(() => {
    verifier = { verify: vi.fn().mockResolvedValue({ actorId: 'tok-1', actorKind: 'user_token' }) };
    resolver = new LocalActorContextResolver(verifier as unknown as LocalUserTokenVerifier);
  });

  function buildReq(authHeader: string | string[] | undefined, ip?: string): HttpRequestLike {
    return {
      headers: authHeader === undefined ? {} : { authorization: authHeader },
      ip,
    };
  }

  it('happy path: 解析 Bearer header + 把 ip 传给 verifier', async () => {
    const actor = await resolver.resolveFromHttp(buildReq('Bearer ph_tok_abc', '127.0.0.1'));
    expect(actor).toEqual({ actorId: 'tok-1', actorKind: 'user_token' });
    expect(verifier.verify).toHaveBeenCalledWith('ph_tok_abc', { clientIp: '127.0.0.1' });
  });

  it('缺少 Authorization header 抛 missing_user_token', async () => {
    await expect(resolver.resolveFromHttp(buildReq(undefined))).rejects.toThrow(/missing_user_token/);
  });

  it('header 不是 Bearer 抛 invalid_authorization_header', async () => {
    await expect(resolver.resolveFromHttp(buildReq('Basic foo'))).rejects.toThrow(
      /invalid_authorization_header/,
    );
  });

  it('Bearer 后无 token 抛 invalid_authorization_header', async () => {
    await expect(resolver.resolveFromHttp(buildReq('Bearer   '))).rejects.toThrow(
      /invalid_authorization_header/,
    );
  });

  it('verifier 抛 401 时不被包装', async () => {
    verifier.verify.mockRejectedValueOnce(new UnauthorizedException('invalid_user_token'));
    await expect(resolver.resolveFromHttp(buildReq('Bearer x'))).rejects.toThrow(/invalid_user_token/);
  });

  it('header 是数组时取第一个', async () => {
    await resolver.resolveFromHttp(buildReq(['Bearer ph_tok_first', 'Bearer ph_tok_second']));
    expect(verifier.verify).toHaveBeenCalledWith('ph_tok_first', { clientIp: undefined });
  });

  it('fallback 到 socket.remoteAddress 作为 clientIp', async () => {
    const req: HttpRequestLike = {
      headers: { authorization: 'Bearer ph_tok_abc' },
      socket: { remoteAddress: '10.0.0.5' },
    };
    await resolver.resolveFromHttp(req);
    expect(verifier.verify).toHaveBeenCalledWith('ph_tok_abc', { clientIp: '10.0.0.5' });
  });

  it('resolveFromUserToken 不传 clientIp 给 verifier', async () => {
    await resolver.resolveFromUserToken('ph_tok_x');
    expect(verifier.verify).toHaveBeenCalledWith('ph_tok_x');
  });
});

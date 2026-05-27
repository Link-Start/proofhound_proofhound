import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ActorContextResolver } from '../../contracts/actor-context.resolver';
import { LocalActorGuard } from '../local-actor.guard';

function buildContext(req: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('LocalActorGuard', () => {
  it('成功路径：注入 request.user 为 CurrentUserPayload', async () => {
    const resolver: Pick<ActorContextResolver, 'resolveFromHttp' | 'resolveFromUserToken'> = {
      resolveFromHttp: vi.fn().mockResolvedValue({ actorId: 'tok-1', actorKind: 'script' }),
      resolveFromUserToken: vi.fn(),
    };
    const guard = new LocalActorGuard(resolver as ActorContextResolver);
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    const ok = await guard.canActivate(buildContext(req));

    expect(ok).toBe(true);
    expect(req.user).toEqual({
      sub: 'tok-1',
      actorId: 'tok-1',
      actorKind: 'script',
      projectId: undefined,
      email: '',
      // script actor 是 owner-created API token，OSS 视为 super admin
      isSuperAdmin: true,
      isActive: true,
    });
  });

  it('resolver 抛 401 时 guard 不吞错', async () => {
    const resolver: Pick<ActorContextResolver, 'resolveFromHttp' | 'resolveFromUserToken'> = {
      resolveFromHttp: vi.fn().mockRejectedValue(new UnauthorizedException('invalid_user_token')),
      resolveFromUserToken: vi.fn(),
    };
    const guard = new LocalActorGuard(resolver as ActorContextResolver);
    await expect(guard.canActivate(buildContext({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('local_user actor (UI session) 映射 isSuperAdmin=true', async () => {
    const resolver: Pick<ActorContextResolver, 'resolveFromHttp' | 'resolveFromUserToken'> = {
      resolveFromHttp: vi.fn().mockResolvedValue({ actorId: 'admin-1', actorKind: 'local_user' }),
      resolveFromUserToken: vi.fn(),
    };
    const guard = new LocalActorGuard(resolver as ActorContextResolver);
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    await guard.canActivate(buildContext(req));
    expect((req.user as { isSuperAdmin: boolean }).isSuperAdmin).toBe(true);
  });

  it('system_mcp actor 映射 isSuperAdmin=false（系统 actor 走 access-control 系统旁路）', async () => {
    const resolver: Pick<ActorContextResolver, 'resolveFromHttp' | 'resolveFromUserToken'> = {
      resolveFromHttp: vi.fn().mockResolvedValue({ actorId: 'mcp-1', actorKind: 'system_mcp' }),
      resolveFromUserToken: vi.fn(),
    };
    const guard = new LocalActorGuard(resolver as ActorContextResolver);
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    await guard.canActivate(buildContext(req));
    expect((req.user as { isSuperAdmin: boolean }).isSuperAdmin).toBe(false);
  });
});

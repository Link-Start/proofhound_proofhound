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
      resolveFromHttp: vi.fn().mockResolvedValue({ actorId: 'tok-1', actorKind: 'user_token' }),
      resolveFromUserToken: vi.fn(),
    };
    const guard = new LocalActorGuard(resolver as ActorContextResolver);
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    const ok = await guard.canActivate(buildContext(req));

    expect(ok).toBe(true);
    expect(req.user).toEqual({
      sub: 'tok-1',
      actorId: 'tok-1',
      actorKind: 'user_token',
      projectId: undefined,
      email: '',
      isSuperAdmin: false,
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

  it('local_admin actor 映射 isSuperAdmin=true', async () => {
    const resolver: Pick<ActorContextResolver, 'resolveFromHttp' | 'resolveFromUserToken'> = {
      resolveFromHttp: vi.fn().mockResolvedValue({ actorId: 'admin-1', actorKind: 'local_admin' }),
      resolveFromUserToken: vi.fn(),
    };
    const guard = new LocalActorGuard(resolver as ActorContextResolver);
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer x' } };
    await guard.canActivate(buildContext(req));
    expect((req.user as { isSuperAdmin: boolean }).isSuperAdmin).toBe(true);
  });
});

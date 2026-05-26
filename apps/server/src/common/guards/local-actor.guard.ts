// LocalActorGuard
// HTTP 入口校验：通过 ActorContextResolver 解析 `Authorization: Bearer <token>`，
// 把结果适配成 `CurrentUserPayload` 注入 request.user。
//
// 不再硬编码 LOCAL_ACTOR；任何无效 / 缺失 / 过期 / IP 不允许的请求都抛 401。
//
// 详见 docs/specs/08-saas-adapter-boundary.md §3.2 + §7 PR4

import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ActorContextResolver } from '../contracts/actor-context.resolver';
import type { ActorContext } from '../actor-context';
import type { CurrentUserPayload } from '../decorators/current-user.decorator';

// 保留导出以避免触发其它历史调用；新增代码不应依赖该常量。
// 真正的 actorId 由 ph_core.tokens 行主键决定。
export const LOCAL_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

@Injectable()
export class LocalActorGuard implements CanActivate {
  constructor(private readonly resolver: ActorContextResolver) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: CurrentUserPayload }>();

    const actor = await this.resolver.resolveFromHttp(request);
    request.user = toCurrentUserPayload(actor);
    return true;
  }
}

function toCurrentUserPayload(actor: ActorContext): CurrentUserPayload {
  return {
    sub: actor.actorId,
    actorId: actor.actorId,
    actorKind: actor.actorKind,
    projectId: actor.projectId,
    // OSS user token 不带 email / role 元数据；保留字段是 backward compat。
    // SaaS 形态可在 RemoteActorContextResolver 内填充自己的 actor.claims，由专门 decorator 暴露；
    // OSS 业务代码 **不** 读 claims（SPEC §8 红线）。
    email: '',
    isSuperAdmin: actor.actorKind === 'local_admin',
    isActive: true,
  };
}

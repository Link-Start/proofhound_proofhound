import { ForbiddenException } from '@nestjs/common';
import type { ActorContext, ProjectContext } from './actor-context';
import type { CurrentUserPayload } from './decorators/current-user.decorator';

export type AccessAction =
  | 'project_read'
  | 'project_write'
  | 'release_manage'
  | 'platform_manage'
  | 'user_token_manage'
  | 'mcp_tool';

export function toActorContext(actor: CurrentUserPayload | ActorContext): ActorContext {
  const maybeContext = actor as Partial<ActorContext>;
  if (maybeContext.actorId && maybeContext.actorKind) {
    return {
      actorId: maybeContext.actorId,
      actorKind: maybeContext.actorKind,
      projectId: maybeContext.projectId,
    };
  }
  const current = actor as CurrentUserPayload;
  return {
    actorId: current.sub,
    actorKind: current.actorKind ?? 'local_admin',
    projectId: current.projectId,
  };
}

// OSS self-hosted: 单工作区 + 本地管理端,所有 user_token / local_admin / system 在本地默认全 allow。
// SaaS 形态由 RbacAccessControl override(详见 docs/specs/08-saas-adapter-boundary.md §3.6)。
class SelfHostedAccessControl {
  assertCan(actor: CurrentUserPayload | ActorContext, action: AccessAction, context?: Partial<ProjectContext>): void {
    const normalized = toActorContext(actor);
    void context;

    if (normalized.actorKind === 'system' || normalized.actorKind === 'local_admin') return;
    if (normalized.actorKind === 'user_token') {
      if (action === 'platform_manage') throw new ForbiddenException('platform_manage_forbidden');
      return;
    }

    throw new ForbiddenException('actor_forbidden');
  }
}

export const accessControl = new SelfHostedAccessControl();

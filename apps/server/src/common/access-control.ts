import { ForbiddenException } from '@nestjs/common';
import type { ActorContext, ProjectContext } from './actor-context';
import type { CurrentUserPayload } from './decorators/current-user.decorator';

export type AccessAction = 'project_read' | 'project_write' | 'release_manage' | 'platform_manage' | 'mcp_tool';

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

class SelfHostedAccessControl {
  assertCan(actor: CurrentUserPayload | ActorContext, action: AccessAction, context?: Partial<ProjectContext>): void {
    const normalized = toActorContext(actor);

    if (normalized.actorKind === 'system' || normalized.actorKind === 'local_admin') return;
    if (normalized.actorKind === 'global_mcp_token') {
      if (action === 'platform_manage') throw new ForbiddenException('platform_manage_forbidden');
      return;
    }

    if (normalized.actorKind === 'project_api_token') {
      if (!context?.projectId || normalized.projectId !== context.projectId) {
        throw new ForbiddenException('project_scope_forbidden');
      }
      if (action === 'platform_manage' || action === 'mcp_tool') {
        throw new ForbiddenException(`${action}_forbidden`);
      }
      return;
    }

    throw new ForbiddenException('actor_forbidden');
  }
}

export const accessControl = new SelfHostedAccessControl();

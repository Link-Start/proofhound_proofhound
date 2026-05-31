import { ForbiddenException } from '@nestjs/common';
import type { ActorContext, ActorKind, ProjectContext } from './actor-context';
import type { CurrentUserPayload } from './decorators/current-user.decorator';

export type AccessAction =
  | 'project_read'
  | 'project_write'
  | 'release_manage'
  | 'platform_manage'
  | 'user_token_manage'
  | 'mcp_tool';

// Actors produced by system entry resolvers (MCP / Webhook ingress).
// In OSS self-hosted these bypass all access checks. SaaS RbacAccessControl can tighten this
// (e.g. restrict system_webhook to channel actions only) — see SPEC §3.6.
const SYSTEM_ACTOR_KINDS: ReadonlyArray<ActorKind> = ['system_mcp', 'system_webhook'];

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
    actorKind: current.actorKind ?? 'local_user',
    projectId: current.projectId,
  };
}

// OSS self-hosted single workspace: local_user (UI session) and system_* (MCP / webhook) pass everything;
// script (API token) is also a local-owner credential but cannot manage platform-level resources (e.g. token
// CRUD) to avoid token-laundering. The SaaS form overrides this via RbacAccessControl
// (see docs/specs/08-saas-adapter-boundary.md §3.6).
class SelfHostedAccessControl {
  assertCan(actor: CurrentUserPayload | ActorContext, action: AccessAction, context?: Partial<ProjectContext>): void {
    const normalized = toActorContext(actor);
    void context;

    if (SYSTEM_ACTOR_KINDS.includes(normalized.actorKind) || normalized.actorKind === 'local_user') return;
    if (normalized.actorKind === 'script') {
      if (action === 'platform_manage') throw new ForbiddenException('platform_manage_forbidden');
      return;
    }

    throw new ForbiddenException('actor_forbidden');
  }
}

export const accessControl = new SelfHostedAccessControl();

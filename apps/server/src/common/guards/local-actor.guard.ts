// LocalActorGuard
// HTTP entry validation: parse `Authorization: Bearer <token>` via ActorContextResolver,
// then adapt the result into `CurrentUserPayload` injected as request.user.
//
// LOCAL_ACTOR is no longer hardcoded; any invalid / missing / expired / IP-disallowed request throws 401.
//
// See docs/specs/08-saas-adapter-boundary.md §3.2 + §7 PR4

import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { ActorContextResolver } from '../contracts/actor-context.resolver';
import type { ActorContext } from '../actor-context';
import type { CurrentUserPayload } from '../decorators/current-user.decorator';

// Export kept to avoid breaking other historical callers; new code must not depend on this constant.
// The real actorId is determined by the ph_core.tokens row primary key.
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
    // OSS user tokens have no email / role metadata; the field is kept for backward compatibility.
    // The SaaS form can populate its own actor.claims inside RemoteActorContextResolver, exposed via a dedicated decorator;
    // OSS business code MUST NOT read claims (SPEC §8 red line).
    email: '',
    isSuperAdmin: actor.actorKind === 'local_admin',
    isActive: true,
  };
}

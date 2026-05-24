import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { CurrentUserPayload } from '../decorators/current-user.decorator';

export const LOCAL_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

export const LOCAL_ACTOR: CurrentUserPayload = {
  sub: LOCAL_ACTOR_ID,
  actorId: LOCAL_ACTOR_ID,
  actorKind: 'local_admin',
  email: 'local-admin@proofhound.local',
  isSuperAdmin: true,
  isActive: true,
};

@Injectable()
export class LocalActorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: CurrentUserPayload }>();

    request.user = LOCAL_ACTOR;
    return true;
  }
}

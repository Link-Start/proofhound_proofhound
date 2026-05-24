import { Injectable } from '@nestjs/common';
import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';
import type { ActorContext } from './actor-context';
import type { CurrentUserPayload } from './decorators/current-user.decorator';

export type ProjectContextInput = ActorContext | CurrentUserPayload | undefined;

export function resolveProjectContext(_input?: ProjectContextInput): ProjectContext {
  return LOCAL_PROJECT_CONTEXT;
}

@Injectable()
export class ProjectContextProvider {
  resolveProjectContext(input?: ProjectContextInput): ProjectContext {
    return resolveProjectContext(input);
  }
}

export type ActorKind = 'local_admin' | 'user_token' | 'system';

export interface ActorContext {
  actorId: string;
  actorKind: ActorKind;
  projectId?: string;
}

export type { ProjectContext } from '@proofhound/shared';

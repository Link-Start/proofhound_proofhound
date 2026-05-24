export type ActorKind = 'local_admin' | 'project_api_token' | 'global_mcp_token' | 'system';

export interface ActorContext {
  actorId: string;
  actorKind: ActorKind;
  projectId?: string;
}

export type { ProjectContext } from '@proofhound/shared';

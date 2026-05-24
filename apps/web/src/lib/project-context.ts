import { LOCAL_PROJECT_CONTEXT, type ProjectContext } from '@proofhound/shared';

export type { ProjectContext } from '@proofhound/shared';

export function resolveProjectContext(): ProjectContext {
  return LOCAL_PROJECT_CONTEXT;
}

export interface ProjectContext {
  projectId: string;
  source: 'local';
}

export const LOCAL_PROJECT_ID = '00000000-0000-4000-8000-000000000001';

export const LOCAL_PROJECT_CONTEXT: ProjectContext = Object.freeze({
  projectId: LOCAL_PROJECT_ID,
  source: 'local',
});

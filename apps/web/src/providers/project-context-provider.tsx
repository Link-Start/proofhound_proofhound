'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { resolveProjectContext, type ProjectContext } from '@/lib/project-context';

const CurrentProjectContext = createContext<ProjectContext | null>(null);

export function ProjectContextProvider({ children }: { children: ReactNode }) {
  const projectContext = useMemo(() => resolveProjectContext(), []);

  return <CurrentProjectContext.Provider value={projectContext}>{children}</CurrentProjectContext.Provider>;
}

export function useProjectContext(): ProjectContext {
  const context = useContext(CurrentProjectContext);
  if (!context) {
    throw new Error('project_context_provider_missing');
  }
  return context;
}

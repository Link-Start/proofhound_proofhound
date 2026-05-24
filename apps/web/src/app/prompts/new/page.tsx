'use client';

import { useProjectContext } from '@/providers/project-context-provider';
import { PromptsListPage } from '../_components/prompts-list-page';

export default function ProjectPromptNewRoute() {
  const { projectId } = useProjectContext();

  return <PromptsListPage projectId={projectId} initialCreateDialogOpen />;
}

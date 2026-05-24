'use client';

import { useProjectContext } from '@/providers/project-context-provider';
import { ModelsListPage } from './_components/models-list-page';

export default function ProjectModelsPage() {
  const { projectId } = useProjectContext();

  return <ModelsListPage projectId={projectId} />;
}

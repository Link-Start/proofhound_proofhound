'use client';

import { useProjectContext } from '@/providers/project-context-provider';
import { DatasetsListPage } from './_components/datasets-list-page';

export default function ProjectDatasetsPage() {
  const { projectId } = useProjectContext();

  return <DatasetsListPage projectId={projectId} />;
}

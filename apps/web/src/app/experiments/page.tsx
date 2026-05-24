'use client';

import { useProjectContext } from '@/providers/project-context-provider';
import { ExperimentsListPage } from './_components/experiments-list-page';

export default function ProjectExperimentsPage() {
  const { projectId } = useProjectContext();

  return <ExperimentsListPage projectId={projectId} />;
}

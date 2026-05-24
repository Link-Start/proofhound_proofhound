'use client';

import { useProjectContext } from '@/providers/project-context-provider';
import { ReleasesListPage } from './_components/releases-list-page';

export default function ProjectReleasesPage() {
  const { projectId } = useProjectContext();
  return <ReleasesListPage projectId={projectId} />;
}

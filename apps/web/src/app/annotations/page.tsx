'use client';

import { useProjectContext } from '@/providers/project-context-provider';
import { AnnotationsListPage } from './_components/annotations-list-page';

export default function ProjectAnnotationsPage() {
  const { projectId } = useProjectContext();
  return <AnnotationsListPage projectId={projectId} />;
}

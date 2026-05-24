'use client';

import { useProjectContext } from '@/providers/project-context-provider';
import { OptimizationsListPage } from './_components/optimizations-list-page';

export default function ProjectOptimizationsPage() {
  const { projectId } = useProjectContext();

  return <OptimizationsListPage projectId={projectId} />;
}

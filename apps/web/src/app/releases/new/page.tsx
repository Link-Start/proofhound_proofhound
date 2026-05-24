'use client';

import { useProjectContext } from '@/providers/project-context-provider';
import { ReleaseNewPage } from '../_components/release-new-page';

export default function ProjectReleaseNewRoute() {
  const { projectId } = useProjectContext();
  return <ReleaseNewPage projectId={projectId} />;
}

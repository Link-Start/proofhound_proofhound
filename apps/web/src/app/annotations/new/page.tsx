'use client';

import { useProjectContext } from '@/providers/project-context-provider';
import { AnnotationNewPage } from '../_components/annotation-new-page';

export default function ProjectAnnotationNewRoute() {
  const { projectId } = useProjectContext();
  return <AnnotationNewPage projectId={projectId} />;
}

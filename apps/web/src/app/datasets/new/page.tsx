'use client';

import { useProjectContext } from '@/providers/project-context-provider';
import { DatasetUploadPage } from '../_components/dataset-upload-page';

export default function ProjectDatasetUploadRoute() {
  const { projectId } = useProjectContext();

  return <DatasetUploadPage projectId={projectId} />;
}

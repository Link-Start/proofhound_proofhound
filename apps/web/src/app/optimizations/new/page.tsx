'use client';

import { useSearchParams } from 'next/navigation';
import { useProjectContext } from '@/providers/project-context-provider';
import { OptimizationNewPage } from './_components/optimization-new-page';

export default function ProjectOptimizationNewPage() {
  const searchParams = useSearchParams();
  const { projectId } = useProjectContext();
  const initialPromptId = searchParams.get('promptId') ?? null;
  const initialPromptVersionId = searchParams.get('promptVersionId') ?? null;
  const initialDatasetId = searchParams.get('datasetId') ?? null;
  const initialSourceExperimentId = searchParams.get('sourceExperimentId') ?? searchParams.get('experimentId') ?? null;

  return (
    <OptimizationNewPage
      projectId={projectId}
      initialDatasetId={initialDatasetId}
      initialPromptId={initialPromptId}
      initialPromptVersionId={initialPromptVersionId}
      initialSourceExperimentId={initialSourceExperimentId}
    />
  );
}

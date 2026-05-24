'use client';

import { useParams } from 'next/navigation';
import { useProjectContext } from '@/providers/project-context-provider';
import { Main } from '@/components/layout/main';
import { Button } from '@/components/ui/button';
import { PlatformLoader } from '@/components/ui/platform-loader';
import { useDataset, useDatasetSamples } from '@/hooks/dataset';
import { useI18n } from '@/i18n';
import { isCanonicalUuid } from '@/lib/uuid';
import { DatasetDetailPage } from '../_components/dataset-detail-page';
import { toProjectDataset } from '../_components/dataset-mappers';

function getParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default function ProjectDatasetDetailRoute() {
  const { t } = useI18n();
  const params = useParams<{ datasetId?: string | string[] }>();
  const { projectId } = useProjectContext();
  const datasetId = getParam(params.datasetId);
  const canUseApi = isCanonicalUuid(projectId) && isCanonicalUuid(datasetId);
  const datasetQuery = useDataset(canUseApi ? projectId : '', canUseApi ? datasetId : '');
  const samplesQuery = useDatasetSamples(canUseApi ? projectId : '', canUseApi ? datasetId : '');

  if (canUseApi && (datasetQuery.isLoading || samplesQuery.isLoading)) {
    return (
      <Main className="gap-0 bg-muted/35 p-0">
        <div className="mx-auto w-full max-w-[1760px] px-4 py-6 sm:px-6 lg:px-8" data-testid="dataset-detail-page">
          <PlatformLoader className="min-h-[560px]" />
        </div>
      </Main>
    );
  }

  const dataset = datasetQuery.data ? toProjectDataset(datasetQuery.data) : null;

  if (!dataset) {
    return (
      <Main className="gap-0 bg-muted/35 p-0">
        <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:px-8" data-testid="dataset-detail-page">
          <div className="rounded-lg border bg-card p-8 text-center">
            <h1 className="text-xl font-semibold">{t('common.notFound')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t('datasets.detail.notFoundDescription')}</p>
            <Button asChild className="mt-4">
              <a href={`/datasets`}>{t('datasets.title')}</a>
            </Button>
          </div>
        </div>
      </Main>
    );
  }

  return <DatasetDetailPage key={dataset.id} projectId={projectId} dataset={dataset} samplesData={samplesQuery.data?.data} />;
}

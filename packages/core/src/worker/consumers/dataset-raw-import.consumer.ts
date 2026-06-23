import { Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { createLogger } from '@proofhound/logger';
import { datasetRawImportJobPayloadSchema, type DatasetRawImportJobPayload } from '@proofhound/orchestration-shared';
import type { Job } from 'bullmq';
import { ObjectStorageProvider } from '../../server/common/contracts/object-storage.provider';
import { QuotaPolicyHook } from '../../server/common/contracts/quota-policy.hook';
import { UsageMeteringHook } from '../../server/common/contracts/usage-metering.hook';
import { DatasetImportRepository } from '../../server/modules/dataset/dataset-import.repository';
import { createDatasetRawImportRunner } from '../runners/dataset-raw-import-runner';

@Processor('dataset-import', { concurrency: 2 })
@Injectable()
export class DatasetRawImportConsumer extends WorkerHost {
  private readonly logger = createLogger('worker.dataset-raw-import', { service: 'worker' });
  private readonly runDatasetRawImportJob: ReturnType<typeof createDatasetRawImportRunner>;

  constructor(
    repo: DatasetImportRepository,
    storage: ObjectStorageProvider,
    quotaPolicy: QuotaPolicyHook,
    usageMetering: UsageMeteringHook,
  ) {
    super();
    this.runDatasetRawImportJob = createDatasetRawImportRunner({
      repo,
      storage,
      quotaPolicy,
      usageMetering,
      logger: this.logger,
    });
  }

  async process(
    job: Job<unknown>,
  ): Promise<{ importId: string; datasetId: string | null; sampleCount: number; status: string }> {
    const payload = datasetRawImportJobPayloadSchema.parse(job.data) satisfies DatasetRawImportJobPayload;
    return this.runDatasetRawImportJob(payload, {
      bullmqJobId: String(job.id),
      bullmqQueue: 'dataset-import',
      attempt: job.attemptsMade + 1,
    });
  }
}

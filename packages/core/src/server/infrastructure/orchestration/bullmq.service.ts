import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  datasetRawImportJobPayloadSchema,
  llmJobPayloadSchema,
  probeJobPayloadSchema,
  type DatasetRawImportJobPayload,
  type LlmJobPayload,
  type ProbeJobPayload,
} from '@proofhound/orchestration-shared';
import type { Queue } from 'bullmq';

// BullMQ producer: business Services dispatch tasks through this service
// See docs/specs/03-orchestration.md §2
@Injectable()
export class BullmqService {
  constructor(
    @InjectQueue('llm') private readonly llmQueue: Queue<LlmJobPayload>,
    @InjectQueue('probe') private readonly probeQueue: Queue<ProbeJobPayload>,
    @InjectQueue('dataset-import') private readonly datasetImportQueue: Queue<DatasetRawImportJobPayload>,
  ) {}

  async enqueueLlmJob(payload: LlmJobPayload, jobId?: string): Promise<string> {
    const parsed = llmJobPayloadSchema.parse(payload);
    const job = await this.llmQueue.add('llm-invoke', parsed, jobId ? { jobId } : undefined);
    return String(job.id);
  }

  async enqueueProbeJob(payload: ProbeJobPayload, jobId?: string): Promise<string> {
    const parsed = probeJobPayloadSchema.parse(payload);
    const job = await this.probeQueue.add('probe-model', parsed, jobId ? { jobId } : undefined);
    return String(job.id);
  }

  async enqueueDatasetRawImportJob(payload: DatasetRawImportJobPayload, jobId?: string): Promise<string> {
    const parsed = datasetRawImportJobPayloadSchema.parse(payload);
    const job = await this.datasetImportQueue.add('dataset-raw-import', parsed, jobId ? { jobId } : undefined);
    return String(job.id);
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ReleaseRunResultListResponseDto,
  RunResultDetailDto,
  RunResultListQueryDto,
  RunResultListResponseDto,
  RunResultReleaseListQueryDto,
} from '@proofhound/shared';
import type { ClassificationAggregateRow } from '@proofhound/metrics';
import { accessControl } from '../../common/access-control';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { RunResultRepository, type BatchTerminalCounts } from './run-result.repository';

@Injectable()
export class RunResultService {
  constructor(private readonly repo: RunResultRepository) {}

  aggregateExperiment(experimentId: string): Promise<ClassificationAggregateRow[]> {
    return this.repo.aggregateExperiment(experimentId);
  }

  aggregateExperimentLatency(experimentId: string) {
    return this.repo.aggregateExperimentLatency(experimentId);
  }

  countBatchTerminal(experimentId: string, runResultIds: string[]): Promise<BatchTerminalCounts> {
    return this.repo.countBatchTerminal(experimentId, runResultIds);
  }

  async listExperimentRunResults(
    projectId: string,
    experimentId: string,
    actor: CurrentUserPayload,
    query: RunResultListQueryDto,
  ): Promise<RunResultListResponseDto> {
    await this.assertExperimentAccessible(projectId, experimentId, actor);
    return this.repo.listByExperiment(experimentId, query);
  }

  async listReleaseRunResults(
    projectId: string,
    actor: CurrentUserPayload,
    query: RunResultReleaseListQueryDto,
  ): Promise<ReleaseRunResultListResponseDto> {
    accessControl.assertCan(actor, 'project_read', { projectId });
    return this.repo.listByRelease(projectId, query);
  }

  async getExperimentRunResult(
    projectId: string,
    experimentId: string,
    runResultId: string,
    actor: CurrentUserPayload,
  ): Promise<RunResultDetailDto> {
    await this.assertExperimentAccessible(projectId, experimentId, actor);
    const detail = await this.repo.getDetailById(experimentId, runResultId);
    if (!detail) {
      throw new NotFoundException(`Run result ${runResultId} not found`);
    }
    return detail;
  }

  private async assertExperimentAccessible(
    projectId: string,
    experimentId: string,
    actor: CurrentUserPayload,
  ): Promise<void> {
    accessControl.assertCan(actor, 'project_read', { projectId });
    const access = await this.repo.findAccessibleExperiment(projectId, experimentId, actor.sub, actor.isSuperAdmin);
    if (!access) {
      throw new NotFoundException(`Experiment ${experimentId} not found`);
    }
  }
}

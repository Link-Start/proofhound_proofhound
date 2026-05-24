import type {
  ModelMonitoringRankingResponseDto,
  ProjectMonitoringFilterDto,
  ProjectMonitoringStatsDto,
  ProjectMonitoringTimeseriesDto,
  PromptMonitoringRankingResponseDto,
} from '@proofhound/shared';
import { httpClient } from './http';

function toProjectMonitoringParams(filter: ProjectMonitoringFilterDto) {
  const params: Record<string, string> = {
    from: filter.from,
    to: filter.to,
    granularity: filter.granularity,
  };
  if (filter.modelIds?.length) params.modelIds = filter.modelIds.join(',');
  if (filter.promptIds?.length) params.promptIds = filter.promptIds.join(',');
  if (filter.promptVersionIds?.length) params.promptVersionIds = filter.promptVersionIds.join(',');
  if (filter.sourceIds?.length) params.sourceIds = filter.sourceIds.join(',');
  if (filter.sources?.length) params.sources = filter.sources.join(',');
  return params;
}

export const projectMonitoringClient = {
  getStats: (projectId: string, filter: ProjectMonitoringFilterDto) =>
    httpClient
      .get<ProjectMonitoringStatsDto>('/monitoring/stats', {
        params: toProjectMonitoringParams(filter),
        headers: { 'X-ProofHound-Project-Id': projectId },
      })
      .then((r) => r.data),

  getTimeseries: (projectId: string, filter: ProjectMonitoringFilterDto) =>
    httpClient
      .get<ProjectMonitoringTimeseriesDto>('/monitoring/timeseries', {
        params: toProjectMonitoringParams(filter),
        headers: { 'X-ProofHound-Project-Id': projectId },
      })
      .then((r) => r.data),

  getPromptsRanking: (
    projectId: string,
    filter: ProjectMonitoringFilterDto,
    sortBy: PromptMonitoringRankingResponseDto['sortBy'],
  ) =>
    httpClient
      .get<PromptMonitoringRankingResponseDto>('/monitoring/prompts/ranking', {
        params: { ...toProjectMonitoringParams(filter), sortBy },
        headers: { 'X-ProofHound-Project-Id': projectId },
      })
      .then((r) => r.data),

  getModelsRanking: (
    projectId: string,
    filter: ProjectMonitoringFilterDto,
    sortBy: ModelMonitoringRankingResponseDto['sortBy'],
  ) =>
    httpClient
      .get<ModelMonitoringRankingResponseDto>('/monitoring/models/ranking', {
        params: { ...toProjectMonitoringParams(filter), sortBy },
        headers: { 'X-ProofHound-Project-Id': projectId },
      })
      .then((r) => r.data),
};

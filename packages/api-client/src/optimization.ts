import type {
  OptimizationControlActionDto,
  OptimizationDetailDto,
  OptimizationListItemDto,
  OptimizationListQueryDto,
  OptimizationListResponseDto,
  CreateOptimizationDto,
} from '@proofhound/shared';
import { httpClient } from './http';

export const optimizationClient = {
  listOptimizations: (projectId: string, query?: OptimizationListQueryDto) =>
    httpClient
      .get<OptimizationListResponseDto>(`/optimizations`, { params: query })
      .then((r) => r.data),
  getOptimization: (projectId: string, optimizationId: string) =>
    httpClient
      .get<OptimizationDetailDto>(`/optimizations/${optimizationId}`)
      .then((r) => r.data),
  createOptimization: (projectId: string, body: CreateOptimizationDto) =>
    httpClient
      .post<OptimizationListItemDto>(`/optimizations`, body)
      .then((r) => r.data),
  controlOptimization: (
    projectId: string,
    optimizationId: string,
    action: OptimizationControlActionDto,
  ) =>
    httpClient
      .post<OptimizationListItemDto>(
        `/optimizations/${optimizationId}/actions/${action}`,
      )
      .then((r) => r.data),
  deleteOptimization: (projectId: string, optimizationId: string) =>
    httpClient
      .delete<void>(`/optimizations/${optimizationId}`)
      .then(() => undefined),
};

import type {
  AnnotationSampleDto,
  AnnotationSampleListResponseDto,
  AnnotationSampleStatusDto,
  AnnotationTaskDto,
  AnnotationTaskListResponseDto,
  AnnotationTaskOptionsResponseDto,
  ClaimAnnotationSamplesInputDto,
  ClaimAnnotationSamplesResponseDto,
  CreateAnnotationTaskInputDto,
  ReleaseAnnotationSampleInputDto,
  SubmitAnnotationSampleInputDto,
} from '@proofhound/shared';
import { httpClient } from './http';

export interface AnnotationSampleListQuery {
  status?: AnnotationSampleStatusDto;
  limit?: number;
  offset?: number;
}

export const annotationClient = {
  listTasks: (_projectId: string) =>
    httpClient.get<AnnotationTaskListResponseDto>('/annotation-tasks').then((r) => r.data),

  listOptions: (_projectId: string) =>
    httpClient.get<AnnotationTaskOptionsResponseDto>('/annotation-tasks/options').then((r) => r.data),

  getTask: (_projectId: string, taskId: string) =>
    httpClient.get<AnnotationTaskDto>(`/annotation-tasks/${taskId}`).then((r) => r.data),

  createTask: (_projectId: string, body: CreateAnnotationTaskInputDto) =>
    httpClient.post<AnnotationTaskDto>('/annotation-tasks', body).then((r) => r.data),

  listSamples: (_projectId: string, taskId: string, query?: AnnotationSampleListQuery) =>
    httpClient
      .get<AnnotationSampleListResponseDto>(`/annotation-tasks/${taskId}/samples`, { params: query })
      .then((r) => r.data),

  claimSamples: (_projectId: string, taskId: string, body: ClaimAnnotationSamplesInputDto) =>
    httpClient
      .post<ClaimAnnotationSamplesResponseDto>(`/annotation-tasks/${taskId}/samples/claim`, body)
      .then((r) => r.data),

  submitSample: (_projectId: string, taskId: string, body: SubmitAnnotationSampleInputDto) =>
    httpClient.post<AnnotationSampleDto>(`/annotation-tasks/${taskId}/samples/submit`, body).then((r) => r.data),

  releaseSample: (_projectId: string, taskId: string, body: ReleaseAnnotationSampleInputDto) =>
    httpClient.post<AnnotationSampleDto>(`/annotation-tasks/${taskId}/samples/release`, body).then((r) => r.data),
};

import type {
  ReleaseLineDto,
  ReleaseLineEventListResponseDto,
  ReleaseLineListResponseDto,
  UpdateReleaseLineRunConfigInputDto,
  UpdateReleaseLineTrafficRatioInputDto,
} from '@proofhound/shared';
import { httpClient } from './http';

export const releaseLineClient = {
  list: (_projectId: string) =>
    httpClient.get<ReleaseLineListResponseDto>('/release-lines').then((response) => response.data),

  get: (_projectId: string, releaseLineId: string) =>
    httpClient.get<ReleaseLineDto>(`/release-lines/${releaseLineId}`).then((response) => response.data),

  listEvents: (_projectId: string, releaseLineId: string) =>
    httpClient
      .get<ReleaseLineEventListResponseDto>(`/release-lines/${releaseLineId}/events`)
      .then((response) => response.data),

  updateTrafficRatio: (_projectId: string, releaseLineId: string, body: UpdateReleaseLineTrafficRatioInputDto) =>
    httpClient
      .post<ReleaseLineDto>(`/release-lines/${releaseLineId}/traffic-ratio`, body)
      .then((response) => response.data),

  updateRunConfig: (_projectId: string, releaseLineId: string, body: UpdateReleaseLineRunConfigInputDto) =>
    httpClient
      .post<ReleaseLineDto>(`/release-lines/${releaseLineId}/run-config`, body)
      .then((response) => response.data),
};

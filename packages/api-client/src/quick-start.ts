import type {
  CreateQuickStartDto,
  ProbeModelResponseDto,
  ProbeQuickStartDraftModelDto,
  QuickStartCreateResponseDto,
  QuickStartModelOptionsResponseDto,
} from '@proofhound/shared';
import { httpClient } from './http';

export const quickStartClient = {
  listModelOptions: () =>
    httpClient.get<QuickStartModelOptionsResponseDto>('/quick-start/models').then((r) => r.data),

  probeExistingModel: (modelId: string) =>
    httpClient.post<ProbeModelResponseDto>(`/quick-start/models/${modelId}/probe`).then((r) => r.data),

  probeDraftModel: (body: ProbeQuickStartDraftModelDto) =>
    httpClient.post<ProbeModelResponseDto>('/quick-start/models/probe-draft', body).then((r) => r.data),

  createQuickStart: (body: CreateQuickStartDto) =>
    httpClient.post<QuickStartCreateResponseDto>('/quick-start', body).then((r) => r.data),
};

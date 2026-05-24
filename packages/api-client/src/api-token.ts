import type {
  CreateApiTokenDto,
  CreateApiTokenResponseDto,
  CreateGlobalMcpTokenDto,
  CreateGlobalMcpTokenResponseDto,
  DeleteGlobalMcpTokenResponseDto,
  DeleteApiTokenResponseDto,
  GetGlobalMcpTokenResponseDto,
  RevealGlobalMcpTokenResponseDto,
  ListApiTokensResponseDto,
  RevealApiTokenResponseDto,
  UpdateApiTokenDto,
  UpdateApiTokenResponseDto,
  UpdateGlobalMcpTokenDto,
  UpdateGlobalMcpTokenResponseDto,
} from '@proofhound/shared';
import { httpClient } from './http';

export const apiTokenClient = {
  listApiTokens: () => httpClient.get<ListApiTokensResponseDto>(`/api-tokens`).then((r) => r.data),

  createApiToken: (body: CreateApiTokenDto) =>
    httpClient.post<CreateApiTokenResponseDto>(`/api-tokens`, body).then((r) => r.data),

  updateApiToken: (tokenId: string, body: UpdateApiTokenDto) =>
    httpClient.patch<UpdateApiTokenResponseDto>(`/api-tokens/${tokenId}`, body).then((r) => r.data),

  revealApiToken: (tokenId: string) =>
    httpClient.get<RevealApiTokenResponseDto>(`/api-tokens/${tokenId}/plaintext`).then((r) => r.data),

  deleteApiToken: (tokenId: string) =>
    httpClient.delete<DeleteApiTokenResponseDto>(`/api-tokens/${tokenId}`).then((r) => r.data),

  getGlobalMcpToken: () => httpClient.get<GetGlobalMcpTokenResponseDto>('/api-tokens/global-mcp').then((r) => r.data),

  createGlobalMcpToken: (body: CreateGlobalMcpTokenDto) =>
    httpClient.post<CreateGlobalMcpTokenResponseDto>('/api-tokens/global-mcp', body).then((r) => r.data),

  updateGlobalMcpToken: (tokenId: string, body: UpdateGlobalMcpTokenDto) =>
    httpClient.patch<UpdateGlobalMcpTokenResponseDto>(`/api-tokens/global-mcp/${tokenId}`, body).then((r) => r.data),

  revealGlobalMcpToken: (tokenId: string) =>
    httpClient.get<RevealGlobalMcpTokenResponseDto>(`/api-tokens/global-mcp/${tokenId}/plaintext`).then((r) => r.data),

  deleteGlobalMcpToken: (tokenId: string) =>
    httpClient.delete<DeleteGlobalMcpTokenResponseDto>(`/api-tokens/global-mcp/${tokenId}`).then((r) => r.data),
};

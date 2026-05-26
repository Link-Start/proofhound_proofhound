// 单一 user-facing token client：HTTP API + MCP 共用一个 token 模型。
// 详见 docs/specs/06-database-schema.md §3.2 / docs/specs/34-settings.md。
import type {
  CreateUserTokenDto,
  CreateUserTokenResponseDto,
  DeleteUserTokenResponseDto,
  ListUserTokensResponseDto,
  RevealUserTokenResponseDto,
  UpdateUserTokenDto,
  UpdateUserTokenResponseDto,
} from '@proofhound/shared';
import { httpClient } from './http';

export const tokenClient = {
  listTokens: () => httpClient.get<ListUserTokensResponseDto>(`/tokens`).then((r) => r.data),

  createToken: (body: CreateUserTokenDto) =>
    httpClient.post<CreateUserTokenResponseDto>(`/tokens`, body).then((r) => r.data),

  updateToken: (tokenId: string, body: UpdateUserTokenDto) =>
    httpClient.patch<UpdateUserTokenResponseDto>(`/tokens/${tokenId}`, body).then((r) => r.data),

  revealToken: (tokenId: string) =>
    httpClient.get<RevealUserTokenResponseDto>(`/tokens/${tokenId}/plaintext`).then((r) => r.data),

  deleteToken: (tokenId: string) =>
    httpClient.delete<DeleteUserTokenResponseDto>(`/tokens/${tokenId}`).then((r) => r.data),
};

// 前端 user token hooks。
// 后端只有一个 user token 资源（同一 token 同时用于 HTTP API、MCP channel、Webhook 入站鉴权）；
// Settings 页面使用单一 token 列表 UI。
import { tokenClient } from '@proofhound/api-client';
import type { CreateUserTokenDto, UpdateUserTokenDto } from '@proofhound/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const tokensKey = ['tokens'] as const;

export function useTokens() {
  return useQuery({
    queryKey: tokensKey,
    queryFn: () => tokenClient.listTokens(),
  });
}

export function useCreateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserTokenDto) => tokenClient.createToken(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tokensKey }),
  });
}

export function useRevealToken() {
  return useMutation({
    mutationFn: (tokenId: string) => tokenClient.revealToken(tokenId),
  });
}

export function useUpdateToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tokenId, body }: { tokenId: string; body: UpdateUserTokenDto }) =>
      tokenClient.updateToken(tokenId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tokensKey }),
  });
}

export function useDeleteToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => tokenClient.deleteToken(tokenId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: tokensKey }),
  });
}

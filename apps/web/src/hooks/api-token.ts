import { apiTokenClient } from '@proofhound/api-client';
import type {
  CreateApiTokenDto,
  CreateGlobalMcpTokenDto,
  UpdateApiTokenDto,
  UpdateGlobalMcpTokenDto,
} from '@proofhound/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const apiTokensKey = ['api-tokens'] as const;
const globalMcpTokenKey = ['api-tokens', 'global-mcp'] as const;

export function useApiTokens() {
  return useQuery({
    queryKey: apiTokensKey,
    queryFn: () => apiTokenClient.listApiTokens(),
  });
}

export function useCreateApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateApiTokenDto) => apiTokenClient.createApiToken(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: apiTokensKey }),
  });
}

export function useRevealApiToken() {
  return useMutation({
    mutationFn: (tokenId: string) => apiTokenClient.revealApiToken(tokenId),
  });
}

export function useUpdateApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tokenId, body }: { tokenId: string; body: UpdateApiTokenDto }) =>
      apiTokenClient.updateApiToken(tokenId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: apiTokensKey }),
  });
}

export function useDeleteApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => apiTokenClient.deleteApiToken(tokenId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: apiTokensKey }),
  });
}

export function useGlobalMcpToken() {
  return useQuery({
    queryKey: globalMcpTokenKey,
    queryFn: () => apiTokenClient.getGlobalMcpToken(),
  });
}

export function useCreateGlobalMcpToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateGlobalMcpTokenDto) => apiTokenClient.createGlobalMcpToken(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: globalMcpTokenKey }),
  });
}

export function useRevealGlobalMcpToken() {
  return useMutation({
    mutationFn: (tokenId: string) => apiTokenClient.revealGlobalMcpToken(tokenId),
  });
}

export function useUpdateGlobalMcpToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tokenId, body }: { tokenId: string; body: UpdateGlobalMcpTokenDto }) =>
      apiTokenClient.updateGlobalMcpToken(tokenId, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: globalMcpTokenKey }),
  });
}

export function useDeleteGlobalMcpToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) => apiTokenClient.deleteGlobalMcpToken(tokenId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: globalMcpTokenKey }),
  });
}

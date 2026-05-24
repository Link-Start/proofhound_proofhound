import { optimizationClient } from '@proofhound/api-client';
import type {
  OptimizationControlActionDto,
  OptimizationDetailDto,
  OptimizationListItemDto,
  OptimizationListQueryDto,
  CreateOptimizationDto,
} from '@proofhound/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

interface ControlOptimizationVariables {
  optimizationId: string;
  action: OptimizationControlActionDto;
}

const optimizationsQueryRoot = (projectId: string) => ['optimizations', projectId] as const;

export function getOptimizationListQueryKey(projectId: string, query?: OptimizationListQueryDto) {
  return [
    ...optimizationsQueryRoot(projectId),
    query?.status ?? 'all',
    query?.search ?? '',
    query?.sort ?? 'updated',
  ] as const;
}

export function getOptimizationDetailQueryKey(projectId: string, optimizationId: string) {
  return [...optimizationsQueryRoot(projectId), optimizationId] as const;
}

export function handleOptimizationCreated(
  queryClient: QueryClient,
  projectId: string,
  _created: OptimizationListItemDto,
) {
  // The create response is a list item. Detail pages must fetch OptimizationDetailDto.
  return queryClient.invalidateQueries({ queryKey: optimizationsQueryRoot(projectId) });
}

export function useOptimizations(projectId: string, query?: OptimizationListQueryDto) {
  return useQuery({
    queryKey: getOptimizationListQueryKey(projectId, query),
    queryFn: () => optimizationClient.listOptimizations(projectId, query),
    enabled: projectId.length > 0,
    placeholderData: (previousData) => previousData,
  });
}

export function useOptimization(projectId: string, optimizationId: string) {
  return useQuery({
    queryKey: getOptimizationDetailQueryKey(projectId, optimizationId),
    queryFn: () => optimizationClient.getOptimization(projectId, optimizationId),
    enabled: projectId.length > 0 && optimizationId.length > 0,
    retry: false,
  });
}

export function useCreateOptimization(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateOptimizationDto) => optimizationClient.createOptimization(projectId, body),
    onSuccess: (created) => {
      void handleOptimizationCreated(queryClient, projectId, created);
    },
  });
}

interface ControlMutationContext {
  previous?: OptimizationDetailDto;
}

export function useControlOptimization(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, ControlOptimizationVariables, ControlMutationContext>({
    mutationFn: ({ optimizationId, action }: ControlOptimizationVariables) =>
      optimizationClient.controlOptimization(projectId, optimizationId, action),
    // 抢占式 UI 反馈:后端 service 在 stop/cancel 时会一次性写 status 终态(SPEC 25 §7),
    // 这里在网络往返之前就把 detail cache 改成对应终态,用户点击后立即看到状态翻转。
    // resume 不做 optimistic(等真实响应,launcher 启动可能失败)。
    onMutate: async ({ optimizationId, action }) => {
      const nextStatus =
        action === 'stop' ? ('stopped' as const)
        : action === 'cancel' ? ('cancelled' as const)
        : null;
      if (!nextStatus) return {};
      const detailKey = getOptimizationDetailQueryKey(projectId, optimizationId);
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<OptimizationDetailDto>(detailKey);
      if (previous) {
        queryClient.setQueryData<OptimizationDetailDto>(detailKey, {
          ...previous,
          status: nextStatus,
          controlState: action,
          finishedAt: new Date().toISOString(),
        });
      }
      return { previous };
    },
    onError: (_err, { optimizationId }, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          getOptimizationDetailQueryKey(projectId, optimizationId),
          context.previous,
        );
      }
    },
    onSettled: (_data, _err, { optimizationId }) => {
      void queryClient.invalidateQueries({ queryKey: optimizationsQueryRoot(projectId) });
      void queryClient.invalidateQueries({ queryKey: getOptimizationDetailQueryKey(projectId, optimizationId) });
    },
  });
}

export function useDeleteOptimization(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (optimizationId: string) => optimizationClient.deleteOptimization(projectId, optimizationId),
    onSuccess: (_data, optimizationId) => {
      void queryClient.invalidateQueries({ queryKey: optimizationsQueryRoot(projectId) });
      void queryClient.removeQueries({ queryKey: getOptimizationDetailQueryKey(projectId, optimizationId) });
    },
  });
}

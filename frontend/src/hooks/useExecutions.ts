import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/client';
import type { PaginatedResponse, ExecutionSummary } from '../types/workflow';
import { useWorkflowStore } from '../store/workflowStore';

export function useExecutionList(workflowId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['executions', workflowId],
    queryFn: () => api.listExecutions(workflowId!, 20),
    select: (data) => data.data,
    enabled: !!workflowId && enabled,
    staleTime: 0,
    refetchInterval: (query) => {
      // query.state.data is the raw PaginatedResponse (pre-select); .data is the ExecutionSummary[]
      const raw = query.state.data as PaginatedResponse<ExecutionSummary> | undefined;
      const data = raw?.data ?? [];
      const hasActive = data.some(
        (e) => e.status === 'pending' || e.status === 'running'
      );
      return hasActive ? 2000 : false;
    },
  });
}

export function useExecution(id: string | null) {
  return useQuery({
    queryKey: ['executions', 'detail', id],
    queryFn: () => api.getExecution(id!),
    enabled: !!id,
    staleTime: 0,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      // Poll fast while active so canvas updates feel real-time
      return s === 'pending' || s === 'running' ? 500 : false;
    },
  });
}

/**
 * Powers the Execution Log panel.
 * Fetches the `limit` most-recent executions and returns the raw
 * PaginatedResponse so the panel can render a "Load more" button.
 * Polls every 2 s while any execution is still running.
 */
export function useExecutionLog(workflowId: string | null, limit: number) {
  return useQuery({
    queryKey: ['executions', 'log', workflowId, limit],
    queryFn: () => api.listExecutions(workflowId!, limit),
    enabled: !!workflowId,
    staleTime: 0,
    refetchInterval: (query) => {
      const data = (query.state.data as PaginatedResponse<ExecutionSummary> | undefined)?.data ?? [];
      const hasActive = data.some(
        (e) => e.status === 'pending' || e.status === 'running'
      );
      return hasActive ? 2000 : false;
    },
  });
}

export function useDeleteExecution(workflowId: string | null) {
  const qc = useQueryClient();
  const { lastExecutionId, setLastExecutionId, clearExecutionStatuses, setIsExecuting } =
    useWorkflowStore.getState();

  return useMutation({
    mutationFn: (id: string) => api.deleteExecution(id),
    onSuccess: (_data, id) => {
      if (id === lastExecutionId) {
        clearExecutionStatuses();
        setIsExecuting(false);
        setLastExecutionId(null);
      }
      qc.invalidateQueries({ queryKey: ['executions', 'log', workflowId] });
      qc.removeQueries({ queryKey: ['executions', 'detail', id] });
    },
  });
}

export function useDeleteExecutions(workflowId: string | null) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (params: { ids?: string[]; workflowId?: string; deleteAll?: boolean }) =>
      api.deleteExecutions(params),
    onSuccess: (_data, params) => {
      const { lastExecutionId, setLastExecutionId, clearExecutionStatuses, setIsExecuting } =
        useWorkflowStore.getState();

      // If we deleted the currently-viewed execution, clear the canvas overlay
      const deletedIds = new Set(params.ids ?? []);
      const clearedAll = params.deleteAll === true;
      if (clearedAll || (lastExecutionId && deletedIds.has(lastExecutionId))) {
        clearExecutionStatuses();
        setIsExecuting(false);
        setLastExecutionId(null);
      }

      qc.invalidateQueries({ queryKey: ['executions', 'log', workflowId] });
      if (params.ids) {
        for (const id of params.ids) {
          qc.removeQueries({ queryKey: ['executions', 'detail', id] });
        }
      }
    },
  });
}

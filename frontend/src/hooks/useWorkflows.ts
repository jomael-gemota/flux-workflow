import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import * as api from '../api/client';
import type { WorkflowDefinition, PaginatedResponse } from '../types/workflow';

export function useWorkflowList() {
  return useQuery({
    queryKey: ['workflows'],
    queryFn: () => api.listWorkflows(100),
    select: (data) => data.data,
  });
}

export function useWorkflow(id: string | null) {
  return useQuery({
    queryKey: ['workflows', id],
    queryFn: () => api.getWorkflow(id!),
    enabled: !!id,
  });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Omit<WorkflowDefinition, 'version' | 'id'> & { id?: string }) =>
      api.createWorkflow(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  });
}

export function useUpdateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Partial<Pick<WorkflowDefinition, 'name' | 'nodes' | 'entryNodeId' | 'entryNodeIds' | 'schedule' | 'viewport' | 'stickyNotes'>>;
    }) => api.updateWorkflow(id, body),
    onSuccess: (data, vars) => {
      if (data) {
        // Immediately write the fresh server response into both caches so that
        // navigating back to this workflow always loads the saved state. Without
        // this, the sidebar would still hold stale data until the background
        // refetch (triggered by invalidateQueries below) completes — creating a
        // race condition where quickly switching back shows the pre-save layout.
        qc.setQueryData<WorkflowDefinition>(['workflows', vars.id], data);
        qc.setQueryData<PaginatedResponse<WorkflowDefinition>>(
          ['workflows'],
          (old) => {
            if (!old) return old;
            return {
              ...old,
              data: old.data.map((wf) => (wf.id === vars.id ? data : wf)),
            };
          }
        );
      }
      // Still invalidate so any peer clients or stale subscribers get fresh data.
      qc.invalidateQueries({ queryKey: ['workflows'] });
      qc.invalidateQueries({ queryKey: ['workflows', vars.id] });
    },
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteWorkflow(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  });
}

export function useVersionHistory(workflowId: string | null) {
  return useQuery({
    queryKey: ['workflow-versions', workflowId],
    queryFn: () => api.getVersionHistory(workflowId!),
    enabled: !!workflowId,
    select: (data) => data.versions,
  });
}

export function useRestoreVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ workflowId, version }: { workflowId: string; version: number }) =>
      api.restoreVersion(workflowId, version),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
      qc.invalidateQueries({ queryKey: ['workflows', vars.workflowId] });
      qc.invalidateQueries({ queryKey: ['workflow-versions', vars.workflowId] });
    },
  });
}

export function useTriggerWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      workflowId,
      input,
    }: {
      workflowId: string;
      input?: Record<string, unknown>;
    }) => api.triggerWorkflow(workflowId, input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['executions', vars.workflowId] });
    },
  });
}

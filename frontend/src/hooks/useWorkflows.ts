import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import * as api from '../api/client';
import type { WorkflowDefinition } from '../types/workflow';

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
    onSuccess: (_data, vars) => {
      // Invalidate both the specific workflow cache AND the list so the sidebar refreshes
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

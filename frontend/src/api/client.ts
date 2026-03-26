import type {
  WorkflowDefinition,
  ExecutionSummary,
  PaginatedResponse,
  NodeTestResult,
} from '../types/workflow';

const BASE = '/api';

function getApiKey(): string {
  return localStorage.getItem('wap_api_key') ?? '';
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKey(),
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string }).message ?? `HTTP ${res.status}`
    );
  }

  return res.json() as Promise<T>;
}

// ── Workflows ────────────────────────────────────────────────

export function listWorkflows(limit = 50, cursor?: string) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return request<PaginatedResponse<WorkflowDefinition>>(
    `/workflows?${params}`
  );
}

export function getWorkflow(id: string) {
  return request<WorkflowDefinition>(`/workflows/${id}`);
}

export function createWorkflow(
  body: Omit<WorkflowDefinition, 'version' | 'id'> & { id?: string }
) {
  return request<WorkflowDefinition & { webhookSecret: string }>('/workflows', {
    method: 'POST',
    body: JSON.stringify({ ...body, version: 1 }),
  });
}

export function updateWorkflow(
  id: string,
  body: Partial<Pick<WorkflowDefinition, 'name' | 'nodes' | 'entryNodeId' | 'entryNodeIds' | 'schedule'>>
) {
  return request<WorkflowDefinition>(`/workflows/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function deleteWorkflow(id: string) {
  return request<{ deleted: boolean; id: string }>(`/workflows/${id}`, {
    method: 'DELETE',
  });
}

export function triggerWorkflow(
  workflowId: string,
  input: Record<string, unknown> = {}
) {
  return request<ExecutionSummary>('/workflows/trigger', {
    method: 'POST',
    body: JSON.stringify({ workflowId, input }),
  });
}

// ── Node testing ─────────────────────────────────────────────

export function testNode(
  workflowId: string,
  nodeId: string,
  context?: Record<string, unknown>
) {
  return request<NodeTestResult>(
    `/workflows/${workflowId}/nodes/${nodeId}/test`,
    { method: 'POST', body: JSON.stringify({ context }) }
  );
}

export function getNodeTestResults(workflowId: string) {
  return request<Record<string, NodeTestResult>>(
    `/workflows/${workflowId}/node-test-results`
  );
}

// ── Executions ───────────────────────────────────────────────

export function listExecutions(workflowId: string, limit = 20, cursor?: string) {
  const params = new URLSearchParams({ workflowId, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return request<PaginatedResponse<ExecutionSummary>>(`/executions?${params}`);
}

export function getExecution(id: string) {
  return request<ExecutionSummary>(`/executions/${id}`);
}

export function deleteExecution(id: string) {
  return request<{ deleted: boolean; id: string }>(`/executions/${id}`, {
    method: 'DELETE',
  });
}

export function deleteExecutions(params: {
  ids?: string[];
  workflowId?: string;
  deleteAll?: boolean;
}) {
  return request<{ deleted: number }>('/executions', {
    method: 'DELETE',
    body: JSON.stringify(params),
  });
}

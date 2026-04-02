import type {
  WorkflowDefinition,
  ExecutionSummary,
  PaginatedResponse,
  NodeTestResult,
  CredentialSummary,
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
      // Only set Content-Type when there is a body — sending it on bodyless
      // requests (DELETE, GET) causes Fastify to reject with 400.
      ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
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
  body: Partial<Pick<WorkflowDefinition, 'name' | 'nodes' | 'entryNodeId' | 'entryNodeIds' | 'schedule' | 'viewport'>>
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

// ── Credentials ──────────────────────────────────────────────

export function listCredentials() {
  return request<CredentialSummary[]>('/credentials');
}

export function deleteCredential(id: string) {
  return request<{ deleted: boolean; id: string }>(`/credentials/${id}`, {
    method: 'DELETE',
  });
}

/** Redirects the browser to Google's OAuth consent page */
export function startGoogleOAuth() {
  window.location.href = `${BASE}/oauth/google/authorize`;
}

/** Check whether Google OAuth is configured on the backend */
export function checkGoogleConfig() {
  return request<{ configured: boolean; redirectUri: string }>('/oauth/google/status');
}

/** Redirects the browser to Slack's OAuth consent page */
export function startSlackOAuth() {
  window.location.href = `${BASE}/oauth/slack/authorize`;
}

/** Check whether Slack OAuth is configured on the backend */
export function checkSlackConfig() {
  return request<{ configured: boolean; redirectUri: string }>('/oauth/slack/status');
}

/** Redirects the browser to Microsoft's OAuth consent page */
export function startTeamsOAuth() {
  window.location.href = `${BASE}/oauth/teams/authorize`;
}

/** Check whether Teams OAuth is configured on the backend */
export function checkTeamsConfig() {
  return request<{ configured: boolean; redirectUri: string }>('/oauth/teams/status');
}

// ── Slack workspace data ──────────────────────────────────────

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

export interface SlackUser {
  id: string;
  name: string;
  realName: string;
  displayName: string;
}

export interface SlackChannelsResponse {
  channels: SlackChannel[];
  missingScopes: string[];
}

export function listSlackChannels(credentialId: string) {
  return request<SlackChannelsResponse>(`/slack/channels?credentialId=${encodeURIComponent(credentialId)}`);
}

export function listSlackUsers(credentialId: string) {
  return request<SlackUser[]>(`/slack/users?credentialId=${encodeURIComponent(credentialId)}`);
}

// ── Microsoft Teams data ──────────────────────────────────────

export interface TeamsTeam {
  id: string;
  displayName: string;
  description: string | null;
}

export interface TeamsChannel {
  id: string;
  displayName: string;
  membershipType: string;
}

export interface TeamsUser {
  id: string;
  displayName: string;
  mail: string;
  userPrincipalName: string;
}

export interface TeamsTeamsResponse {
  teams: TeamsTeam[];
}

export interface TeamsChannelsResponse {
  channels: TeamsChannel[];
}

export function listTeamsTeams(credentialId: string) {
  return request<TeamsTeamsResponse>(`/teams/teams?credentialId=${encodeURIComponent(credentialId)}`);
}

export function listTeamsChannels(credentialId: string, teamId: string) {
  return request<TeamsChannelsResponse>(
    `/teams/channels?credentialId=${encodeURIComponent(credentialId)}&teamId=${encodeURIComponent(teamId)}`
  );
}

export function listTeamsUsers(credentialId: string) {
  return request<TeamsUser[]>(`/teams/users?credentialId=${encodeURIComponent(credentialId)}`);
}

// ── Basecamp data ──────────────────────────────────────

export function startBasecampOAuth() {
  window.location.href = `${BASE}/oauth/basecamp/authorize`;
}

export function checkBasecampConfig() {
  return request<{ configured: boolean; redirectUri: string }>('/oauth/basecamp/status');
}

export interface BasecampProject {
  id: number;
  name: string;
  description: string;
}

export interface BasecampTodolist {
  id: number;
  name: string;
  todosRemaining: number;
}

export interface BasecampTodo {
  id: number;
  title: string;
  completed: boolean;
  dueOn: string | null;
  groupId: number | null;
  groupName: string | null;
}

export interface BasecampTodoGroup {
  id: number;
  name: string;
}

export interface BasecampPerson {
  id: number;
  name: string;
  email: string;
  company: string | null;
}

export function listBasecampProjects(credentialId: string) {
  return request<BasecampProject[]>(`/basecamp/projects?credentialId=${encodeURIComponent(credentialId)}`);
}

export function listBasecampTodolists(credentialId: string, projectId: string) {
  return request<BasecampTodolist[]>(
    `/basecamp/todolists?credentialId=${encodeURIComponent(credentialId)}&projectId=${encodeURIComponent(projectId)}`
  );
}

export function listBasecampTodos(credentialId: string, todolistId: string, status: 'active' | 'completed' | 'all' = 'active') {
  return request<BasecampTodo[]>(
    `/basecamp/todos?credentialId=${encodeURIComponent(credentialId)}&todolistId=${encodeURIComponent(todolistId)}&status=${status}`
  );
}

export function listBasecampTodoGroups(credentialId: string, todolistId: string) {
  return request<BasecampTodoGroup[]>(
    `/basecamp/todogroups?credentialId=${encodeURIComponent(credentialId)}&todolistId=${encodeURIComponent(todolistId)}`
  );
}

export function listBasecampPeople(credentialId: string, projectId?: string) {
  let url = `/basecamp/people?credentialId=${encodeURIComponent(credentialId)}`;
  if (projectId) url += `&projectId=${encodeURIComponent(projectId)}`;
  return request<BasecampPerson[]>(url);
}

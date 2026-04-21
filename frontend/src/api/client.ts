import type {
  WorkflowDefinition,
  ExecutionSummary,
  PaginatedResponse,
  NodeTestResult,
  CredentialSummary,
} from '../types/workflow';

const BASE = '/api';

function getAuthHeader(): Record<string, string> {
  // JWT auth (new Google sign-in flow)
  const jwt = localStorage.getItem('flux_auth_token');
  if (jwt) return { Authorization: `Bearer ${jwt}` };
  // Legacy API-key fallback (programmatic access)
  const key = localStorage.getItem('wap_api_key');
  if (key) return { 'x-api-key': key };
  return {};
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
      ...getAuthHeader(),
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

// ── Projects ─────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  workflowIds: string[];
}

export function listProjects() {
  return request<Project[]>('/projects');
}

export function createProject(body: { name: string; workflowIds?: string[]; id?: string }) {
  return request<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function updateProject(id: string, body: { name?: string; workflowIds?: string[] }) {
  return request<Project>(`/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function deleteProject(id: string) {
  return request<{ deleted: boolean; id: string }>(`/projects/${id}`, {
    method: 'DELETE',
  });
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
  body: Partial<Pick<WorkflowDefinition, 'name' | 'nodes' | 'entryNodeId' | 'entryNodeIds' | 'schedule' | 'viewport' | 'stickyNotes'>>
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

export type VersionEntry = WorkflowDefinition & { archivedAt?: string };

export function getVersionHistory(workflowId: string) {
  return request<{ workflowId: string; versions: VersionEntry[] }>(
    `/workflows/${workflowId}/versions`
  );
}

export function restoreVersion(workflowId: string, version: number) {
  return request<WorkflowDefinition>(`/workflows/${workflowId}/restore`, {
    method: 'POST',
    body: JSON.stringify({ version }),
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

/** Execute a single node as a permanent, append-only run stored in the execution log. */
export function runNode(workflowId: string, nodeId: string) {
  return request<ExecutionSummary>(
    `/workflows/${workflowId}/nodes/${nodeId}/run`,
    { method: 'POST', body: JSON.stringify({}) }
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

/** Redirects the browser to Google's OAuth consent page, carrying the platform userId so the
 *  callback can scope the new credential to this user. */
export function startGoogleOAuth(userId?: string) {
  const qs = userId ? `?uid=${encodeURIComponent(userId)}` : '';
  window.location.href = `${BASE}/oauth/google/authorize${qs}`;
}

/** Check whether Google OAuth is configured on the backend */
export function checkGoogleConfig() {
  return request<{ configured: boolean; redirectUri: string }>('/oauth/google/status');
}

/** Redirects the browser to Slack's OAuth consent page, carrying the platform userId. */
export function startSlackOAuth(userId?: string) {
  const qs = userId ? `?uid=${encodeURIComponent(userId)}` : '';
  window.location.href = `${BASE}/oauth/slack/authorize${qs}`;
}

/** Check whether Slack OAuth is configured on the backend */
export function checkSlackConfig() {
  return request<{ configured: boolean; redirectUri: string }>('/oauth/slack/status');
}

/** Redirects the browser to Microsoft's OAuth consent page, carrying the platform userId. */
export function startTeamsOAuth(userId?: string) {
  const qs = userId ? `?uid=${encodeURIComponent(userId)}` : '';
  window.location.href = `${BASE}/oauth/teams/authorize${qs}`;
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

// ── Google Drive data ─────────────────────────────────────────

export interface GDriveItem {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string;
  size?: string;
}

export function listGDriveItems(credentialId: string, folderId?: string, type?: string) {
  const params = new URLSearchParams({ credentialId });
  if (folderId) params.set('folderId', folderId);
  if (type)     params.set('type', type);
  return request<{ items: GDriveItem[] }>(`/gdrive/items?${params}`);
}

export function getGDriveFile(credentialId: string, fileId: string) {
  return request<GDriveItem>(
    `/gdrive/file?credentialId=${encodeURIComponent(credentialId)}&fileId=${encodeURIComponent(fileId)}`
  );
}

// ── Google Sheets data ────────────────────────────────────────

export interface GSheetsSpreadsheet {
  id: string;
  name: string;
  modifiedTime: string | null;
}

export interface GSheetsSheet {
  id: number;
  title: string;
  index: number;
}

export function listGSheetsSpreadsheets(credentialId: string) {
  return request<{ spreadsheets: GSheetsSpreadsheet[] }>(
    `/gsheets/spreadsheets?credentialId=${encodeURIComponent(credentialId)}`
  );
}

export function listGSheetsSheets(credentialId: string, spreadsheetId: string) {
  return request<{ sheets: GSheetsSheet[] }>(
    `/gsheets/sheets?credentialId=${encodeURIComponent(credentialId)}&spreadsheetId=${encodeURIComponent(spreadsheetId)}`
  );
}

// ── Gmail data ────────────────────────────────────────────────

export interface GmailLabel {
  id:   string;
  name: string;
  type: 'system' | 'user';
}

export function listGmailLabels(credentialId: string) {
  return request<GmailLabel[]>(`/gmail/labels?credentialId=${encodeURIComponent(credentialId)}`);
}

export function listGmailMessageLabels(credentialId: string, messageId: string) {
  return request<GmailLabel[]>(
    `/gmail/message/labels?credentialId=${encodeURIComponent(credentialId)}&messageId=${encodeURIComponent(messageId)}`
  );
}

// ── Slack data ────────────────────────────────────────────────

export function listSlackChannels(credentialId: string) {
  return request<SlackChannelsResponse>(`/slack/channels?credentialId=${encodeURIComponent(credentialId)}`);
}

export function listSlackUsers(credentialId: string) {
  return request<SlackUser[]>(`/slack/users?credentialId=${encodeURIComponent(credentialId)}`);
}

// ── File staging ──────────────────────────────────────────────
// Pre-upload a file so its bytes never live in the workflow config JSON.
// The returned stagedFileId is stored in the node config instead.

export interface StagedFile {
  stagedFileId: string;
  filename:     string;
  mimeType:     string;
  size:         number;
  expiresAt:    string;
}

export function stageFile(body: { filename: string; mimeType: string; data: string }) {
  return request<StagedFile>('/files/stage', {
    method: 'POST',
    body:   JSON.stringify(body),
  });
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

export function startBasecampOAuth(userId?: string) {
  const qs = userId ? `?uid=${encodeURIComponent(userId)}` : '';
  window.location.href = `${BASE}/oauth/basecamp/authorize${qs}`;
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

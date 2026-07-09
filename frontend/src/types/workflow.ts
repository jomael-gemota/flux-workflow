export type NodeType =
  | 'trigger'
  | 'llm'
  | 'http'
  | 'condition'
  | 'switch'
  | 'transform'
  | 'extract'
  | 'output'
  | 'code'
  | 'loop'
  | 'gmail'
  | 'gdrive'
  | 'gdocs'
  | 'gsheets'
  | 'slack'
  | 'teams'
  | 'basecamp'
  | 'formatter';

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  config: Record<string, unknown>;
  next: string[];
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  /** When true the node is bypassed during execution */
  disabled?: boolean;
  /** Canvas position saved by the visual builder */
  position?: { x: number; y: number };
}

export interface PersistedStickyNote {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  content: string;
  color: string;
}

/**
 * A plain (non-secret) workflow-scoped variable, referenceable in node config
 * via `{{vars.<key>}}`. Each workflow has its own isolated set.
 */
export interface WorkflowVariable {
  key: string;
  value: string;
  description?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  nodes: WorkflowNode[];
  entryNodeId: string;
  entryNodeIds?: string[];
  schedule?: string;
  /** Canvas pan/zoom saved with the workflow so the view is restored on load */
  viewport?: { x: number; y: number; zoom: number };
  /** Sticky note annotations saved with the canvas */
  stickyNotes?: PersistedStickyNote[];
  /** Per-workflow plain variables, referenceable as `{{vars.<key>}}` in node config */
  variables?: WorkflowVariable[];
}

export interface NodeResult {
  nodeId: string;
  status: 'success' | 'failure' | 'skipped';
  output: unknown;
  /** Node config with all {{}} expressions resolved at execution time */
  resolvedInput?: unknown;
  error?: string;
  durationMs: number;
}

export interface ExecutionSummary {
  executionId: string;
  workflowId: string;
  workflowVersion?: number;
  status: 'pending' | 'running' | 'success' | 'failure' | 'partial';
  startedAt: string;
  completedAt: string;
  results: NodeResult[];
  triggeredBy?: string;
  testNodeId?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
    limit: number;
  };
}

export interface CredentialSummary {
  id: string;
  provider: 'google' | 'slack' | 'teams' | 'basecamp';
  label: string;
  email: string;
  scopes: string[];
  createdAt: string;
  /** Credential health — `reauth_required` means the user must reconnect the account. */
  status?: 'active' | 'reauth_required';
  /**
   * For Basecamp credentials only: lightweight description of the synced
   * web-session payload, when present. The cookie values themselves stay
   * server-side; only metadata is exposed to the frontend.
   */
  basecampWebSession?: {
    identity:    string;
    expiresAt:   number;
    syncedAt:    number;
    cookieCount: number;
  };
}

export interface NodeTestResult {
  nodeId: string;
  status: 'success' | 'failure';
  output: unknown;
  error?: string;
  durationMs: number;
  ranAt: string;
}

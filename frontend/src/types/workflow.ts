export type NodeType =
  | 'trigger'
  | 'llm'
  | 'http'
  | 'condition'
  | 'switch'
  | 'transform'
  | 'output'
  | 'gmail'
  | 'gdrive'
  | 'gdocs'
  | 'gsheets';

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

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  nodes: WorkflowNode[];
  entryNodeId: string;
  entryNodeIds?: string[];
  schedule?: string;
}

export interface NodeResult {
  nodeId: string;
  status: 'success' | 'failure' | 'skipped';
  output: unknown;
  error?: string;
  durationMs: number;
}

export interface ExecutionSummary {
  executionId: string;
  workflowId: string;
  status: 'pending' | 'running' | 'success' | 'failure' | 'partial';
  startedAt: string;
  completedAt: string;
  results: NodeResult[];
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
  provider: 'google';
  label: string;
  email: string;
  scopes: string[];
  createdAt: string;
}

export interface NodeTestResult {
  nodeId: string;
  status: 'success' | 'failure';
  output: unknown;
  error?: string;
  durationMs: number;
  ranAt: string;
}

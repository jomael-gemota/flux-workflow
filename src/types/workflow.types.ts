export type NodeType =
    | 'trigger'
    | 'llm'
    | 'http'
    | 'condition'
    | 'switch'
    | 'transform'
    | 'extract'
    | 'output'
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

export interface WorkflowDefinition {
    id: string;
    name: string;
    version: number;
    nodes: WorkflowNode[];
    entryNodeId: string;       // Primary / first entry node (kept for backward compat)
    entryNodeIds?: string[];   // All parallel entry nodes; overrides entryNodeId when present
    schedule?: string;
    /** Canvas pan/zoom saved with the workflow so the view is restored on load */
    viewport?: { x: number; y: number; zoom: number };
    /** Canvas sticky-note annotations — stored inside definition, not workflow logic */
    stickyNotes?: PersistedStickyNote[];
}

export interface ExecutionContext {
    workflowId: string;
    executionId: string;
    variables: Record<string, unknown>;
    startedAt: Date;
}

export interface NodeResult {
    nodeId: string;
    status: 'success' | 'failure' | 'skipped';
    output: unknown;
    error?: string;
    durationMs: number;
}

export interface WorkflowExecutionResult {
  executionId: string;
  results: NodeResult[];
}
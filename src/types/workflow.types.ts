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
 * A plain (non-secret) workflow-scoped variable. Each workflow has its own set,
 * isolated from every other workflow. Referenced in node config via `vars.<key>`
 * (or `{{vars.<key>}}`). Keys are constrained to identifier syntax so they are
 * always referenceable without escaping.
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
    entryNodeId: string;       // Primary / first entry node (kept for backward compat)
    entryNodeIds?: string[];   // All parallel entry nodes; overrides entryNodeId when present
    schedule?: string;
    /** Canvas pan/zoom saved with the workflow so the view is restored on load */
    viewport?: { x: number; y: number; zoom: number };
    /** Canvas sticky-note annotations — stored inside definition, not workflow logic */
    stickyNotes?: PersistedStickyNote[];
    /** Per-workflow plain variables, referenceable as `vars.<key>` in node config */
    variables?: WorkflowVariable[];
}

export interface ExecutionContext {
    workflowId: string;
    executionId: string;
    variables: Record<string, unknown>;
    /** Per-workflow plain variables, keyed by name. Referenced via `vars.<key>`. */
    vars?: Record<string, string>;
    startedAt: Date;
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

export interface WorkflowExecutionResult {
  executionId: string;
  results: NodeResult[];
}
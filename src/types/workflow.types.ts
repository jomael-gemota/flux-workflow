export type NodeType = 'trigger' | 'llm' | 'http' | 'condition' | 'transform' | 'output';

export interface WorkflowNode {
    id: string;
    type: NodeType;
    name: string;
    config: Record<string, unknown>;
    next: string[];
}

export interface WorkflowDefinition {
    id: string;
    name: string;
    version: number;
    nodes: WorkflowNode[];
    entryNodeId: string;
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
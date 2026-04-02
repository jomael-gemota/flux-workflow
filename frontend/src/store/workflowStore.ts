import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import type { WorkflowDefinition } from '../types/workflow';

export interface CanvasNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  config: Record<string, unknown>;
  isEntry: boolean;
  isParallelEntry?: boolean;
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  disabled?: boolean;
}

export type CanvasNode = Node<CanvasNodeData>;
export type CanvasEdge = Edge;

export type NodeExecutionStatus =
  | 'waiting'   // click-triggered pre-activation: dims everything before execution starts
  | 'pending'   // execution is running but this node hasn't started yet
  | 'running'   // this node is currently executing
  | 'success'
  | 'failure'
  | 'skipped';

interface WorkflowStore {
  // Theme
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;

  // Active workflow
  activeWorkflow: WorkflowDefinition | null;
  setActiveWorkflow: (wf: WorkflowDefinition | null) => void;

  // React Flow state
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  setNodes: (nodes: CanvasNode[]) => void;
  setEdges: (edges: CanvasEdge[]) => void;

  // Selection
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;

  // Dirty tracking
  isDirty: boolean;
  setDirty: (dirty: boolean) => void;

  // Current canvas viewport (pan + zoom) — updated on every move, saved on demand
  canvasViewport: { x: number; y: number; zoom: number } | null;
  setCanvasViewport: (vp: { x: number; y: number; zoom: number }) => void;

  // Panel visibility
  logOpen: boolean;
  setLogOpen: (open: boolean) => void;
  configOpen: boolean;
  setConfigOpen: (open: boolean) => void;

  // Last triggered execution
  lastExecutionId: string | null;
  setLastExecutionId: (id: string | null) => void;

  // Live execution overlay
  executionStatuses: Record<string, NodeExecutionStatus>;
  setExecutionStatuses: (s: Record<string, NodeExecutionStatus>) => void;
  clearExecutionStatuses: () => void;
  /** Single atomic update: sets statuses + isExecuting=true in one set() to avoid grey flash */
  beginExecution: (statuses: Record<string, NodeExecutionStatus>) => void;
  isExecuting: boolean;
  setIsExecuting: (v: boolean) => void;
}

export const useWorkflowStore = create<WorkflowStore>((set) => ({
  theme: (() => {
    try { return (localStorage.getItem('wap_theme') as 'dark' | 'light') ?? 'dark'; } catch { return 'dark'; }
  })(),
  setTheme: (theme) => {
    try { localStorage.setItem('wap_theme', theme); } catch { /* ignore */ }
    set({ theme });
  },

  activeWorkflow: null,
  setActiveWorkflow: (wf) => set({ activeWorkflow: wf }),

  nodes: [],
  edges: [],
  setNodes: (nodes) => set({ nodes, isDirty: true }),
  setEdges: (edges) => set({ edges, isDirty: true }),

  selectedNodeId: null,
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),

  isDirty: false,
  setDirty: (dirty) => set({ isDirty: dirty }),

  canvasViewport: null,
  setCanvasViewport: (vp) => set({ canvasViewport: vp }),

  logOpen: true,
  setLogOpen: (open) => set({ logOpen: open }),

  configOpen: (() => {
    try { return localStorage.getItem('wap_panel_config_open') !== 'false'; } catch { return true; }
  })(),
  setConfigOpen: (open) => {
    try { localStorage.setItem('wap_panel_config_open', String(open)); } catch { /* ignore */ }
    set({ configOpen: open });
  },

  lastExecutionId: null,
  setLastExecutionId: (id) => set({ lastExecutionId: id }),

  executionStatuses: {},
  setExecutionStatuses: (s) => set({ executionStatuses: s }),
  clearExecutionStatuses: () => set({ executionStatuses: {}, isExecuting: false }),
  beginExecution: (statuses) => set({ executionStatuses: statuses, isExecuting: true }),
  isExecuting: false,
  setIsExecuting: (v) => set({ isExecuting: v }),
}));

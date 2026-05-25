import { useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Loader2,
} from 'lucide-react';
import { useExecution } from '../../hooks/useExecutions';
import { useWorkflow } from '../../hooks/useWorkflows';
import { useExecutionStream } from '../../hooks/useExecutionStream';
import { useWorkflowStore, type NodeExecutionStatus, type CanvasNode, type CanvasEdge } from '../../store/workflowStore';
import { deserialize } from '../canvas/canvasUtils';
import { resolveEdgeStatus, nodeTypes, edgeTypes } from '../canvas/WorkflowCanvas';
import { ReplayNodeConfigPanel } from '../panels/ReplayNodeConfigPanel';
import * as api from '../../api/client';
import type { NodeResult } from '../../types/workflow';

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function formatDurationMs(startedAt: string, completedAt: string): string {
  try {
    const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  } catch {
    return '';
  }
}

type ExecStatus = 'pending' | 'running' | 'success' | 'failure' | 'partial';

function StatusChip({ status }: { status: ExecStatus }) {
  const map: Record<ExecStatus, { icon: React.ReactNode; label: string; cls: string }> = {
    success: {
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      label: 'Success',
      cls: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-700/50',
    },
    failure: {
      icon: <XCircle className="w-3.5 h-3.5" />,
      label: 'Failed',
      cls: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700/50',
    },
    partial: {
      icon: <AlertTriangle className="w-3.5 h-3.5" />,
      label: 'Partial',
      cls: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700/50',
    },
    running: {
      icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
      label: 'Running',
      cls: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700/50',
    },
    pending: {
      icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />,
      label: 'Pending',
      cls: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700/50 dark:text-slate-400 dark:border-slate-600/50',
    },
  };
  const { icon, label, cls } = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cls}`}>
      {icon}{label}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ExecutionReplayPage() {
  const { executionId } = useParams<{ executionId: string }>();
  const navigate = useNavigate();

  const { data: execution, isLoading: execLoading } = useExecution(executionId ?? null);
  const { data: workflow, isLoading: wfLoading } = useWorkflow(execution?.workflowId ?? null);

  // SSE for live updates while the execution is running
  useExecutionStream(
    execution?.status === 'pending' || execution?.status === 'running' ? (executionId ?? null) : null,
    execution?.workflowId ?? null,
  );

  const theme = useWorkflowStore((s) => s.theme);
  const setExecutionStatuses = useWorkflowStore((s) => s.setExecutionStatuses);
  const clearExecutionStatuses = useWorkflowStore((s) => s.clearExecutionStatuses);
  const setIsInteractive = useWorkflowStore((s) => s.setIsInteractive);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isReplaying, setIsReplaying] = useState(false);

  const isActive = execution?.status === 'pending' || execution?.status === 'running';

  // Build execution statuses map from results
  const nodeStatuses = useMemo<Record<string, NodeExecutionStatus>>(() => {
    if (!execution) return {};
    const map: Record<string, NodeExecutionStatus> = {};
    for (const r of execution.results as NodeResult[]) {
      map[r.nodeId] = r.status as NodeExecutionStatus;
    }
    return map;
  }, [execution]);

  // Sync statuses to Zustand store so BaseNode renders them correctly
  useEffect(() => {
    if (Object.keys(nodeStatuses).length > 0) {
      setExecutionStatuses(nodeStatuses);
    }
  }, [nodeStatuses, setExecutionStatuses]);

  // Disable interactivity so node toolbars don't appear
  useEffect(() => {
    setIsInteractive(false);
    return () => {
      clearExecutionStatuses();
      setIsInteractive(true);
    };
  }, [setIsInteractive, clearExecutionStatuses]);

  // Build canvas nodes/edges from workflow definition
  const { nodes: rawNodes, edges: rawEdges } = useMemo(() => {
    if (!workflow) return { nodes: [], edges: [] };
    return deserialize(workflow);
  }, [workflow]);

  // Apply edge statuses derived from node statuses
  const edges = useMemo<CanvasEdge[]>(() => {
    return rawEdges.map((edge) => ({
      ...edge,
      type: 'execution',
      data: {
        ...((edge.data as Record<string, unknown>) ?? {}),
        label: edge.label,
        executionStatus: resolveEdgeStatus(
          nodeStatuses[edge.source],
          nodeStatuses[edge.target],
          isActive,
        ),
      },
    }));
  }, [rawEdges, nodeStatuses, isActive]);

  // Make nodes non-selectable-for-editing but still clickable for config view
  const nodes = useMemo<CanvasNode[]>(() => {
    return rawNodes.map((n) => ({ ...n, draggable: false }));
  }, [rawNodes]);

  // Build result map for quick lookup
  const resultByNodeId = useMemo<Record<string, NodeResult>>(() => {
    const map: Record<string, NodeResult> = {};
    for (const r of (execution?.results ?? []) as NodeResult[]) {
      map[r.nodeId] = r;
    }
    return map;
  }, [execution]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedResult = selectedNodeId ? resultByNodeId[selectedNodeId] : undefined;

  const handleNodeClick = useCallback((_: React.MouseEvent, node: CanvasNode) => {
    if (node.type === 'stickyNote') return;
    setSelectedNodeId(node.id);
  }, []);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    // Accept only selection changes so React Flow internal selection tracking works;
    // block position/dimension changes because canvas is read-only.
    const allowed = changes.filter((c) => c.type === 'select' || c.type === 'dimensions');
    if (allowed.length === 0) return;
  }, []);

  async function handleReplay() {
    if (!executionId || isReplaying || isActive) return;
    setIsReplaying(true);
    try {
      const newExec = await api.replayExecution(executionId);
      navigate(`/executions/${newExec.executionId}/replay`);
    } catch (err) {
      console.error('Replay failed:', err);
    } finally {
      setIsReplaying(false);
    }
  }

  const isDark = theme === 'dark';

  // ── Loading state ──────────────────────────────────────────────────────────
  if (execLoading || wfLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#E9EEF6] dark:bg-[#171717]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading execution replay…</p>
        </div>
      </div>
    );
  }

  if (!execution) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#E9EEF6] dark:bg-[#171717]">
        <div className="flex flex-col items-center gap-3 text-center px-8">
          <XCircle className="w-10 h-10 text-red-400" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Execution not found</p>
          <p className="text-xs text-slate-400">The execution ID may be invalid or the record was deleted.</p>
          <button
            onClick={() => navigate('/')}
            className="mt-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
          >
            Go to Canvas
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#E9EEF6] dark:bg-[#171717] overflow-hidden">

      {/* ── Top banner ────────────────────────────────────────────────────────── */}
      <header className="shrink-0 flex items-center gap-3 px-4 h-14 bg-white dark:bg-[#1e1e2e] border-b border-slate-200 dark:border-slate-700/80 shadow-sm z-10">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="font-medium">Canvas</span>
        </button>

        <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />

        <div className="flex-1 min-w-0 flex items-center gap-3">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
            {workflow?.name ?? 'Workflow'}
          </p>
          <StatusChip status={execution.status as ExecStatus} />
        </div>

        {/* Metadata */}
        <div className="hidden sm:flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500 mr-2">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {formatTimestamp(execution.startedAt)}
          </span>
          {execution.completedAt && execution.status !== 'pending' && execution.status !== 'running' && (
            <span>
              {formatDurationMs(execution.startedAt, execution.completedAt)}
            </span>
          )}
          {execution.triggeredBy && (
            <span className="capitalize">{execution.triggeredBy}</span>
          )}
        </div>

        {/* Replay button */}
        <button
          onClick={handleReplay}
          disabled={isReplaying || isActive}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
        >
          {isReplaying ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          {isReplaying ? 'Replaying…' : 'Replay'}
        </button>
      </header>

      {/* ── Body ──────────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0">

        {/* Canvas */}
        <div className="flex-1 min-w-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeClick={handleNodeClick}
            onNodesChange={handleNodesChange}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesReconnectable={false}
            deleteKeyCode={null}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            colorMode={isDark ? 'dark' : 'light'}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1.2}
              color={isDark ? '#334155' : '#94a3b8'}
              style={{ opacity: 0.5 }}
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {/* Right config panel */}
        {selectedNode && (
          <div className="w-80 shrink-0 border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1e1e2e]">
            <ReplayNodeConfigPanel
              node={selectedNode}
              result={selectedResult}
              onClose={() => setSelectedNodeId(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

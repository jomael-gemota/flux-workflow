import { useState, useMemo, useEffect } from 'react';
import {
  CheckCircle2, XCircle, Clock, Loader2, X, ChevronLeft,
  AlertCircle, SkipForward, Trash2,
} from 'lucide-react';
import { useWorkflowStore } from '../../store/workflowStore';
import { useExecutionLog, useExecution, useDeleteExecution, useDeleteExecutions } from '../../hooks/useExecutions';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import type { ExecutionSummary, NodeResult } from '../../types/workflow';

const LS_LOG_SIDEBAR_W  = 'wap_log_sidebar_width';
const SIDEBAR_DEFAULT   = 208;   // same as w-52
const SIDEBAR_MIN       = 150;
const SIDEBAR_MAX       = 380;

// ── Pending-delete descriptor ─────────────────────────────────────────────
type PendingDelete =
  | { type: 'single';   id: string }
  | { type: 'selected'; ids: string[] }
  | { type: 'all' };

const PAGE_SIZE = 20;

// ── Status helpers ─────────────────────────────────────────────────────────

function ExecStatusIcon({ status, size = 'sm' }: { status: string; size?: 'sm' | 'xs' }) {
  const cls = size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5';
  if (status === 'success') return <CheckCircle2 className={`${cls} text-emerald-400`} />;
  if (status === 'failure') return <XCircle       className={`${cls} text-red-400`} />;
  if (status === 'partial') return <AlertCircle   className={`${cls} text-amber-400`} />;
  if (status === 'running') return <Loader2       className={`${cls} text-blue-400 animate-spin`} />;
  return                           <Clock         className={`${cls} text-slate-400`} />;
}

function NodeStatusIcon({ status }: { status: string }) {
  if (status === 'success') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  if (status === 'failure') return <XCircle       className="w-3.5 h-3.5 text-red-400 shrink-0" />;
  if (status === 'skipped') return <SkipForward   className="w-3.5 h-3.5 text-slate-500 shrink-0" />;
  return                           <Clock         className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
}

const STATUS_BADGE: Record<string, string> = {
  success: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30',
  failure: 'bg-red-500/20 text-red-300 border border-red-500/30',
  partial: 'bg-amber-500/20 text-amber-300 border border-amber-500/30',
  pending: 'bg-slate-600/40 text-slate-400 border border-slate-600/40',
  running: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',
};

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Output viewer ──────────────────────────────────────────────────────────

function OutputViewer({ result, nodeName }: { result: NodeResult; nodeName: string | undefined }) {
  const isRunnerError = result.nodeId === '__runner__';
  const output = result.output;
  const items: unknown[] = Array.isArray(output) ? output : [output];
  const itemCount = items.filter(i => i !== null && i !== undefined).length;

  return (
    <div className="flex flex-col h-full">
      {/* OUTPUT header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700/60 shrink-0">
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          {isRunnerError ? 'Execution Error' : 'Output'}
        </span>
        {!isRunnerError && (
          <span className="text-[11px] text-slate-500">
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-2">
        {/* Error banner */}
        {result.status === 'failure' && result.error && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2">
            <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-300 break-all">{result.error}</p>
          </div>
        )}

        {/* Skipped notice */}
        {result.status === 'skipped' && (
          <div className="flex items-center gap-2 bg-slate-700/40 border border-slate-600/40 rounded-md px-3 py-2">
            <SkipForward className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <p className="text-xs text-slate-400">
              Node <span className="font-medium text-slate-300">{nodeName ?? result.nodeId}</span> was skipped — it was not on the active branch.
            </p>
          </div>
        )}

        {/* Data items */}
        {result.status !== 'skipped' && items.map((item, idx) => (
          <DataItem key={idx} index={idx} total={itemCount} data={item} />
        ))}
      </div>
    </div>
  );
}

function DataItem({ index, total, data }: { index: number; total: number; data: unknown }) {
  if (data === null || data === undefined) {
    return (
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-md px-3 py-2">
        {total > 1 && (
          <p className="text-[10px] text-slate-600 font-mono mb-1">Item {index + 1}</p>
        )}
        <p className="text-xs text-slate-500 italic">Empty (no data)</p>
      </div>
    );
  }

  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>);
    return (
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-md overflow-hidden">
        {total > 1 && (
          <div className="px-3 py-1.5 border-b border-slate-700/40 bg-slate-800/80">
            <p className="text-[10px] text-slate-500 font-mono">Item {index + 1}</p>
          </div>
        )}
        {entries.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-500 italic">Empty object</p>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {entries.map(([key, val]) => (
                <tr key={key} className="border-b border-slate-700/30 last:border-0">
                  <td className="px-3 py-1.5 text-slate-400 font-mono align-top whitespace-nowrap pr-4 w-1/3">
                    {key}
                  </td>
                  <td className="px-3 py-1.5 text-slate-200 break-all">
                    <DataValue value={val} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-md px-3 py-2">
      {total > 1 && (
        <p className="text-[10px] text-slate-600 font-mono mb-1">Item {index + 1}</p>
      )}
      <span className="text-xs text-slate-200 break-all">{String(data)}</span>
    </div>
  );
}

function DataValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-slate-600 italic">empty</span>;
  }
  if (typeof value === 'boolean') {
    return (
      <span className={value ? 'text-emerald-400 font-medium' : 'text-red-400 font-medium'}>
        {String(value)}
      </span>
    );
  }
  if (typeof value === 'number') {
    return <span className="text-blue-300 font-mono">{value}</span>;
  }
  if (typeof value === 'string') {
    return <span>{value}</span>;
  }
  // object / array — show as collapsed JSON
  return (
    <span className="text-slate-400 font-mono text-[10px] break-all">
      {JSON.stringify(value)}
    </span>
  );
}

// ── Empty right-pane states ────────────────────────────────────────────────

function EmptyRight({ message }: { message: string }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-xs text-slate-600 text-center px-6">{message}</p>
    </div>
  );
}

// ── Execution list (left pane, default view) ───────────────────────────────

function ExecutionList({
  workflowId,
  selectedId,
  onSelect,
  onDeleted,
}: {
  workflowId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeleted?: (ids: string[]) => void;
}) {
  const [fetchLimit, setFetchLimit] = useState(PAGE_SIZE);
  const { data: paginatedData, isLoading } = useExecutionLog(workflowId, fetchLimit);
  const executions = paginatedData?.data ?? [];
  const hasMore    = paginatedData?.pagination.hasMore ?? false;

  const deleteSingle  = useDeleteExecution(workflowId);
  const deleteBulk    = useDeleteExecutions(workflowId);

  // Multi-select state
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const allChecked   = executions.length > 0 && checked.size === executions.length;
  const someChecked  = checked.size > 0 && !allChecked;

  // Modal state
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const isBusy = deleteSingle.isPending || deleteBulk.isPending;

  function toggleOne(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setChecked(allChecked ? new Set() : new Set(executions.map((e) => e.executionId)));
  }

  async function executeDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.type === 'single') {
      await deleteSingle.mutateAsync(pendingDelete.id);
      onDeleted?.([pendingDelete.id]);
    } else if (pendingDelete.type === 'selected') {
      await deleteBulk.mutateAsync({ ids: pendingDelete.ids });
      setChecked(new Set());
      onDeleted?.(pendingDelete.ids);
    } else {
      await deleteBulk.mutateAsync({ workflowId, deleteAll: true });
      setChecked(new Set());
      onDeleted?.([]);
    }
    setPendingDelete(null);
  }

  // Modal title/message helpers
  function modalTitle(pd: PendingDelete): string {
    if (pd.type === 'single')   return 'Delete this run?';
    if (pd.type === 'selected') return `Delete ${pd.ids.length} selected run${pd.ids.length > 1 ? 's' : ''}?`;
    return 'Delete all runs?';
  }
  function modalMessage(pd: PendingDelete): string {
    if (pd.type === 'all')
      return `All ${executions.length}${hasMore ? '+' : ''} runs for this workflow will be permanently removed. This action cannot be undone.`;
    return 'This run will be permanently removed from the database. This action cannot be undone.';
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* List header */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-700/60 shrink-0">
        {/* Select-all checkbox */}
        <input
          type="checkbox"
          checked={allChecked}
          ref={(el) => { if (el) el.indeterminate = someChecked; }}
          onChange={toggleAll}
          disabled={executions.length === 0}
          className="w-3 h-3 rounded accent-blue-500 shrink-0 cursor-pointer"
          title="Select all"
        />
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex-1">
          Runs {executions.length > 0 && `· ${executions.length}${hasMore ? '+' : ''}`}
        </span>
        {/* Delete all */}
        {executions.length > 0 && !checked.size && (
          <button
            onClick={() => setPendingDelete({ type: 'all' })}
            disabled={isBusy}
            title="Delete all runs"
            className="text-slate-600 hover:text-red-400 transition-colors p-0.5 rounded"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Selection action bar */}
      {checked.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-600/10 border-b border-blue-500/20 shrink-0">
          <span className="text-[11px] text-blue-300 flex-1">
            {checked.size} selected
          </span>
          <button
            onClick={() => setPendingDelete({ type: 'selected', ids: [...checked] })}
            disabled={isBusy}
            className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 transition-colors font-medium"
          >
            {isBusy
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Trash2 className="w-3 h-3" />
            }
            Delete
          </button>
          <button
            onClick={() => setChecked(new Set())}
            className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading && (
          <div className="flex justify-center py-4">
            <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin" />
          </div>
        )}
        {!isLoading && executions.length === 0 && (
          <p className="text-[11px] text-slate-600 text-center py-8 px-3">
            No executions yet.<br />Click <span className="text-slate-400">Trigger</span> to run the workflow.
          </p>
        )}

        {executions.map((exec) => {
          const isViewSelected = exec.executionId === selectedId;
          const isChecked      = checked.has(exec.executionId);
          const duration = exec.completedAt
            ? new Date(exec.completedAt).getTime() - new Date(exec.startedAt).getTime()
            : null;

          return (
            <div
              key={exec.executionId}
              className={`group flex items-start gap-2 px-2 py-2 border-b border-slate-800/60 transition-colors cursor-pointer ${
                isViewSelected
                  ? 'bg-blue-600/15 border-l-2 border-l-blue-500'
                  : isChecked
                    ? 'bg-slate-800/60'
                    : 'hover:bg-slate-800/50'
              }`}
              onClick={() => onSelect(exec.executionId)}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => toggleOne(exec.executionId)}
                onClick={(e) => e.stopPropagation()}
                className="mt-0.5 w-3 h-3 rounded accent-blue-500 shrink-0 cursor-pointer"
              />

              <div className="mt-0.5 shrink-0">
                <ExecStatusIcon status={exec.status} size="xs" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-slate-300 font-medium truncate">
                  {fmtDate(exec.startedAt)} · {fmtTime(exec.startedAt)}
                </p>
                <p className="text-[10px] text-slate-600 font-mono">
                  {exec.executionId.slice(0, 8)}
                  {duration != null && (
                    <span className="text-slate-500 ml-1">· {fmtDuration(duration)}</span>
                  )}
                </p>
              </div>

              <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 mt-0.5 ${STATUS_BADGE[exec.status] ?? ''}`}>
                {exec.status}
              </span>

              {/* Per-row trash — visible on hover */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setPendingDelete({ type: 'single', id: exec.executionId });
                }}
                disabled={isBusy}
                title="Delete this run"
                className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all shrink-0 mt-0.5 p-0.5"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        {hasMore && (
          <button
            className="w-full py-2 text-[11px] text-slate-500 hover:text-blue-400 hover:bg-slate-800/50 transition-colors"
            onClick={() => setFetchLimit((prev) => prev + PAGE_SIZE)}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : 'Load more'}
          </button>
        )}
      </div>

      {/* Delete confirmation modal */}
      <ConfirmModal
        open={pendingDelete !== null}
        title={pendingDelete ? modalTitle(pendingDelete) : ''}
        message={pendingDelete ? modalMessage(pendingDelete) : ''}
        confirmLabel="Delete"
        danger
        isLoading={isBusy}
        onConfirm={executeDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

// ── Node list (left pane, after selecting an execution) ────────────────────

function NodeList({
  results,
  nodeNameMap,
  selectedNodeId,
  onSelectNode,
  onBack,
}: {
  results: NodeResult[];
  nodeNameMap: Record<string, string>;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-700/60 text-[11px] text-slate-400 hover:text-slate-200 transition-colors shrink-0"
      >
        <ChevronLeft className="w-3 h-3" />
        All runs
      </button>

      <div className="flex-1 overflow-y-auto min-h-0">
        {results.length === 0 ? (
          <p className="text-[11px] text-slate-600 text-center py-6 px-3">
            No node results recorded.
          </p>
        ) : (
          results.map((r) => {
            const name = nodeNameMap[r.nodeId] ?? r.nodeId;
            const isSelected = r.nodeId === selectedNodeId;
            const isRunnerError = r.nodeId === '__runner__';
            return (
              <button
                key={r.nodeId}
                onClick={() => onSelectNode(r.nodeId)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b border-slate-800/60 transition-colors ${
                  isSelected
                    ? 'bg-blue-600/15 border-l-2 border-l-blue-500'
                    : isRunnerError
                      ? 'bg-red-500/5 hover:bg-red-500/10'
                      : 'hover:bg-slate-800/50'
                }`}
              >
                <NodeStatusIcon status={r.status} />
                <div className="flex-1 min-w-0">
                  <p className={`text-[11px] font-medium truncate ${isRunnerError ? 'text-red-300' : 'text-slate-300'}`}>
                    {name}
                  </p>
                  {r.durationMs > 0 && (
                    <p className="text-[10px] text-slate-600">{fmtDuration(r.durationMs)}</p>
                  )}
                  {isRunnerError && r.error && (
                    <p className="text-[10px] text-red-400/80 truncate mt-0.5">{r.error}</p>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Execution detail header ────────────────────────────────────────────────

function ExecDetailHeader({
  exec,
  workflowName,
}: {
  exec: ExecutionSummary;
  workflowName: string;
}) {
  const duration = exec.completedAt
    ? new Date(exec.completedAt).getTime() - new Date(exec.startedAt).getTime()
    : null;

  const statusLabel =
    exec.status === 'running' ? 'running' :
    exec.status === 'pending' ? 'pending' :
    `${exec.status} in ${duration != null ? fmtDuration(duration) : '—'}`;

  return (
    <div className="flex items-center gap-2 min-w-0">
      <ExecStatusIcon status={exec.status} />
      <span className="text-[11px] text-slate-300 truncate">
        <span className="font-medium">{workflowName}</span>
        <span className="text-slate-500 ml-1">·</span>
        <span className="text-slate-400 ml-1">{statusLabel}</span>
      </span>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────

export function ExecutionLogPanel() {
  const {
    activeWorkflow,
    setLogOpen,
    lastExecutionId,
  } = useWorkflowStore();

  // Node-ID → name map (includes synthetic __runner__ error entry)
  const nodeNameMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = { '__runner__': 'Workflow Error' };
    for (const n of activeWorkflow?.nodes ?? []) {
      map[n.id] = n.name;
    }
    return map;
  }, [activeWorkflow?.nodes]);

  // Which execution is being viewed in detail
  const [selectedExecId, setSelectedExecId] = useState<string | null>(lastExecutionId);
  // Which node is selected within that execution
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Fetch the selected execution's full details (for node list + output)
  const { data: selectedExec, isLoading: execLoading } = useExecution(selectedExecId);

  // Auto-select the latest execution when a new trigger fires
  useEffect(() => {
    if (lastExecutionId) {
      setSelectedExecId(lastExecutionId);
      setSelectedNodeId(null);
    }
  }, [lastExecutionId]);

  // When execution details load, auto-select the first node result
  // (especially useful for __runner__ errors which are the only result)
  useEffect(() => {
    if (selectedExec && !selectedNodeId) {
      const firstResult = selectedExec.results[0];
      if (firstResult) {
        setSelectedNodeId(firstResult.nodeId);
      }
    }
  }, [selectedExec?.executionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [sidebarWidth, startSidebarDrag] = useResizablePanel(
    LS_LOG_SIDEBAR_W, SIDEBAR_DEFAULT, SIDEBAR_MIN, SIDEBAR_MAX,
    'x', false,   // drag rightward = grow
  );

  const workflowId = activeWorkflow?.id;
  const workflowName = activeWorkflow?.name ?? 'Workflow';

  const selectedNodeResult =
    selectedExec?.results.find((r) => r.nodeId === selectedNodeId) ?? null;

  if (!workflowId || workflowId.startsWith('__new__')) {
    return (
      <div className="flex flex-col h-full bg-slate-900">
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700 shrink-0">
          <span className="text-xs font-semibold text-slate-300">Logs</span>
          <button onClick={() => setLogOpen(false)} className="text-slate-500 hover:text-white transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-slate-600 text-center px-6">
            Save the workflow first to view execution logs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-slate-700 shrink-0">
        <span className="text-xs font-semibold text-slate-300 shrink-0">Logs</span>

        {selectedExec ? (
          <>
            <div className="w-px h-4 bg-slate-700 shrink-0" />
            <div className="flex-1 min-w-0">
              <ExecDetailHeader exec={selectedExec} workflowName={workflowName} />
            </div>
          </>
        ) : (
          <div className="flex-1" />
        )}

        <button
          onClick={() => setLogOpen(false)}
          className="text-slate-500 hover:text-white transition-colors shrink-0 ml-auto"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── Body: two-column split ───────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel — resizable execution list or node list */}
        <div
          className="shrink-0 overflow-hidden flex flex-col"
          style={{ width: sidebarWidth }}
        >
          {selectedExecId ? (
            execLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
              </div>
            ) : selectedExec ? (
              <NodeList
                results={selectedExec.results as NodeResult[]}
                nodeNameMap={nodeNameMap}
                selectedNodeId={selectedNodeId}
                onSelectNode={(id) => setSelectedNodeId(id)}
                onBack={() => {
                  setSelectedExecId(null);
                  setSelectedNodeId(null);
                }}
              />
            ) : null
          ) : (
            <ExecutionList
              workflowId={workflowId}
              selectedId={selectedExecId}
              onSelect={(id) => {
                setSelectedExecId(id);
                setSelectedNodeId(null);
              }}
              onDeleted={(ids) => {
                // If the currently-viewed execution was deleted, reset the right pane
                const deletedAll = ids.length === 0;
                if (deletedAll || (selectedExecId && ids.includes(selectedExecId))) {
                  setSelectedExecId(null);
                  setSelectedNodeId(null);
                }
              }}
            />
          )}
        </div>

        {/* Drag handle between left sidebar and right output pane */}
        <div
          className="w-1 shrink-0 cursor-col-resize group relative"
          onMouseDown={startSidebarDrag}
          title="Drag to resize"
        >
          <div className="absolute inset-0 bg-slate-700/60 group-hover:bg-blue-500 transition-colors duration-150" />
          <div className="absolute inset-y-0 -inset-x-1" />
        </div>

        {/* Right panel — output viewer */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {!selectedExecId && (
            <EmptyRight message="Select a run from the list to view its output." />
          )}
          {selectedExecId && !selectedNodeId && (
            <EmptyRight message="Select a node on the left to see its output." />
          )}
          {selectedExecId && selectedNodeId && selectedNodeResult && (
            <OutputViewer
              result={selectedNodeResult}
              nodeName={nodeNameMap[selectedNodeResult.nodeId]}
            />
          )}
          {selectedExecId && selectedNodeId && !selectedNodeResult && !execLoading && (
            <EmptyRight message="Node result not found in this execution." />
          )}
        </div>
      </div>
    </div>
  );
}

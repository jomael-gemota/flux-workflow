import { useState, useEffect } from 'react';
import { X, RotateCcw, Loader2, Clock, Layers, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { useVersionHistory, useRestoreVersion } from '../../hooks/useWorkflows';
import { useWorkflowStore } from '../../store/workflowStore';
import { deserialize } from '../canvas/canvasUtils';
import { NodeIcon } from '../nodes/NodeIcons';
import type { VersionEntry } from '../../api/client';
import type { WorkflowDefinition } from '../../types/workflow';

interface VersionHistoryModalProps {
  open: boolean;
  onClose: () => void;
}

const PAGE_SIZE = 8;

/** Human-readable display name for each node type */
const NODE_LABELS: Record<string, string> = {
  trigger:   'Trigger',
  llm:       'AI / LLM',
  http:      'Web Request',
  condition: 'Condition',
  switch:    'Switch',
  transform: 'Transform',
  output:    'Output',
  gmail:     'Gmail',
  gdrive:    'Google Drive',
  gdocs:     'Google Docs',
  gsheets:   'Google Sheets',
  slack:     'Slack',
  teams:     'MS Teams',
  basecamp:  'Basecamp',
};

function nodeFriendlyName(type: string): string {
  return NODE_LABELS[type] ?? type;
}

/** Groups nodes by unique type and returns sorted entries */
function groupNodeTypes(nodes: WorkflowDefinition['nodes']): Array<{ type: string; count: number }> {
  const map: Record<string, number> = {};
  for (const n of nodes) {
    map[n.type] = (map[n.type] ?? 0) + 1;
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));
}

function formatDate(iso: string | undefined): string {
  if (!iso) return 'Unknown time';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);

  if (diffMins < 1)  return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) {
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `Today at ${time}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `Yesterday at ${time}`;
  }

  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Badge showing node count change relative to the next (older) version */
function ChangeBadge({ current, previous }: { current: number; previous: number | null }) {
  if (previous === null) return null;
  const diff = current - previous;
  if (diff === 0) return null;
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
      diff > 0
        ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
        : 'bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400'
    }`}>
      {diff > 0 ? `+${diff}` : diff}
    </span>
  );
}

/** Row of node type icon chips */
function NodeTypeChips({ nodes }: { nodes: WorkflowDefinition['nodes'] }) {
  const groups = groupNodeTypes(nodes);
  if (groups.length === 0) return <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">Empty workflow</span>;

  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map(({ type, count }) => (
        <span
          key={type}
          title={`${count} × ${nodeFriendlyName(type)}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700/70 border border-slate-200 dark:border-slate-600/50"
        >
          <span className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center overflow-hidden">
            <NodeIcon type={type} size={12} />
          </span>
          <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
            {nodeFriendlyName(type)}
            {count > 1 && (
              <span className="ml-0.5 text-slate-400 dark:text-slate-500">×{count}</span>
            )}
          </span>
        </span>
      ))}
    </div>
  );
}

/** Single version card in the list */
function VersionCard({
  version,
  previousNodeCount,
  isFirst,
  isLast,
  confirmingVersion,
  onRestore,
  onCancel,
}: {
  version: VersionEntry;
  previousNodeCount: number | null;
  isFirst: boolean;
  isLast: boolean;
  confirmingVersion: number | null;
  onRestore: (v: number) => void;
  onCancel: () => void;
}) {
  const isConfirming = confirmingVersion === version.version;
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative flex gap-3 px-5 py-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Timeline spine */}
      <div className="flex flex-col items-center shrink-0 pt-3.5">
        <div className={`w-2.5 h-2.5 rounded-full border-2 shrink-0 z-10 ${
          isConfirming
            ? 'border-blue-500 bg-blue-500'
            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
        }`} />
        {!isLast && <div className="w-px flex-1 bg-slate-200 dark:bg-slate-700 mt-1" />}
      </div>

      {/* Card body */}
      <div className={`flex-1 min-w-0 pb-3 ${isFirst ? 'pt-3' : 'pt-3'}`}>
        <div className={`rounded-xl border transition-all duration-150 ${
          isConfirming
            ? 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-500/8 shadow-sm'
            : hovered
            ? 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-white/5 shadow-sm'
            : 'border-transparent bg-transparent'
        } px-3.5 py-3`}>

          {/* Top row: version badge + date + node count */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 shrink-0">
              v{version.version}
            </span>
            <span className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate">
              {formatDate(version.archivedAt)}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
              {version.nodes.length} node{version.nodes.length !== 1 ? 's' : ''}
            </span>
            <ChangeBadge current={version.nodes.length} previous={previousNodeCount} />
          </div>

          {/* Node type chips */}
          <div className="mt-2">
            <NodeTypeChips nodes={version.nodes} />
          </div>

          {/* Restore action */}
          {(hovered || isConfirming) && (
            <div className="mt-2.5 flex items-center gap-2">
              {isConfirming ? (
                <>
                  <span className="text-[11px] text-slate-600 dark:text-slate-300 flex-1">
                    Replace current canvas with v{version.version}?
                  </span>
                  <button
                    onClick={onCancel}
                    className="px-2.5 py-1 text-[11px] font-medium rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => onRestore(version.version)}
                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                  >
                    <Check className="w-3 h-3" />
                    Yes, restore
                  </button>
                </>
              ) : (
                <button
                  onClick={() => onRestore(version.version)}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-200 hover:border-blue-400 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors shadow-sm"
                >
                  <RotateCcw className="w-3 h-3" />
                  Restore this version
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function VersionHistoryModal({ open, onClose }: VersionHistoryModalProps) {
  const { activeWorkflow, setActiveWorkflow, setNodes, setEdges, setDirty, setSelectedNodeId } =
    useWorkflowStore();

  const workflowId = activeWorkflow?.id ?? null;
  const { data: versions, isLoading } = useVersionHistory(open ? workflowId : null);
  const restore = useRestoreVersion();

  const [page, setPage] = useState(0);
  const [confirmingVersion, setConfirmingVersion] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!open) {
      setPage(0);
      setConfirmingVersion(null);
      setRestoring(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !workflowId) return null;

  const totalPages = Math.ceil((versions?.length ?? 0) / PAGE_SIZE);
  const paged = versions?.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE) ?? [];

  async function handleRestore(version: number) {
    if (!workflowId) return;
    // First click → show confirmation inline
    if (confirmingVersion !== version) {
      setConfirmingVersion(version);
      return;
    }
    // Second click (confirmed)
    setRestoring(true);
    try {
      const restored = await restore.mutateAsync({ workflowId, version });
      const { nodes, edges } = deserialize(restored);
      setActiveWorkflow(restored);
      setNodes(nodes);
      setEdges(edges);
      setDirty(false);
      setSelectedNodeId(null);
      onClose();
    } catch {
      setRestoring(false);
      setConfirmingVersion(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-[1px]"
        onClick={onClose}
      />

      <div className="relative bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col"
        style={{ maxHeight: 'min(82vh, 680px)' }}>

        {/* ── Header ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4 text-blue-500 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white leading-tight">
                Version History
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                <span className="font-medium text-slate-700 dark:text-slate-300">{activeWorkflow?.name}</span>
                {' '}· Currently on{' '}
                <span className="font-medium text-blue-600 dark:text-blue-400">v{activeWorkflow?.version}</span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Pagination bar ────────────────────────────────────────── */}
        {versions && versions.length > PAGE_SIZE && (
          <div className="flex items-center justify-between px-5 py-2 border-b border-slate-100 dark:border-slate-700/60 shrink-0 bg-slate-50/50 dark:bg-slate-800/50">
            <button
              onClick={() => { setPage(p => p - 1); setConfirmingVersion(null); }}
              disabled={page === 0}
              className="flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Newer
            </button>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Page <span className="font-semibold text-slate-700 dark:text-slate-200">{page + 1}</span>
              {' '}of{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-200">{totalPages}</span>
              <span className="ml-1.5 text-slate-400 dark:text-slate-500">({versions.length} total)</span>
            </span>
            <button
              onClick={() => { setPage(p => p + 1); setConfirmingVersion(null); }}
              disabled={page >= totalPages - 1}
              className="flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Older
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ── Version list ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
              <p className="text-xs text-slate-400 dark:text-slate-500">Loading history…</p>
            </div>

          ) : !versions || versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-700/60 flex items-center justify-center">
                <Layers className="w-5 h-5 text-slate-400 dark:text-slate-500" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No saved versions yet</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-xs">
                  Every time you save a change to this workflow, a snapshot is saved here automatically.
                </p>
              </div>
            </div>

          ) : (
            <div className="py-3">
              {paged.map((v: VersionEntry, idx: number) => {
                const next = paged[idx + 1];
                const globalIdx = page * PAGE_SIZE + idx;
                const nextGlobal = versions[globalIdx + 1];
                const previousNodeCount = nextGlobal?.nodes?.length ?? null;

                return (
                  <VersionCard
                    key={`${v.version}-${idx}`}
                    version={v}
                    previousNodeCount={previousNodeCount}
                    isFirst={idx === 0}
                    isLast={idx === paged.length - 1 || !next}
                    confirmingVersion={confirmingVersion}
                    onRestore={handleRestore}
                    onCancel={() => setConfirmingVersion(null)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* ── Footer hint ───────────────────────────────────────────── */}
        {versions && versions.length > 0 && !restoring && (
          <div className="shrink-0 px-5 py-2.5 border-t border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/50 rounded-b-xl">
            <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
              Hover over a version to see the restore option. Restoring will replace your current canvas.
            </p>
          </div>
        )}

        {/* ── Restoring overlay ─────────────────────────────────────── */}
        {restoring && (
          <div className="absolute inset-0 bg-white/80 dark:bg-slate-800/80 rounded-xl flex flex-col items-center justify-center gap-3 z-10 backdrop-blur-[2px]">
            <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Restoring version…
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

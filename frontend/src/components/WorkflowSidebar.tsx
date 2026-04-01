import { useEffect } from 'react';
import { Plus, Trash2, Loader2, GitBranch, Play, Zap } from 'lucide-react';
import { useWorkflowList, useDeleteWorkflow } from '../hooks/useWorkflows';
import { useWorkflowStore } from '../store/workflowStore';
import { deserialize } from './canvas/canvasUtils';
import type { WorkflowDefinition } from '../types/workflow';

// ── Deterministic colour badge ────────────────────────────────────────────────

const BADGE_PALETTE = [
  'bg-violet-500',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-cyan-500',
  'bg-indigo-500',
  'bg-orange-500',
  'bg-teal-500',
  'bg-pink-500',
];

function badgeColor(id: string): string {
  const hash = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffff, 0);
  return BADGE_PALETTE[hash % BADGE_PALETTE.length];
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Icon for the entry (trigger) node type in a workflow */
function EntryIcon({ nodes }: { nodes: WorkflowDefinition['nodes'] }) {
  const entry = nodes.find((n) => n.type === 'trigger');
  if (!entry) return <GitBranch className="w-4 h-4" />;
  const type = entry.config?.triggerType as string | undefined;
  if (type === 'cron') return <span className="text-[13px]">⏰</span>;
  if (type === 'webhook') return <span className="text-[13px]">🔗</span>;
  if (type === 'app_event') return <span className="text-[13px]">⚡</span>;
  return <Play className="w-3.5 h-3.5" />;
}

// ── Main sidebar ──────────────────────────────────────────────────────────────

export function WorkflowSidebar() {
  const { data: workflows, isLoading } = useWorkflowList();
  const deleteWf = useDeleteWorkflow();
  const {
    activeWorkflow,
    setActiveWorkflow,
    setNodes,
    setEdges,
    setDirty,
    setSelectedNodeId,
  } = useWorkflowStore();

  // Auto-load the first workflow on initial page load
  useEffect(() => {
    if (workflows?.length && !activeWorkflow) {
      loadWorkflow(workflows[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflows]);

  function loadWorkflow(wf: WorkflowDefinition) {
    const { nodes, edges } = deserialize(wf);
    setActiveWorkflow(wf);
    setNodes(nodes);
    setEdges(edges);
    setDirty(false);
    setSelectedNodeId(null);
  }

  function createNewWorkflow() {
    const newWf: WorkflowDefinition = {
      id: '__new__',
      name: 'New Workflow',
      version: 1,
      nodes: [],
      entryNodeId: '',
    };
    setActiveWorkflow(newWf);
    setNodes([]);
    setEdges([]);
    setDirty(true);
    setSelectedNodeId(null);
  }

  const list = workflows ?? [];

  return (
    <aside className="w-60 glass-surface border-r border-black/[0.07] dark:border-white/10 flex flex-col shrink-0 overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-3 pt-3.5 pb-3 border-b border-black/[0.07] dark:border-white/10 shrink-0 space-y-3">
        {/* Title row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-blue-500/15 dark:bg-blue-500/20 flex items-center justify-center">
              <Zap className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" />
            </div>
            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-widest">
              Workflows
            </span>
          </div>
          {list.length > 0 && (
            <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 bg-black/5 dark:bg-white/8 px-1.5 py-0.5 rounded-full">
              {list.length}
            </span>
          )}
        </div>

        {/* New workflow button */}
        <button
          onClick={createNewWorkflow}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl
                     bg-blue-500 hover:bg-blue-600 active:bg-blue-700
                     text-white text-[12px] font-semibold
                     shadow-sm shadow-blue-500/25
                     transition-all duration-150 select-none"
        >
          <Plus className="w-3.5 h-3.5" />
          New Workflow
        </button>
      </div>

      {/* ── Workflow list ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0 py-2 px-2 space-y-0.5">

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 text-slate-400 dark:text-slate-500 animate-spin" />
          </div>

        ) : list.length === 0 ? (
          /* ── Empty state ──────────────────────────────────────────────────── */
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800/60 flex items-center justify-center mb-3">
              <GitBranch className="w-6 h-6 text-slate-400 dark:text-slate-500" />
            </div>
            <p className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">
              No workflows yet
            </p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
              Click <strong className="font-semibold">New Workflow</strong> above to get started
            </p>
          </div>

        ) : (
          list.map((wf) => {
            const isActive = activeWorkflow?.id === wf.id;
            const badge    = badgeColor(wf.id);
            const inits    = initials(wf.name);
            const nodeCount = wf.nodes?.length ?? 0;

            return (
              <button
                key={wf.id}
                type="button"
                onClick={() => loadWorkflow(wf)}
                className={[
                  'group relative w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl text-left',
                  'transition-all duration-150 cursor-pointer select-none',
                  isActive
                    ? 'bg-blue-500/12 dark:bg-blue-500/18 ring-1 ring-blue-500/25 dark:ring-blue-400/20'
                    : 'hover:bg-black/5 dark:hover:bg-white/8 active:bg-black/8 dark:active:bg-white/12',
                ].join(' ')}
              >
                {/* Active left accent bar */}
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-7 bg-blue-500 rounded-r-full" />
                )}

                {/* Coloured initials badge */}
                <span
                  className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-[12px] font-bold text-white shadow-sm ${badge}`}
                  aria-hidden
                >
                  {inits}
                </span>

                {/* Workflow info */}
                <div className="flex-1 min-w-0">
                  <p
                    className={[
                      'text-[13px] font-semibold truncate leading-tight',
                      isActive
                        ? 'text-blue-700 dark:text-blue-200'
                        : 'text-slate-700 dark:text-slate-200',
                    ].join(' ')}
                  >
                    {wf.name}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">
                      {nodeCount} {nodeCount === 1 ? 'node' : 'nodes'}
                    </span>
                    <span className="text-[10px] text-slate-300 dark:text-slate-600">·</span>
                    <span className="flex items-center gap-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                      <EntryIcon nodes={wf.nodes ?? []} />
                    </span>
                  </div>
                </div>

                {/* Delete button — visible on hover */}
                <button
                  type="button"
                  className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded-lg
                             text-slate-400 dark:text-slate-500
                             hover:text-red-500 dark:hover:text-red-400
                             hover:bg-red-50 dark:hover:bg-red-500/10
                             transition-all duration-150"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${wf.name}"?`)) {
                      deleteWf.mutate(wf.id);
                      if (activeWorkflow?.id === wf.id) {
                        setActiveWorkflow(null);
                        setNodes([]);
                        setEdges([]);
                      }
                    }
                  }}
                  title={`Delete "${wf.name}"`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

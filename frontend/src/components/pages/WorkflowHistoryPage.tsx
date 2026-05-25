import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  SkipForward,
  Minus,
  RefreshCw,
  Terminal,
  Play,
  Zap,
  Globe,
  Copy,
  Check,
  History,
  Webhook,
} from 'lucide-react';
import { Toolbar } from '../Toolbar';
import { WorkflowSidebar } from '../WorkflowSidebar';
import { useWorkflow } from '../../hooks/useWorkflows';
import * as api from '../../api/client';
import type { ExecutionSummary, NodeResult, WorkflowDefinition } from '../../types/workflow';

// ── Formatters ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatDuration(startedAt: string, completedAt?: string): string {
  if (!completedAt) return '—';
  try {
    const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  } catch {
    return '—';
  }
}

function shortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

// ── Status chip ───────────────────────────────────────────────────────────────

type ExecStatus = ExecutionSummary['status'];

const STATUS_CFG: Record<ExecStatus, { icon: React.ReactNode; label: string; cls: string }> = {
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
    icon: <Clock className="w-3.5 h-3.5" />,
    label: 'Pending',
    cls: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-700/50 dark:text-slate-400 dark:border-slate-600/50',
  },
};

function StatusChip({ status }: { status: ExecStatus }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.pending;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${cfg.cls}`}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ── Trigger badge ─────────────────────────────────────────────────────────────

const TRIGGER_CFG: Record<string, { icon: React.ReactNode; label: string }> = {
  api:         { icon: <Terminal className="w-3 h-3" />,  label: 'API' },
  webhook:     { icon: <Webhook className="w-3 h-3" />,   label: 'Webhook' },
  manual:      { icon: <Play className="w-3 h-3" />,      label: 'Manual' },
  replay:      { icon: <RefreshCw className="w-3 h-3" />, label: 'Replay' },
  schedule:    { icon: <Clock className="w-3 h-3" />,     label: 'Schedule' },
  'node-test': { icon: <Zap className="w-3 h-3" />,       label: 'Node Test' },
  'step-run':  { icon: <Zap className="w-3 h-3" />,       label: 'Step Run' },
};

function TriggerBadge({ triggeredBy }: { triggeredBy?: string }) {
  const src = triggeredBy ?? 'manual';
  const cfg = TRIGGER_CFG[src] ?? { icon: <Globe className="w-3 h-3" />, label: src };
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

// ── Node status pill ──────────────────────────────────────────────────────────

function NodeStatusPill({ status }: { status: 'success' | 'failure' | 'skipped' }) {
  const map = {
    success: 'text-emerald-600 dark:text-emerald-400 font-medium',
    failure: 'text-red-500 dark:text-red-400 font-medium',
    skipped: 'text-amber-500 dark:text-amber-400 font-medium',
  };
  return <span className={`text-xs capitalize ${map[status]}`}>{status}</span>;
}

// ── Step summary ──────────────────────────────────────────────────────────────

function StepSummary({ results }: { results: NodeResult[] }) {
  const real = results.filter((r) => r.nodeId !== '__runner__');
  const ok   = real.filter((r) => r.status === 'success').length;
  const fail = real.filter((r) => r.status === 'failure').length;
  const skip = real.filter((r) => r.status === 'skipped').length;

  if (real.length === 0)
    return <span className="text-[11px] text-slate-400 dark:text-slate-500">No steps ran</span>;

  return (
    <div className="flex items-center gap-2">
      {ok > 0 && (
        <span className="flex items-center gap-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-3 h-3" />
          {ok}
        </span>
      )}
      {fail > 0 && (
        <span className="flex items-center gap-0.5 text-[11px] font-semibold text-red-500 dark:text-red-400">
          <XCircle className="w-3 h-3" />
          {fail}
        </span>
      )}
      {skip > 0 && (
        <span className="flex items-center gap-0.5 text-[11px] font-semibold text-amber-500 dark:text-amber-400">
          <SkipForward className="w-3 h-3" />
          {skip}
        </span>
      )}
      <span className="text-[10px] text-slate-400 dark:text-slate-500">/ {real.length}</span>
    </div>
  );
}

// ── Detail label ──────────────────────────────────────────────────────────────

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-0.5">
        {label}
      </p>
      <div className="text-slate-700 dark:text-slate-200 text-xs">{children}</div>
    </div>
  );
}

// ── Execution row ─────────────────────────────────────────────────────────────

interface ExecutionRowProps {
  execution: ExecutionSummary;
  workflow: WorkflowDefinition | undefined;
}

function ExecutionRow({ execution, workflow }: ExecutionRowProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [idCopied, setIdCopied] = useState(false);

  const realResults = execution.results.filter((r) => r.nodeId !== '__runner__');
  const resultNodeIds = new Set(realResults.map((r) => r.nodeId));

  const skippedNodes = realResults
    .filter((r) => r.status === 'skipped')
    .map((r) => ({
      id: r.nodeId,
      name: workflow?.nodes.find((n) => n.id === r.nodeId)?.name ?? r.nodeId,
    }));

  const notReachedNodes = (workflow?.nodes ?? [])
    .filter((n) => !resultNodeIds.has(n.id))
    .map((n) => ({ id: n.id, name: n.name }));

  function copyExecutionId() {
    navigator.clipboard.writeText(execution.executionId).catch(() => {});
    setIdCopied(true);
    setTimeout(() => setIdCopied(false), 2000);
  }

  function openReplay() {
    navigate(`/executions/${execution.executionId}/replay`);
  }

  return (
    <div className="border border-slate-200 dark:border-slate-700/50 rounded-xl overflow-hidden bg-white dark:bg-slate-800/40 shadow-sm hover:shadow transition-shadow">
      {/* ── Summary row ── */}
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none" onClick={() => setExpanded((v) => !v)}>
        {/* Expand toggle */}
        <span className="text-slate-400 dark:text-slate-500 shrink-0">
          {expanded
            ? <ChevronDown className="w-4 h-4" />
            : <ChevronRight className="w-4 h-4" />
          }
        </span>

        {/* Status */}
        <StatusChip status={execution.status} />

        {/* Execution ID */}
        <div
          className="flex items-center gap-1.5 min-w-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={openReplay}
            title={`Open replay for ${execution.executionId}`}
            className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[120px]"
          >
            {shortId(execution.executionId)}
          </button>
          <button
            onClick={copyExecutionId}
            title="Copy execution ID"
            className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            {idCopied
              ? <Check className="w-3 h-3 text-emerald-500" />
              : <Copy className="w-3 h-3" />
            }
          </button>
          <button
            onClick={openReplay}
            title="Open in replay canvas"
            className="shrink-0 text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>

        {/* Trigger source */}
        <TriggerBadge triggeredBy={execution.triggeredBy} />

        {/* Started at */}
        <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap hidden sm:block">
          {formatDate(execution.startedAt)}
        </span>

        {/* Duration */}
        <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap tabular-nums">
          {formatDuration(execution.startedAt, execution.completedAt)}
        </span>

        {/* Step summary — pushed right */}
        <div className="ml-auto shrink-0">
          <StepSummary results={execution.results} />
        </div>
      </div>

      {/* ── Expanded detail ── */}
      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-700/40 bg-slate-50/60 dark:bg-slate-900/20 px-4 py-4 space-y-4">

          {/* Reference IDs + Workflow meta */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Detail label="Execution ID">
              <span className="font-mono break-all">{execution.executionId}</span>
            </Detail>
            <Detail label="Workflow ID">
              <span className="font-mono break-all">{execution.workflowId}</span>
            </Detail>
            <Detail label="Workflow Name">
              <span>{workflow?.name ?? '—'}</span>
            </Detail>
            <Detail label="Workflow Version">
              <span className="font-mono">v{execution.workflowVersion ?? '—'}</span>
            </Detail>
          </div>

          {/* Timestamps */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Detail label="Started At">
              <span>{formatDate(execution.startedAt)}</span>
            </Detail>
            <Detail label="Completed At">
              <span>{execution.completedAt ? formatDate(execution.completedAt) : '—'}</span>
            </Detail>
            <Detail label="Duration">
              <span className="tabular-nums">{formatDuration(execution.startedAt, execution.completedAt)}</span>
            </Detail>
          </div>

          {/* Step detail table */}
          {realResults.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                Step Summary
              </p>
              <div className="rounded-lg border border-slate-200 dark:border-slate-700/50 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 dark:bg-slate-800/70">
                    <tr>
                      <th className="text-left px-3 py-2 text-slate-500 dark:text-slate-400 font-semibold">Node</th>
                      <th className="text-left px-3 py-2 text-slate-500 dark:text-slate-400 font-semibold">Status</th>
                      <th className="text-left px-3 py-2 text-slate-500 dark:text-slate-400 font-semibold">Duration</th>
                      <th className="text-left px-3 py-2 text-slate-500 dark:text-slate-400 font-semibold">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/30">
                    {realResults.map((r) => {
                      const node = workflow?.nodes.find((n) => n.id === r.nodeId);
                      return (
                        <tr key={r.nodeId} className="bg-white dark:bg-slate-800/20 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200 font-medium">
                            {node?.name ?? r.nodeId}
                          </td>
                          <td className="px-3 py-2">
                            <NodeStatusPill status={r.status} />
                          </td>
                          <td className="px-3 py-2 text-slate-500 dark:text-slate-400 tabular-nums">
                            {r.durationMs != null ? `${r.durationMs}ms` : '—'}
                          </td>
                          <td className="px-3 py-2 text-red-500 dark:text-red-400 max-w-xs truncate" title={r.error}>
                            {r.error ?? <span className="text-slate-400 dark:text-slate-500">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Skipped steps */}
            <div>
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                Skipped Steps
                <span className="ml-1.5 text-slate-400 dark:text-slate-500 font-normal normal-case tracking-normal">
                  ({skippedNodes.length})
                </span>
              </p>
              {skippedNodes.length === 0 ? (
                <span className="text-[11px] text-slate-400 dark:text-slate-500 italic">None</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {skippedNodes.map((n) => (
                    <span
                      key={n.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200/80 dark:border-amber-700/30 text-[11px] font-medium"
                    >
                      <SkipForward className="w-2.5 h-2.5 shrink-0" />
                      {n.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Not-reached nodes */}
            <div>
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
                Not Reached
                <span className="ml-1.5 text-slate-400 dark:text-slate-500 font-normal normal-case tracking-normal">
                  ({notReachedNodes.length})
                </span>
              </p>
              {notReachedNodes.length === 0 ? (
                <span className="text-[11px] text-slate-400 dark:text-slate-500 italic">None</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {notReachedNodes.map((n) => (
                    <span
                      key={n.id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700/40 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600/50 text-[11px]"
                    >
                      <Minus className="w-2.5 h-2.5 shrink-0" />
                      {n.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Open in replay CTA */}
          <div className="pt-1">
            <button
              onClick={openReplay}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open in Replay Canvas
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function WorkflowHistoryPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();

  const { data: workflow, isLoading: workflowLoading } = useWorkflow(workflowId ?? null);

  // ── Paginated execution list ─────────────────────────────────────────────────
  const [extraPages, setExtraPages]           = useState<ExecutionSummary[][]>([]);
  const [nextCursor, setNextCursor]           = useState<string | undefined>(undefined);
  const [serverHasMore, setServerHasMore]     = useState(false);
  const [isLoadingMore, setIsLoadingMore]     = useState(false);

  const PAGE_SIZE = 20;

  const {
    data: firstPage,
    isLoading: firstLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['executions', 'history-page', workflowId],
    queryFn: () => api.listExecutions(workflowId!, PAGE_SIZE),
    enabled: !!workflowId,
    staleTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data?.data ?? [];
      return data.some((e) => e.status === 'pending' || e.status === 'running') ? 3000 : false;
    },
  });

  // Reset extra pages when the first page refreshes
  useEffect(() => {
    if (firstPage) {
      setExtraPages([]);
      setNextCursor(firstPage.pagination.nextCursor ?? undefined);
      setServerHasMore(firstPage.pagination.hasMore);
    }
  }, [firstPage]);

  const allExecutions = useMemo(() => {
    const base = firstPage?.data ?? [];
    return [...base, ...extraPages.flat()];
  }, [firstPage, extraPages]);

  async function loadMore() {
    if (!workflowId || !nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const res = await api.listExecutions(workflowId, PAGE_SIZE, nextCursor);
      setExtraPages((prev) => [...prev, res.data]);
      setNextCursor(res.pagination.nextCursor ?? undefined);
      setServerHasMore(res.pagination.hasMore);
    } finally {
      setIsLoadingMore(false);
    }
  }

  const hasMore = serverHasMore && !!nextCursor;
  const isLoading = firstLoading || workflowLoading;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-950 text-gray-900 dark:text-white overflow-hidden">
      <Toolbar />

      <div className="flex flex-1 min-h-0">
        <WorkflowSidebar />

        {/* ── Main content ── */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-5xl mx-auto px-6 py-6">

            {/* Page header */}
            <div className="flex items-start gap-4 mb-6">
              <button
                onClick={() => navigate(workflowId ? `/workflows/${workflowId}` : '/')}
                className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Canvas
              </button>

              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <History className="w-5 h-5 text-blue-500 shrink-0" />
                  <h1 className="text-lg font-bold text-slate-900 dark:text-white truncate">
                    Execution History
                  </h1>
                </div>
                {workflow && (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{workflow.name}</span>
                    <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span>
                    <span className="font-mono text-xs">{workflowId}</span>
                    <span className="mx-1.5 text-slate-300 dark:text-slate-600">·</span>
                    v{workflow.version}
                  </p>
                )}
              </div>

              {/* Refresh */}
              <button
                onClick={() => refetch()}
                disabled={isRefetching}
                title="Refresh"
                className="ml-auto shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {/* Stats bar */}
            {!isLoading && allExecutions.length > 0 && (
              <div className="flex items-center gap-4 mb-5 p-3 rounded-xl bg-white dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50 shadow-sm">
                <Stat
                  label="Total"
                  value={allExecutions.length + (hasMore ? '+' : '')}
                  color="text-slate-700 dark:text-slate-200"
                />
                <div className="w-px h-6 bg-slate-200 dark:bg-slate-700" />
                <Stat
                  label="Success"
                  value={allExecutions.filter((e) => e.status === 'success').length}
                  color="text-emerald-600 dark:text-emerald-400"
                />
                <Stat
                  label="Failed"
                  value={allExecutions.filter((e) => e.status === 'failure').length}
                  color="text-red-500 dark:text-red-400"
                />
                <Stat
                  label="Partial"
                  value={allExecutions.filter((e) => e.status === 'partial').length}
                  color="text-amber-500 dark:text-amber-400"
                />
                {allExecutions.some((e) => e.status === 'running' || e.status === 'pending') && (
                  <Stat
                    label="Active"
                    value={allExecutions.filter((e) => e.status === 'running' || e.status === 'pending').length}
                    color="text-blue-500 dark:text-blue-400"
                  />
                )}
              </div>
            )}

            {/* Content */}
            {isLoading ? (
              <div className="flex items-center justify-center py-20 gap-2 text-slate-400 dark:text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Loading executions…</span>
              </div>
            ) : isError ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <XCircle className="w-8 h-8 text-red-400" />
                <p className="text-sm text-slate-500 dark:text-slate-400">Failed to load execution history.</p>
                <button
                  onClick={() => refetch()}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium transition-colors"
                >
                  Retry
                </button>
              </div>
            ) : allExecutions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <History className="w-10 h-10 text-slate-300 dark:text-slate-600" />
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">No executions yet</p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Trigger this workflow to see its execution history here.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {allExecutions.map((exec) => (
                  <ExecutionRow key={exec.executionId} execution={exec} workflow={workflow} />
                ))}

                {/* Load more */}
                {hasMore && (
                  <div className="pt-2 text-center">
                    <button
                      onClick={loadMore}
                      disabled={isLoadingMore}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60 disabled:opacity-50 transition-colors shadow-sm"
                    >
                      {isLoadingMore ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading…
                        </>
                      ) : (
                        <>
                          Load more
                          <ChevronDown className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Stat mini-widget ──────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-xs text-slate-400 dark:text-slate-500">{label}</span>
    </div>
  );
}

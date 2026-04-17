import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X, Eye, AlertTriangle, CheckCircle2, XCircle, Clock,
  Play, Calendar, Search, ChevronLeft, ChevronRight,
  RefreshCw, Loader2, Shield, User, Workflow, Activity,
  ChevronDown, ChevronUp, Zap, AlertCircle, Info,
} from 'lucide-react';
import {
  fetchSurveillance,
  type SurveillanceWorkflow,
  type SurveillanceSummary,
} from '../../api/auth';

// ── Types ─────────────────────────────────────────────────────────────────

type FilterTab = 'all' | 'running' | 'scheduled' | 'issues';

// ── Helpers ───────────────────────────────────────────────────────────────

function formatRelative(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString();
}

function formatNextRun(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff < 0) return 'overdue';
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `in ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `in ${h}h`;
  const d = Math.floor(h / 24);
  return `in ${d}d`;
}

// ── Sub-components ────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  high:   { bg: 'bg-red-100 dark:bg-red-500/20',    text: 'text-red-700 dark:text-red-300',    icon: <AlertTriangle className="w-3 h-3" /> },
  medium: { bg: 'bg-amber-100 dark:bg-amber-500/20', text: 'text-amber-700 dark:text-amber-300', icon: <AlertCircle className="w-3 h-3" /> },
  low:    { bg: 'bg-blue-100 dark:bg-blue-500/20',   text: 'text-blue-700 dark:text-blue-300',   icon: <Info className="w-3 h-3" /> },
};

function StatusBadge({ wf }: { wf: SurveillanceWorkflow }) {
  if (wf.execStatus.isRunning) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
        Running
      </span>
    );
  }
  const last = wf.execStatus.lastExecution;
  if (!last) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
        Never run
      </span>
    );
  }
  if (last.status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="w-3 h-3" /> Success
      </span>
    );
  }
  if (last.status === 'failure') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300">
        <XCircle className="w-3 h-3" /> Failed
      </span>
    );
  }
  if (last.status === 'partial') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300">
        <AlertCircle className="w-3 h-3" /> Partial
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400">
      {last.status}
    </span>
  );
}

function OwnerCell({ wf }: { wf: SurveillanceWorkflow }) {
  const owner = wf.owner;
  if (!owner) {
    return (
      <div className="flex items-center gap-1.5 text-slate-400 dark:text-slate-500">
        <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
          <User className="w-3 h-3" />
        </div>
        <span className="text-[11px]">API / Legacy</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      {owner.avatar ? (
        <img src={owner.avatar} alt={owner.name} className="w-6 h-6 rounded-full object-cover shrink-0" />
      ) : (
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-violet-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
          {owner.name.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-slate-700 dark:text-slate-200 truncate leading-tight">{owner.name}</p>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">{owner.email}</p>
      </div>
    </div>
  );
}

function SuccessRateBar({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-[11px] text-slate-400">—</span>;
  const color = rate >= 80 ? 'bg-emerald-500' : rate >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${rate}%` }} />
      </div>
      <span className="text-[11px] text-slate-600 dark:text-slate-300 tabular-nums">{rate}%</span>
    </div>
  );
}

// ── Detail row (expandable) ───────────────────────────────────────────────

function WorkflowRow({ wf }: { wf: SurveillanceWorkflow }) {
  const [expanded, setExpanded] = useState(false);

  const highVulns   = wf.vulnerabilities.filter(v => v.severity === 'high').length;
  const mediumVulns = wf.vulnerabilities.filter(v => v.severity === 'medium').length;

  const nextRuns = wf.schedule?.tasks
    .filter(t => t.nextRun)
    .sort((a, b) => new Date(a.nextRun!).getTime() - new Date(b.nextRun!).getTime()) ?? [];
  const soonestNext = nextRuns[0] ?? null;

  return (
    <>
      <tr
        className={`border-b border-slate-100 dark:border-slate-700/50 transition-colors cursor-pointer ${
          expanded
            ? 'bg-slate-50 dark:bg-slate-800/70'
            : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
        }`}
        onClick={() => setExpanded(v => !v)}
      >
        {/* Expand toggle */}
        <td className="pl-3 pr-1 py-3 w-6">
          {expanded
            ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
            : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          }
        </td>

        {/* Workflow name + meta */}
        <td className="px-3 py-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[12px] font-semibold text-slate-800 dark:text-white truncate">{wf.name}</span>
                <span className="text-[10px] text-slate-400 dark:text-slate-500">v{wf.version}</span>
                {wf.execStatus.isRunning && (
                  <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-bold uppercase tracking-wide">
                    <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" /> Live
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5 truncate">{wf.workflowId}</p>
            </div>
          </div>
        </td>

        {/* Owner */}
        <td className="px-3 py-3 hidden md:table-cell">
          <OwnerCell wf={wf} />
        </td>

        {/* Status */}
        <td className="px-3 py-3">
          <StatusBadge wf={wf} />
        </td>

        {/* Last run */}
        <td className="px-3 py-3 hidden lg:table-cell">
          <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {formatRelative(wf.execStatus.lastExecution?.startedAt)}
          </span>
        </td>

        {/* Next scheduled run */}
        <td className="px-3 py-3 hidden lg:table-cell">
          {soonestNext ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-violet-600 dark:text-violet-400 tabular-nums">
              <Calendar className="w-3 h-3 shrink-0" />
              {formatNextRun(soonestNext.nextRun)}
            </span>
          ) : (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">—</span>
          )}
        </td>

        {/* Success rate */}
        <td className="px-3 py-3 hidden xl:table-cell">
          <SuccessRateBar rate={wf.execStatus.successRate} />
        </td>

        {/* Issues */}
        <td className="px-3 py-3">
          {wf.vulnerabilities.length === 0 ? (
            <span className="text-[11px] text-slate-400 dark:text-slate-500">—</span>
          ) : (
            <div className="flex items-center gap-1">
              {highVulns > 0 && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 text-[10px] font-bold">
                  <AlertTriangle className="w-2.5 h-2.5" />{highVulns}
                </span>
              )}
              {mediumVulns > 0 && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[10px] font-bold">
                  <AlertCircle className="w-2.5 h-2.5" />{mediumVulns}
                </span>
              )}
            </div>
          )}
        </td>
      </tr>

      {/* Expanded detail */}
      {expanded && (
        <tr className="bg-slate-50 dark:bg-slate-800/70 border-b border-slate-100 dark:border-slate-700/50">
          <td colSpan={8} className="px-6 pb-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

              {/* Audit / Identity */}
              <DetailCard title="Identity & Ownership" icon={<User className="w-3.5 h-3.5" />}>
                <Row label="Workflow ID"  value={<code className="text-[10px] font-mono break-all">{wf.workflowId}</code>} />
                <Row label="Version"      value={`v${wf.version}`} />
                <Row label="Nodes"        value={`${wf.nodeCount} nodes`} />
                <Row label="Trigger type" value={wf.triggerTypes.length > 0 ? wf.triggerTypes.join(', ') : '—'} />
                <Row label="Owner"        value={wf.owner ? `${wf.owner.name} (${wf.owner.email})` : 'API / Legacy — no user'} />
                <Row label="Owner role"   value={wf.owner?.role ?? '—'} />
                <Row label="Created"      value={formatDateTime(wf.createdAt)} />
                <Row label="Last updated" value={formatDateTime(wf.updatedAt)} />
              </DetailCard>

              {/* Execution trace */}
              <DetailCard title="Execution Trace" icon={<Activity className="w-3.5 h-3.5" />}>
                <Row label="Status now"     value={wf.execStatus.isRunning ? '⚡ Currently running' : 'Idle'} />
                <Row label="Total runs"     value={String(wf.execStatus.totalRuns)} />
                <Row label="Recent failures" value={String(wf.execStatus.recentFailures)} />
                <Row label="Success rate"   value={wf.execStatus.successRate != null ? `${wf.execStatus.successRate}%` : '—'} />
                {wf.execStatus.lastExecution && <>
                  <Row label="Last exec ID"   value={<code className="text-[10px] font-mono break-all">{wf.execStatus.lastExecution.executionId}</code>} />
                  <Row label="Last started"   value={formatDateTime(wf.execStatus.lastExecution.startedAt)} />
                  <Row label="Last finished"  value={formatDateTime(wf.execStatus.lastExecution.completedAt)} />
                  <Row label="Triggered by"   value={wf.execStatus.lastExecution.triggeredBy} />
                </>}
              </DetailCard>

              {/* Schedule + Vulnerabilities */}
              <div className="flex flex-col gap-3">
                {wf.schedule && (
                  <DetailCard title="Scheduled Tasks" icon={<Calendar className="w-3.5 h-3.5" />}>
                    {wf.schedule.tasks.map((t) => (
                      <div key={t.nodeId} className="flex flex-col gap-0.5 py-1 border-b last:border-0 border-slate-200 dark:border-slate-700/50">
                        <code className="text-[10px] font-mono text-violet-600 dark:text-violet-400">{t.cronExpression}</code>
                        <div className="flex gap-3 text-[10px] text-slate-500 dark:text-slate-400">
                          <span>Node: <code className="font-mono">{t.nodeId === '__schedule__' ? 'top-level' : t.nodeId.slice(0, 8)}</code></span>
                          <span>Next: {formatNextRun(t.nextRun)}</span>
                        </div>
                      </div>
                    ))}
                  </DetailCard>
                )}

                {wf.vulnerabilities.length > 0 && (
                  <DetailCard title="Issues Detected" icon={<AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}>
                    <div className="flex flex-col gap-1.5 pt-1">
                      {wf.vulnerabilities.map((v) => {
                        const s = SEVERITY_STYLES[v.severity];
                        return (
                          <div key={v.code} className={`flex items-start gap-1.5 p-2 rounded-lg ${s.bg}`}>
                            <span className={`mt-0.5 shrink-0 ${s.text}`}>{s.icon}</span>
                            <div>
                              <p className={`text-[10px] font-bold ${s.text}`}>{v.code.replace(/_/g, ' ')}</p>
                              <p className={`text-[10px] ${s.text} opacity-80`}>{v.message}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </DetailCard>
                )}

                {wf.vulnerabilities.length === 0 && !wf.schedule && (
                  <div className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl border border-dashed border-emerald-200 dark:border-emerald-700/40 text-center">
                    <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">No issues detected</p>
                    <p className="text-[10px] text-slate-400">No schedule configured.</p>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DetailCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/60 rounded-xl p-3">
      <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-slate-100 dark:border-slate-700/50">
        <span className="text-slate-400 dark:text-slate-500">{icon}</span>
        <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-2 py-0.5">
      <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">{label}</span>
      <span className="text-[10px] text-slate-700 dark:text-slate-200 text-right">{value}</span>
    </div>
  );
}

// ── Summary cards ─────────────────────────────────────────────────────────

function SummaryCard({
  icon, label, value, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
  accent: string;
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${accent}`}>
      <span className="shrink-0">{icon}</span>
      <div>
        <p className="text-lg font-bold text-slate-800 dark:text-white leading-none">{value ?? '—'}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

interface Props { onClose: () => void; }

export function SurveillanceDashboard({ onClose }: Props) {
  const [filter, setFilter] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const LIMIT = 20;

  const queryKey = ['surveillance', filter, search, page];

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: () => fetchSurveillance({ page, limit: LIMIT, filter, search: search || undefined }),
    refetchInterval: 30_000,
    staleTime:       15_000,
    placeholderData: (prev) => prev,
  });

  const summary: SurveillanceSummary | undefined = data?.summary;

  const tabs: { key: FilterTab; label: string; count?: number }[] = [
    { key: 'all',       label: 'All Workflows',  count: summary?.totalWorkflows },
    { key: 'running',   label: 'Running Now',    count: summary?.runningNow },
    { key: 'scheduled', label: 'Scheduled',      count: summary?.scheduledActive },
    { key: 'issues',    label: 'Issues',         count: summary?.withIssues },
  ];

  const handleFilterChange = useCallback((f: FilterTab) => {
    setFilter(f);
    setPage(1);
  }, []);

  const handleSearch = useCallback((val: string) => {
    setSearch(val);
    setPage(1);
  }, []);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 dark:bg-black/70 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel — full-width slide-over */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-6xl bg-white dark:bg-[#0F172A] border-l border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 shrink-0">
            <Eye className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Workflow Surveillance</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Real-time visibility into all platform workflows — running, scheduled, issues &amp; audit trail
            </p>
          </div>

          <button
            onClick={() => refetch()}
            title="Refresh"
            className={`p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors ${isFetching ? 'animate-spin pointer-events-none' : ''}`}
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors ml-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-6 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <SummaryCard
            icon={<Workflow className="w-5 h-5 text-slate-500 dark:text-slate-400" />}
            label="Total Workflows"
            value={summary?.totalWorkflows}
            accent="border-slate-200 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/40"
          />
          <SummaryCard
            icon={<Play className="w-5 h-5 text-emerald-500" />}
            label="Running Now"
            value={summary?.runningNow}
            accent="border-emerald-200 dark:border-emerald-700/50 bg-emerald-50/60 dark:bg-emerald-500/5"
          />
          <SummaryCard
            icon={<Zap className="w-5 h-5 text-violet-500" />}
            label="Scheduled Active"
            value={summary?.scheduledActive}
            accent="border-violet-200 dark:border-violet-700/50 bg-violet-50/60 dark:bg-violet-500/5"
          />
          <SummaryCard
            icon={<Shield className="w-5 h-5 text-red-500" />}
            label="With Issues"
            value={summary?.withIssues}
            accent="border-red-200 dark:border-red-700/50 bg-red-50/60 dark:bg-red-500/5"
          />
        </div>

        {/* ── Controls: tabs + search ── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-6 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          {/* Filter tabs */}
          <div className="flex gap-1 flex-wrap">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => handleFilterChange(t.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  filter === t.key
                    ? 'bg-slate-900 dark:bg-white/10 text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5'
                }`}
              >
                {t.label}
                {t.count != null && (
                  <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none ${
                    filter === t.key
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative sm:ml-auto sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search name, ID, or owner…"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-indigo-400 dark:focus:border-indigo-500 text-xs text-slate-700 dark:text-slate-200 placeholder-slate-400 outline-none transition-colors"
            />
          </div>
        </div>

        {/* ── Table ── */}
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
            </div>
          ) : (data?.workflows.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Eye className="w-10 h-10 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">No workflows found</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {search ? 'Try adjusting your search or filter.' : 'No workflows match this filter.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-white dark:bg-[#0F172A] z-10">
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="w-6 pl-3" />
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Workflow</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide hidden md:table-cell">Owner / Account</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Status</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide hidden lg:table-cell">Last Run</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide hidden lg:table-cell">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Next Run</span>
                  </th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide hidden xl:table-cell">Success Rate</th>
                  <th className="px-3 py-2.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Issues</th>
                </tr>
              </thead>
              <tbody>
                {data!.workflows.map((wf) => (
                  <WorkflowRow key={wf.workflowId} wf={wf} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination ── */}
        {(data?.pages ?? 0) > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 dark:border-slate-700 shrink-0">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Showing {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, data!.total)} of {data!.total} workflows
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {Array.from({ length: Math.min(data!.pages, 7) }, (_, i) => {
                const p = i + 1;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors ${
                      p === page
                        ? 'bg-slate-900 dark:bg-white/10 text-white'
                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
                    }`}
                  >
                    {p}
                  </button>
                );
              })}

              <button
                onClick={() => setPage(p => Math.min(data!.pages, p + 1))}
                disabled={page >= (data?.pages ?? 1)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:pointer-events-none transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, SkipForward, Clock } from 'lucide-react';
import { NodeIcon } from '../nodes/NodeIcons';
import type { NodeResult } from '../../types/workflow';
import type { CanvasNode } from '../../store/workflowStore';

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

// ── Credential fields are stored as IDs — show a masked placeholder ──────────
const CREDENTIAL_KEYS = new Set(['credentialId', 'credential_id', 'apiKey', 'api_key']);

// ── Fields that are typically dropdown-selected values ────────────────────────
const ENUM_KEYS = new Set([
  'method', 'action', 'provider', 'model', 'medium', 'triggerType',
  'senderType', 'readSource', 'uploadSource', 'channelFilter',
  'preprocess', 'mode', 'status',
]);

function ValueBadge({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600">
      {value}
    </span>
  );
}

interface CollapsibleJsonProps {
  value: unknown;
}

function CollapsibleJson({ value }: CollapsibleJsonProps) {
  const [expanded, setExpanded] = useState(false);
  const json = JSON.stringify(value, null, 2);
  const preview = JSON.stringify(value);
  const isLong = preview.length > 80;

  if (!isLong) {
    return (
      <span className="font-mono text-xs text-slate-500 dark:text-slate-400 break-all">
        {preview}
      </span>
    );
  }

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-xs text-indigo-500 dark:text-indigo-400 hover:underline"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {expanded ? 'Collapse' : 'Expand'}
      </button>
      {expanded && (
        <pre className="mt-1 text-xs font-mono text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-md p-2 overflow-auto max-h-48 whitespace-pre-wrap break-all">
          {json}
        </pre>
      )}
    </div>
  );
}

function FieldRow({ label, value, isEnum }: { label: string; value: unknown; isEnum?: boolean }) {
  if (value === undefined || value === null || value === '') return null;

  let rendered: React.ReactNode;

  if (isEnum && typeof value === 'string') {
    rendered = <ValueBadge value={value} />;
  } else if (typeof value === 'boolean') {
    rendered = <ValueBadge value={value ? 'Yes' : 'No'} />;
  } else if (typeof value === 'string') {
    if (value.length > 120) {
      rendered = (
        <span className="text-xs text-slate-600 dark:text-slate-300 break-words whitespace-pre-wrap leading-relaxed">
          {value}
        </span>
      );
    } else {
      rendered = (
        <span className="text-xs text-slate-600 dark:text-slate-300 break-all">
          {value}
        </span>
      );
    }
  } else if (typeof value === 'number') {
    rendered = (
      <span className="text-xs font-mono text-slate-600 dark:text-slate-300">
        {String(value)}
      </span>
    );
  } else if (Array.isArray(value)) {
    if (value.length === 0) return null;
    rendered = (
      <div className="space-y-1">
        {value.map((item, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span className="text-[10px] text-slate-400 mt-0.5 shrink-0">{i + 1}.</span>
            {typeof item === 'object' && item !== null ? (
              <CollapsibleJson value={item} />
            ) : (
              <span className="text-xs text-slate-600 dark:text-slate-300 break-all">{String(item)}</span>
            )}
          </div>
        ))}
      </div>
    );
  } else if (typeof value === 'object') {
    rendered = <CollapsibleJson value={value} />;
  } else {
    rendered = (
      <span className="text-xs text-slate-600 dark:text-slate-300">{String(value)}</span>
    );
  }

  return (
    <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-700/60 last:border-b-0">
      <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">
        {label}
      </p>
      <div>{rendered}</div>
    </div>
  );
}

// ── Status banner ─────────────────────────────────────────────────────────────

function StatusBanner({ result }: { result: NodeResult }) {
  if (result.status === 'success') {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 dark:bg-emerald-900/20 border-b border-emerald-200 dark:border-emerald-700/50">
        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Succeeded</span>
        <span className="ml-auto text-[10px] text-emerald-600 dark:text-emerald-500 flex items-center gap-1">
          <Clock className="w-3 h-3" />{formatDurationMs(result.durationMs)}
        </span>
      </div>
    );
  }
  if (result.status === 'failure') {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-700/50">
        <XCircle className="w-4 h-4 text-red-500 shrink-0" />
        <span className="text-xs font-semibold text-red-700 dark:text-red-400">Failed</span>
        <span className="ml-auto text-[10px] text-red-600 dark:text-red-500 flex items-center gap-1">
          <Clock className="w-3 h-3" />{formatDurationMs(result.durationMs)}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700/50">
      <SkipForward className="w-4 h-4 text-slate-400 shrink-0" />
      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Skipped</span>
    </div>
  );
}

// ── Output section ────────────────────────────────────────────────────────────

function OutputSection({ result }: { result: NodeResult }) {
  const [showOutput, setShowOutput] = useState(false);

  return (
    <div className="border-t border-slate-100 dark:border-slate-700/60 mt-1">
      {result.error && (
        <div className="mx-4 mt-3 p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50">
          <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider mb-1">Error</p>
          <p className="text-xs text-red-700 dark:text-red-400 break-words whitespace-pre-wrap">
            {result.error}
          </p>
        </div>
      )}
      {result.output !== null && result.output !== undefined && (
        <div className="mx-4 mt-3 mb-3">
          <button
            onClick={() => setShowOutput((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider hover:text-slate-600 dark:hover:text-slate-300"
          >
            {showOutput ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            Output
          </button>
          {showOutput && (
            <pre className="mt-2 text-xs font-mono text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 rounded-md p-2 overflow-auto max-h-60 whitespace-pre-wrap break-all">
              {JSON.stringify(result.output, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ReplayNodeConfigPanelProps {
  node: CanvasNode;
  result?: NodeResult;
}

export function ReplayNodeConfigPanel({ node, result }: ReplayNodeConfigPanelProps) {
  const nodeType = node.data.nodeType;
  const nodeLabel = node.data.label;

  // Prefer resolvedInput from execution result; fall back to raw node config
  const configToShow = (result?.resolvedInput as Record<string, unknown> | undefined)
    ?? (node.data.config as Record<string, unknown>);

  const entries = Object.entries(configToShow ?? {}).filter(([, v]) => {
    if (v === null || v === undefined || v === '') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#1e1e2e] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-slate-100 dark:bg-slate-800 shrink-0">
          <NodeIcon type={nodeType} size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
            {nodeLabel}
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 capitalize">
            {nodeType} node
          </p>
        </div>
      </div>

      {/* Status banner */}
      {result && <StatusBanner result={result} />}

      {/* Config fields */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex items-center justify-center h-24">
            <p className="text-xs text-slate-400">No configuration details</p>
          </div>
        ) : (
          <div className="py-1">
            {entries.map(([key, value]) => {
              if (CREDENTIAL_KEYS.has(key)) {
                return (
                  <FieldRow
                    key={key}
                    label={humanizeKey(key)}
                    value="••••••••"
                    isEnum={false}
                  />
                );
              }
              return (
                <FieldRow
                  key={key}
                  label={humanizeKey(key)}
                  value={value}
                  isEnum={ENUM_KEYS.has(key)}
                />
              );
            })}
          </div>
        )}

        {/* Output / error section */}
        {result && <OutputSection result={result} />}

        {/* No result yet */}
        {!result && (
          <div className="mx-4 mt-4 p-3 rounded-md bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/50">
            <p className="text-xs text-slate-400">This node was not reached in the execution.</p>
          </div>
        )}
      </div>

      {/* Read-only footer */}
      <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 shrink-0">
        <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
          Read-only — Execution snapshot
        </p>
      </div>
    </div>
  );
}

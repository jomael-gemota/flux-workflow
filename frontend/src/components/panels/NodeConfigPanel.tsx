import { Settings2, Star, Braces, Play, Loader2, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Clock, Copy, Check, ArrowRight, Power, X, AlertTriangle, Save } from 'lucide-react';
import { useRef, useState, useEffect, useMemo } from 'react';
import { useWorkflowStore } from '../../store/workflowStore';
import type { CanvasNode } from '../../store/workflowStore';
import { Select } from '../ui/Input';
import { useTestNode, useNodeTestResults } from '../../hooks/useNodeTest';
import type { NodeTestResult } from '../../types/workflow';
import { useCredentialList } from '../../hooks/useCredentials';
import { useSaveWorkflow } from '../../hooks/useSaveWorkflow';
import { useSlackChannels, useSlackUsers } from '../../hooks/useSlackData';
import { useTeamsTeams, useTeamsChannels, useTeamsUsers } from '../../hooks/useTeamsData';
import { useBasecampProjects, useBasecampTodolists, useBasecampTodos, useBasecampTodoGroups, useBasecampPeople } from '../../hooks/useBasecampData';
import { NodeIcon } from '../nodes/NodeIcons';

// ── Output field catalogue (human-friendly labels per node type) ──────────────

interface OutputField {
  key: string;
  label: string;
}

const NODE_OUTPUT_FIELDS: Record<string, OutputField[]> = {
  trigger: [
    { key: 'triggerType', label: 'Trigger type (manual/webhook/cron/…)' },
    { key: 'triggeredAt', label: 'Trigger timestamp (ISO)' },
    { key: 'body', label: 'Request body (webhook)' },
    { key: 'headers', label: 'Request headers (webhook)' },
    { key: 'query', label: 'Query params (webhook)' },
    { key: 'scheduledAt', label: 'Scheduled time (cron)' },
  ],
  http: [
    { key: 'status', label: 'HTTP status code' },
    { key: 'body', label: 'Full response body (JSON)' },
    { key: 'headers', label: 'Response headers' },
  ],
  llm: [
    { key: 'content', label: 'AI response text' },
    { key: 'model', label: 'Model used' },
    { key: 'usage.totalTokens', label: 'Total tokens used' },
    { key: 'usage.promptTokens', label: 'Prompt tokens' },
    { key: 'usage.completionTokens', label: 'Completion tokens' },
  ],
  condition: [
    { key: 'result', label: 'Condition result (true / false)' },
    { key: 'nextNodeId', label: 'Next node ID' },
  ],
  switch: [
    { key: 'matchedCase', label: 'Matched case label' },
    { key: 'nextNodeId', label: 'Next node ID' },
  ],
  transform: [{ key: '…', label: 'Use the key names you defined in Mappings' }],
  output: [{ key: 'value', label: 'Resolved output value' }],
  gmail: [
    { key: 'messageId', label: 'Message ID (send)' },
    { key: 'messages', label: 'Message list (list)' },
    { key: 'body', label: 'Email body text (read)' },
    { key: 'subject', label: 'Subject (read)' },
    { key: 'from', label: 'From address (read)' },
  ],
  gdrive: [
    { key: 'files', label: 'File list (list)' },
    { key: 'id', label: 'Uploaded file ID (upload)' },
    { key: 'content', label: 'File content text (download)' },
  ],
  gdocs: [
    { key: 'documentId', label: 'Document ID' },
    { key: 'title', label: 'Document title' },
    { key: 'text', label: 'Document text content (read)' },
    { key: 'url', label: 'Edit URL (create)' },
  ],
  gsheets: [
    { key: 'data', label: 'Rows as objects (read)' },
    { key: 'headers', label: 'Column headers (read)' },
    { key: 'rows', label: 'Raw rows array (read)' },
    { key: 'updatedRows', label: 'Rows updated (write/append)' },
  ],
  basecamp: [
    { key: 'id', label: 'Created/matched resource ID' },
    { key: 'title', label: 'To-do title (create)' },
    { key: 'status', label: 'Action status (created/posted/sent)' },
    { key: 'completed', label: 'Completion flag (complete/uncomplete)' },
    { key: 'todos', label: 'To-do list (list_todos)' },
    { key: 'count', label: 'To-do count (list_todos)' },
  ],
};

// ── "No data" badge ───────────────────────────────────────────────────────────

function NoDataBadge() {
  return (
    <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700/40">
      no data
    </span>
  );
}

// Render a value preview — short and readable
function ValuePreview({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return <NoDataBadge />;
  if (Array.isArray(value)) {
    if (value.length === 0) return <NoDataBadge />;
    return (
      <span className="text-slate-500 dark:text-slate-400">[{value.length} item{value.length !== 1 ? 's' : ''}]</span>
    );
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    if (keys.length === 0) return <NoDataBadge />;
    return <span className="text-slate-500 dark:text-slate-400">{'{'}{keys.slice(0, 2).join(', ')}{keys.length > 2 ? ', …' : ''}{'}'}</span>;
  }
  const str = String(value);
  return (
    <span className="text-emerald-400 font-mono">
      {str.length > 40 ? str.slice(0, 40) + '…' : str}
    </span>
  );
}

// ── Expression display helpers ────────────────────────────────────────────────

const NODE_TYPE_LABEL: Record<string, string> = {
  http: 'HTTP', llm: 'AI', trigger: 'Trigger', condition: 'Condition',
  switch: 'Switch', transform: 'Transform', output: 'Output',
  gmail: 'Gmail', gdrive: 'Drive', gdocs: 'Docs', gsheets: 'Sheets',
  basecamp: 'Basecamp',
};

function nodeTypeLabel(type: string) {
  return NODE_TYPE_LABEL[type] ?? type.toUpperCase();
}

type ExprSegment =
  | { kind: 'text'; text: string }
  | { kind: 'expr'; nodeType: string; nodeName: string; field: string };

function parseExprSegments(value: string, nodes: CanvasNode[]): ExprSegment[] {
  const parts = value.split(/(\{\{nodes\.[^}]+\}\})/g);
  return parts.flatMap((part): ExprSegment[] => {
    const m = part.match(/^\{\{nodes\.([^.}]+)\.([^}]+)\}\}$/);
    if (m) {
      const node = nodes.find(n => n.id === m[1]);
      return [{
        kind: 'expr',
        nodeType: node?.data.nodeType ?? '',
        nodeName: node?.data.label ?? m[1],
        field: m[2],
      }];
    }
    return part ? [{ kind: 'text', text: part }] : [];
  });
}

const EXPR_RE = /\{\{nodes\.[^}]+\}\}/;

function ExprToken({ nodeType, nodeName, field }: { nodeType: string; nodeName: string; field: string }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 border border-blue-300 dark:border-blue-700/50 text-[10px] font-medium mx-0.5 align-middle whitespace-nowrap">
      <span className="text-blue-600 dark:text-blue-400 font-bold uppercase text-[9px]">{nodeTypeLabel(nodeType)}</span>
      <span className="text-slate-400 dark:text-slate-500">·</span>
      <span className="text-gray-800 dark:text-slate-200">{nodeName}</span>
      <span className="text-slate-400 dark:text-slate-500">·</span>
      <span className="font-mono text-blue-600 dark:text-blue-300">{field}</span>
    </span>
  );
}

function DisplayValue({ value, nodes, placeholder }: { value: string; nodes: CanvasNode[]; placeholder?: string }) {
  if (!value) return <span className="text-slate-400 dark:text-slate-500 text-xs italic">{placeholder ?? ''}</span>;
  const segs = parseExprSegments(value, nodes);
  return (
    <>
      {segs.map((seg, i) =>
        seg.kind === 'text'
          ? <span key={i} className="text-gray-800 dark:text-slate-200 text-xs">{seg.text}</span>
          : <ExprToken key={i} nodeType={seg.nodeType} nodeName={seg.nodeName} field={seg.field} />
      )}
    </>
  );
}

// ── Variable picker panel ─────────────────────────────────────────────────────

function VariablePickerPanel({
  nodes,
  testResults,
  onInsert,
}: {
  nodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
  onInsert: (expression: string) => void;
}) {
  if (nodes.length === 0) return null;

  return (
    <div className="mt-1 border border-blue-800/50 rounded-md overflow-hidden shadow-lg">
      <div className="bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 border-b border-slate-200 dark:border-slate-700">
        <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider">
          Click a field to insert it
        </p>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
          The expression will be placed at your cursor position.
        </p>
      </div>

      <div className="max-h-60 overflow-y-auto">
        {nodes.map((n) => {
          const testResult = testResults[n.id];
          const realOutput = testResult?.status === 'success' && testResult.output != null
            ? (testResult.output as Record<string, unknown>)
            : null;

          // Build field list from real test output if available, otherwise use generic catalogue
          const fields: Array<{ key: string; label: string; realValue?: unknown; hasReal: boolean }> =
            realOutput
              ? Object.entries(realOutput).map(([key, val]) => ({
                  key,
                  label: key,
                  realValue: val,
                  hasReal: true,
                }))
              : (NODE_OUTPUT_FIELDS[n.data.nodeType] ?? []).map((f) => ({
                  ...f,
                  hasReal: false,
                }));

          return (
            <div key={n.id} className="px-2.5 py-2 border-b border-slate-800/60 last:border-0">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    n.data.nodeType === 'http' ? 'bg-blue-400' :
                    n.data.nodeType === 'llm' ? 'bg-emerald-400' :
                    n.data.nodeType === 'trigger' ? 'bg-violet-400' :
                    n.data.nodeType === 'transform' ? 'bg-cyan-400' :
                    n.data.nodeType === 'condition' ? 'bg-amber-400' :
                    n.data.nodeType === 'switch' ? 'bg-orange-400' :
                    'bg-rose-400'
                  }`}
                />
                <span className="text-[11px] font-semibold text-gray-900 dark:text-white truncate">{n.data.label}</span>
                <span className="text-[9px] text-slate-400 dark:text-slate-500 shrink-0">{n.data.nodeType}</span>
                {realOutput && (
                  <span className="text-[9px] text-emerald-500 shrink-0 ml-auto">● tested</span>
                )}
                {!realOutput && (
                  <span className="text-[9px] text-slate-600 shrink-0 ml-auto italic">test to see real fields</span>
                )}
              </div>

              <div className="flex flex-wrap gap-1">
                {n.data.nodeType === 'transform' && !realOutput ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onInsert(`{{nodes.${n.id}.YOUR_KEY}}`)}
                      className="inline-flex items-center gap-1 text-[10px] bg-slate-200 dark:bg-slate-700 hover:bg-blue-700 text-emerald-600 dark:text-emerald-300 hover:text-white rounded px-1.5 py-0.5 font-mono transition-colors"
                      title="Replace YOUR_KEY with your mapping key name"
                    >
                      .YOUR_KEY
                    </button>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 self-center">← replace with your mapping key</span>
                  </>
                ) : fields.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => onInsert(`{{nodes.${n.id}}}`)}
                    className="text-[10px] bg-slate-200 dark:bg-slate-700 hover:bg-blue-700 text-emerald-600 dark:text-emerald-300 hover:text-white rounded px-1.5 py-0.5 font-mono transition-colors"
                  >
                    {`{{nodes.${n.id}}}`}
                  </button>
                ) : (
                  fields.map((f) => (
                    f.key === '…' ? null : (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => onInsert(`{{nodes.${n.id}.${f.key}}}`)}
                        title={`Inserts: {{nodes.${n.id}.${f.key}}}`}
                        className="inline-flex items-center gap-1 text-[10px] bg-slate-200 dark:bg-slate-700 hover:bg-blue-700 text-emerald-600 dark:text-emerald-300 hover:text-white rounded px-1.5 py-0.5 transition-colors font-mono"
                      >
                        <span>.{f.key}</span>
                        {f.hasReal ? (
                          <span className="font-sans text-slate-500 dark:text-slate-400 group-hover:text-gray-800 dark:group-hover:text-slate-200 ml-0.5">
                            = <ValuePreview value={f.realValue} />
                          </span>
                        ) : (
                          <span className="font-sans text-slate-400 dark:text-slate-500 ml-0.5">{f.label}</span>
                        )}
                      </button>
                    )
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Helper: insert text at cursor ─────────────────────────────────────────────

function insertAtCursor(
  el: HTMLTextAreaElement | HTMLInputElement,
  text: string,
  currentValue: string,
  onChange: (v: string) => void
) {
  const start = el.selectionStart ?? currentValue.length;
  const end = el.selectionEnd ?? currentValue.length;
  const next = currentValue.slice(0, start) + text + currentValue.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    el.selectionStart = start + text.length;
    el.selectionEnd = start + text.length;
    el.focus();
  });
}

// ── ExpressionTextArea ────────────────────────────────────────────────────────

function ExpressionTextArea({
  label,
  value,
  rows = 3,
  placeholder,
  onChange,
  nodes,
  testResults,
}: {
  label: string;
  value: string;
  rows?: number;
  placeholder?: string;
  onChange: (v: string) => void;
  nodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const showDisplay = !focused && !open && EXPR_RE.test(value);

  function handleInsert(expr: string) {
    setFocused(true);
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus();
        insertAtCursor(ref.current, expr, value, onChange);
      } else {
        onChange(value + expr);
      }
    });
    setOpen(false);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
        {nodes.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((p) => !p)}
            title="Insert a variable from another node"
            className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors shrink-0 ${
              open ? 'bg-blue-600 text-white' : 'text-blue-500 dark:text-blue-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Braces className="w-2.5 h-2.5" />
            Insert variable
          </button>
        )}
      </div>

      {/* Display mode: readable tokens when blurred */}
      {showDisplay && (
        <div
          onClick={() => { setFocused(true); requestAnimationFrame(() => ref.current?.focus()); }}
          className="w-full min-h-[56px] flex flex-wrap items-start gap-y-1 content-start bg-slate-100 dark:bg-slate-800 border border-slate-600 hover:border-slate-500 rounded-md px-2.5 py-1.5 cursor-text"
          title="Click to edit"
        >
          <DisplayValue value={value} nodes={nodes} placeholder={placeholder} />
        </div>
      )}

      {/* Raw textarea — always mounted but visually hidden in display mode */}
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none ${showDisplay ? 'sr-only' : ''}`}
      />
      {open && (
        <VariablePickerPanel nodes={nodes} testResults={testResults} onInsert={handleInsert} />
      )}
    </div>
  );
}

// ── ExpressionInput ───────────────────────────────────────────────────────────

function ExpressionInput({
  label,
  value,
  placeholder,
  onChange,
  nodes,
  testResults,
  hint,
}: {
  label?: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  nodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const showDisplay = !focused && !open && EXPR_RE.test(value);

  function handleInsert(expr: string) {
    setFocused(true);
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.focus();
        insertAtCursor(ref.current, expr, value, onChange);
      } else {
        onChange(value + expr);
      }
    });
    setOpen(false);
  }

  return (
    <div className="space-y-1">
      {(label || nodes.length > 0) && (
        <div className="flex items-center justify-between gap-1">
          {label && <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>}
          {nodes.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((p) => !p)}
              title="Insert a variable from another node"
              className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors shrink-0 ${
                open ? 'bg-blue-600 text-white' : 'text-blue-500 dark:text-blue-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Braces className="w-2.5 h-2.5" />
              Insert variable
            </button>
          )}
        </div>
      )}

      {/* Display mode: readable tokens when blurred */}
      {showDisplay && (
        <div
          onClick={() => { setFocused(true); requestAnimationFrame(() => ref.current?.focus()); }}
          className="w-full min-h-[30px] flex flex-wrap items-center gap-y-0.5 bg-slate-100 dark:bg-slate-800 border border-slate-600 hover:border-slate-500 rounded-md px-2.5 py-1.5 cursor-text"
          title="Click to edit"
        >
          <DisplayValue value={value} nodes={nodes} placeholder={placeholder} />
        </div>
      )}

      {/* Raw input — always mounted but visually hidden in display mode */}
      <input
        ref={ref}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 ${showDisplay ? 'sr-only' : ''}`}
      />
      {hint && <p className="text-slate-400 dark:text-slate-500 text-[10px]">{hint}</p>}
      {open && (
        <VariablePickerPanel nodes={nodes} testResults={testResults} onInsert={handleInsert} />
      )}
    </div>
  );
}

// ── Node test result display ──────────────────────────────────────────────────

/** One-click copy button with a brief "✓ Copied" confirmation */
function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy to clipboard"
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className={`p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-slate-400 dark:text-slate-500 hover:text-gray-800 dark:hover:text-slate-200 ${className}`}
    >
      {copied
        ? <Check  className="w-3 h-3 text-emerald-400" />
        : <Copy   className="w-3 h-3" />}
    </button>
  );
}

/** Shared header strip shown on every test result card */
function ResultHeader({ result }: { result: NodeTestResult }) {
  const ranAt = result.ranAt ? new Date(result.ranAt).toLocaleTimeString() : null;
  return (
    <div className={`flex items-center justify-between px-3 py-2 ${
      result.status === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/30' : 'bg-red-50 dark:bg-red-900/30'
    }`}>
      <div className="flex items-center gap-1.5">
        {result.status === 'success'
          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          : <AlertCircle  className="w-3.5 h-3.5 text-red-400" />}
        <span className={`text-[11px] font-semibold ${
          result.status === 'success' ? 'text-emerald-400' : 'text-red-400'
        }`}>
          {result.status === 'success' ? 'Test passed' : 'Test failed'}
        </span>
      </div>
      <div className="flex items-center gap-2.5 text-[10px] text-slate-400 dark:text-slate-500">
        {ranAt && <span>{ranAt}</span>}
        <div className="flex items-center gap-0.5">
          <Clock className="w-2.5 h-2.5" />
          <span>{result.durationMs} ms</span>
        </div>
      </div>
    </div>
  );
}

// ── HTTP result ───────────────────────────────────────────────────────────────

function HttpResultDisplay({ result }: { result: NodeTestResult }) {
  const [headersOpen, setHeadersOpen] = useState(false);
  const out = (result.output ?? {}) as { status?: number; body?: unknown; headers?: Record<string, string> };
  const httpOk = out.status != null && out.status >= 200 && out.status < 300;
  const bodyStr = out.body != null ? JSON.stringify(out.body, null, 2) : null;

  return (
    <div className="p-3 space-y-3">
      {/* Status code */}
      {out.status != null && (
        <div className="flex items-center gap-3">
          <span className={`text-3xl font-bold tabular-nums leading-none ${
            httpOk ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {out.status}
          </span>
          <div>
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
              {httpOk ? 'Request succeeded' : 'Request failed'}
            </p>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">HTTP status code</p>
          </div>
        </div>
      )}

      {/* Response body */}
      {bodyStr && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Response data
            </span>
            <CopyButton text={bodyStr} />
          </div>
          <pre className="bg-slate-100 dark:bg-slate-800 rounded-md p-2.5 text-[10px] text-slate-700 dark:text-slate-300 font-mono overflow-auto max-h-44 leading-relaxed whitespace-pre-wrap break-all">
            {bodyStr}
          </pre>
        </div>
      )}

      {/* Headers — collapsible */}
      {out.headers && Object.keys(out.headers).length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setHeadersOpen((p) => !p)}
            className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
          >
            {headersOpen
              ? <ChevronUp   className="w-3 h-3" />
              : <ChevronDown className="w-3 h-3" />}
            Response headers ({Object.keys(out.headers).length})
          </button>
          {headersOpen && (
            <div className="mt-1 space-y-0.5 bg-slate-100 dark:bg-slate-800 rounded p-2">
              {Object.entries(out.headers).map(([k, v]) => (
                <div key={k} className="flex gap-1 text-[10px]">
                  <span className="text-slate-400 dark:text-slate-500 shrink-0 min-w-0">{k}:</span>
                  <span className="text-slate-500 dark:text-slate-400 break-all">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── LLM result ────────────────────────────────────────────────────────────────

function LLMResultDisplay({ result }: { result: NodeTestResult }) {
  const out = (result.output ?? {}) as {
    content?: string;
    model?: string;
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  };

  return (
    <div className="p-3 space-y-3">
      {/* AI reply — the most important thing */}
      {out.content && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              AI Response
            </span>
            <CopyButton text={out.content} />
          </div>
          <div className="bg-slate-100 dark:bg-slate-800 rounded-md p-2.5 border-l-2 border-blue-500">
            <p className="text-xs text-gray-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
              {out.content}
            </p>
          </div>
        </div>
      )}

      {/* Stats strip */}
      <div className="flex flex-wrap gap-3 text-[10px] text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800/50 rounded px-2.5 py-2">
        {out.model && (
          <span>
            <span className="text-slate-500 dark:text-slate-400 font-medium">Model </span>
            {out.model}
          </span>
        )}
        {out.usage?.totalTokens != null && (
          <span>
            <span className="text-slate-500 dark:text-slate-400 font-medium">Tokens </span>
            {out.usage.totalTokens}
            {out.usage.promptTokens != null && (
              <span className="text-slate-600 ml-1">
                ({out.usage.promptTokens} prompt + {out.usage.completionTokens} reply)
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Condition result ──────────────────────────────────────────────────────────

function ConditionResultDisplay({ result }: { result: NodeTestResult }) {
  const out = (result.output ?? {}) as { result?: boolean; nextNodeId?: string };
  const passed = out.result === true;

  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-3">
        <span className={`text-2xl font-bold ${passed ? 'text-emerald-400' : 'text-amber-400'}`}>
          {passed ? 'TRUE' : 'FALSE'}
        </span>
        <p className="text-xs text-slate-700 dark:text-slate-300 leading-snug">
          {passed
            ? 'Condition was met — takes the true branch'
            : 'Condition was not met — takes the false branch'}
        </p>
      </div>
      {out.nextNodeId && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
          <ArrowRight className="w-3 h-3 shrink-0" />
          Routes to node{' '}
          <span className="font-mono text-slate-500 dark:text-slate-400">{out.nextNodeId}</span>
        </div>
      )}
    </div>
  );
}

// ── Switch result ─────────────────────────────────────────────────────────────

function SwitchResultDisplay({ result }: { result: NodeTestResult }) {
  const out = (result.output ?? {}) as { matchedCase?: string; nextNodeId?: string };
  const isDefault = !out.matchedCase || out.matchedCase === 'default';

  return (
    <div className="p-3 space-y-2">
      <div>
        <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
          Matched case
        </p>
        <span className={`inline-block px-2.5 py-1 rounded text-xs font-semibold ${
          isDefault
            ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
            : 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700/40'
        }`}>
          {out.matchedCase ?? 'default'}
        </span>
      </div>
      {out.nextNodeId && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
          <ArrowRight className="w-3 h-3 shrink-0" />
          Routes to{' '}
          <span className="font-mono text-slate-500 dark:text-slate-400">{out.nextNodeId}</span>
        </div>
      )}
    </div>
  );
}

// ── Generic result (transform / output / trigger / fallback) ──────────────────

function GenericResultDisplay({ result }: { result: NodeTestResult }) {
  const out = result.output;
  const outStr = JSON.stringify(out, null, 2);

  if (typeof out === 'string') {
    return (
      <div className="p-3 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Output</span>
          <CopyButton text={out} />
        </div>
        <div className="bg-slate-100 dark:bg-slate-800 rounded-md p-2.5">
          <p className="text-xs text-gray-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">{out}</p>
        </div>
      </div>
    );
  }

  if (typeof out === 'object' && out !== null) {
    const entries = Object.entries(out as Record<string, unknown>);
    return (
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Output — {entries.length} field{entries.length !== 1 ? 's' : ''}
          </span>
          <CopyButton text={outStr} />
        </div>
        <div className="space-y-1">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-start gap-2 bg-slate-100 dark:bg-slate-800 rounded px-2.5 py-1.5">
              <span className="text-[10px] font-mono text-blue-400 shrink-0 pt-0.5 min-w-[60px]">{k}</span>
              <span className="text-[10px] text-slate-700 dark:text-slate-300 break-all min-w-0 flex-1">
                {v == null
                  ? <span className="text-slate-600 italic">empty</span>
                  : typeof v === 'boolean'
                    ? <span className={v ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                        {v ? 'true' : 'false'}
                      </span>
                    : typeof v === 'object'
                      ? <span className="text-slate-500 dark:text-slate-400 font-mono">{JSON.stringify(v)}</span>
                      : <span>{String(v)}</span>
                }
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Primitive or null
  return (
    <div className="p-3 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Output</span>
        {out != null && <CopyButton text={String(out)} />}
      </div>
      <p className="text-xs text-gray-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded px-2.5 py-2">
        {out == null
          ? <span className="italic text-slate-600">No output</span>
          : String(out)}
      </p>
    </div>
  );
}

// ── Main result wrapper — routes to the right display per node type ────────────

function TestResultDisplay({ result, nodeType }: { result: NodeTestResult; nodeType: string }) {
  return (
    <div className={`rounded-md border overflow-hidden ${
      result.status === 'success' ? 'border-emerald-800/50' : 'border-red-800/50'
    }`}>
      <ResultHeader result={result} />

      {/* Error detail */}
      {result.status === 'failure' && result.error && (
        <div className="p-3 bg-red-50 dark:bg-red-950/20 space-y-1">
          <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">What went wrong</p>
          <p className="text-xs text-red-600 dark:text-red-300 break-words leading-relaxed">{result.error}</p>
        </div>
      )}

      {/* Success output — node-type-aware */}
      {result.status === 'success' && result.output != null && (
        <div className="bg-slate-50 dark:bg-slate-900/80">
          {nodeType === 'http'      && <HttpResultDisplay      result={result} />}
          {nodeType === 'llm'       && <LLMResultDisplay       result={result} />}
          {nodeType === 'condition' && <ConditionResultDisplay result={result} />}
          {nodeType === 'switch'    && <SwitchResultDisplay    result={result} />}
          {nodeType !== 'http' && nodeType !== 'llm' &&
           nodeType !== 'condition' && nodeType !== 'switch' && (
            <GenericResultDisplay result={result} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Node test panel ───────────────────────────────────────────────────────────

function NodeTestPanel({
  nodeId,
  workflowId,
  nodeType,
  savedResult,
}: {
  nodeId: string;
  workflowId: string;
  nodeType: string;
  savedResult: NodeTestResult | null;
}) {
  const [open, setOpen] = useState(false);
  const [localResult, setLocalResult] = useState<NodeTestResult | null>(null);
  const testNode = useTestNode();
  const { save: saveWorkflow } = useSaveWorkflow();

  const displayResult = localResult ?? savedResult;

  async function handleRun() {
    // Always persist the latest in-memory config before executing so the
    // backend runs with exactly what the user currently sees in the panel.
    await saveWorkflow();
    const result = await testNode.mutateAsync({ workflowId, nodeId });
    setLocalResult(result);
  }

  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-750 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <Play className="w-3 h-3 text-blue-400" />
          <span className="text-[10px] font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
            Test this node
          </span>
          {displayResult && (
            <span className={`w-1.5 h-1.5 rounded-full ${
              displayResult.status === 'success' ? 'bg-emerald-400' : 'bg-red-400'
            }`} />
          )}
        </div>
        {open ? <ChevronUp className="w-3 h-3 text-slate-400 dark:text-slate-500" /> : <ChevronDown className="w-3 h-3 text-slate-400 dark:text-slate-500" />}
      </button>

      {open && (
        <div className="p-2.5 space-y-2.5 bg-slate-50 dark:bg-slate-900/60">
          {/* Run button */}
          <button
            type="button"
            onClick={handleRun}
            disabled={testNode.isPending}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 dark:text-white rounded text-xs font-medium transition-colors"
          >
            {testNode.isPending
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Running…</>
              : <><Play className="w-3 h-3" /> Run node</>
            }
          </button>

          {/* Last result */}
          {displayResult && <TestResultDisplay result={displayResult} nodeType={nodeType} />}

          {!displayResult && !testNode.isPending && (
            <p className="text-[10px] text-slate-600 text-center italic">
              No test run yet — click Run node to see output.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Dependency scanner ────────────────────────────────────────────────────────

/** Recursively search any config value for {{nodes.<targetId>. expressions. */
function configReferencesNode(obj: unknown, targetId: string): boolean {
  if (typeof obj === 'string') {
    return new RegExp(`\\{\\{\\s*nodes\\.${targetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`).test(obj);
  }
  if (Array.isArray(obj)) return obj.some(v => configReferencesNode(v, targetId));
  if (obj !== null && typeof obj === 'object') {
    return Object.values(obj as Record<string, unknown>).some(v => configReferencesNode(v, targetId));
  }
  return false;
}

/** Returns all nodes (excluding the target itself) whose config references the target node's output. */
function findDependentsOf(targetId: string, allNodes: CanvasNode[]): CanvasNode[] {
  return allNodes.filter(n => n.id !== targetId && configReferencesNode(n.data.config, targetId));
}

// ── Disable confirmation modal ────────────────────────────────────────────────

function DisableNodeWarningModal({
  open,
  nodeName,
  dependents,
  isLoading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  nodeName: string;
  dependents: CanvasNode[];
  isLoading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[1px]" onClick={onCancel} />

      {/* Dialog */}
      <div className="relative bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5">
        <button
          onClick={onCancel}
          className="absolute top-3 right-3 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-start gap-3 pr-5">
          <div className="w-8 h-8 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Node output is in use</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
              <span className="font-medium text-gray-800 dark:text-slate-200">"{nodeName}"</span> is referenced by{' '}
              <span className="font-medium text-amber-600 dark:text-amber-300">{dependents.length} node{dependents.length !== 1 ? 's' : ''}</span>.
              Disabling it will cause those nodes to fail with an error when the workflow runs.
            </p>
          </div>
        </div>

        {/* Dependent node list */}
        <div className="mt-3.5 space-y-1.5 max-h-44 overflow-y-auto">
          {dependents.map(dep => (
            <div
              key={dep.id}
              className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900/70 rounded-md border border-slate-200 dark:border-slate-700/50"
            >
              <span className="shrink-0 opacity-70">
                <NodeIcon type={dep.data.nodeType} size={12} />
              </span>
              <span className="text-xs font-medium text-gray-800 dark:text-slate-200 truncate flex-1">{dep.data.label}</span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 uppercase tracking-wide">{dep.data.nodeType}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors disabled:opacity-50"
          >
            {isLoading && <Loader2 className="w-3 h-3 animate-spin" />}
            Disable anyway
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface NodeDraft {
  label: string;
  config: Record<string, unknown>;
  retries: number | undefined;
  retryDelayMs: number | undefined;
  timeoutMs: number | undefined;
}

export function NodeConfigPanel() {
  const { nodes, selectedNodeId, setNodes, setSelectedNodeId, setDirty, activeWorkflow, setActiveWorkflow } =
    useWorkflowStore();

  const { save: saveWorkflow, isSaving: isSavingDisabled } = useSaveWorkflow();

  // ── Local draft — buffers config changes until the user explicitly saves ─────
  const [draft, setDraft] = useState<NodeDraft | null>(null);
  // originalSnapshot is a STATE (not a ref) so updating it after save
  // triggers a re-render and isDirtyLocal correctly recomputes to false.
  const [originalSnapshot, setOriginalSnapshot] = useState<NodeDraft | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isSavingNode, setIsSavingNode] = useState(false);

  // Reset draft whenever a different node is selected
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const node = nodes.find((n) => n.id === selectedNodeId);
    if (!node) { setDraft(null); setOriginalSnapshot(null); return; }
    const snapshot: NodeDraft = {
      label: node.data.label,
      config: { ...(node.data.config as Record<string, unknown>) },
      retries: node.data.retries,
      retryDelayMs: node.data.retryDelayMs,
      timeoutMs: node.data.timeoutMs,
    };
    setOriginalSnapshot({ ...snapshot, config: { ...snapshot.config } });
    setDraft({ ...snapshot, config: { ...snapshot.config } });
    setSaveSuccess(false);
    setIsSavingNode(false);
  }, [selectedNodeId]); // intentionally omits `nodes` — only reset on selection change

  // State for the disable-confirmation modal (must be before any early return)
  const [disableModal, setDisableModal] = useState<{ open: boolean; dependents: CanvasNode[] }>({
    open: false,
    dependents: [],
  });

  const isUnsaved = !activeWorkflow?.id || activeWorkflow.id.startsWith('__new__');
  const { data: testResults = {} } = useNodeTestResults(
    isUnsaved ? null : activeWorkflow?.id
  );

  // ── isDirtyLocal must be declared BEFORE the early return so hook order is stable ──
  // Depends on both `draft` AND `originalSnapshot` so it recomputes when either changes.
  const isDirtyLocal = useMemo(() => {
    if (!draft || !originalSnapshot) return false;
    return (
      draft.label !== originalSnapshot.label ||
      JSON.stringify(draft.config) !== JSON.stringify(originalSnapshot.config) ||
      draft.retries !== originalSnapshot.retries ||
      draft.retryDelayMs !== originalSnapshot.retryDelayMs ||
      draft.timeoutMs !== originalSnapshot.timeoutMs
    );
  }, [draft, originalSnapshot]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-600 gap-2 px-4 text-center">
        <Settings2 className="w-8 h-8" />
        <p className="text-xs">Click a node to edit its configuration</p>
      </div>
    );
  }

  const { data } = selectedNode;
  const nodeType = data.nodeType as string;

  function updateConfig(patch: Record<string, unknown>) {
    setDraft((prev) => prev ? { ...prev, config: { ...prev.config, ...patch } } : prev);
  }

  function updateData(patch: Partial<typeof data>) {
    const updated = nodes.map((n) =>
      n.id === selectedNodeId ? { ...n, data: { ...n.data, ...patch } } : n
    );
    setNodes(updated);
  }

  async function doDisable() {
    updateData({ disabled: true });
    if (!isUnsaved) {
      try { await saveWorkflow(); } catch { /* silent */ }
    }
  }

  async function toggleDisabled() {
    if (data.disabled) {
      // Re-enabling: no confirmation needed
      updateData({ disabled: false });
      if (!isUnsaved) {
        try { await saveWorkflow(); } catch { /* silent */ }
      }
      return;
    }

    // Disabling: check whether any other node's config references this node's output
    const dependents = findDependentsOf(selectedNodeId!, nodes);
    if (dependents.length === 0) {
      // No downstream references — disable immediately
      await doDisable();
    } else {
      // Prompt the user with the list of affected nodes
      setDisableModal({ open: true, dependents });
    }
  }

  async function confirmDisable() {
    setDisableModal(prev => ({ ...prev, open: false }));
    await doDisable();
  }

  function toggleEntry() {
    const willBeEntry = !data.isEntry;
    // First pass: flip isEntry for the selected node
    const afterToggle = nodes.map((n) =>
      n.id === selectedNodeId ? { ...n, data: { ...n.data, isEntry: willBeEntry } } : n
    );
    // Second pass: recompute isParallelEntry for all nodes
    const entryCount = afterToggle.filter(n => n.data.isEntry).length;
    const updated = afterToggle.map((n) => ({
      ...n,
      data: { ...n.data, isParallelEntry: n.data.isEntry && entryCount > 1 },
    }));
    setNodes(updated);

    // Keep activeWorkflow.entryNodeId pointing to at least one entry node
    if (activeWorkflow) {
      const newEntryIds = updated.filter(n => n.data.isEntry).map(n => n.id);
      const primary = newEntryIds[0] ?? activeWorkflow.entryNodeId;
      setActiveWorkflow({ ...activeWorkflow, entryNodeId: primary });
    }
  }

  async function handleNodeSave() {
    if (!draft) return;
    setIsSavingNode(true);

    // Commit draft values into the global store
    setNodes(nodes.map((n) =>
      n.id === selectedNodeId
        ? {
            ...n,
            data: {
              ...n.data,
              label: draft.label,
              config: draft.config,
              retries: draft.retries ?? 0,
              retryDelayMs: draft.retryDelayMs ?? 0,
              timeoutMs: draft.timeoutMs,
            },
          }
        : n
    ));
    // Immediately clear the global dirty flag so the Toolbar "Save Workflow"
    // button doesn't flicker active during the async save below.
    setDirty(false);

    try {
      await saveWorkflow();
      // Update the original snapshot → isDirtyLocal recomputes to false
      setOriginalSnapshot({ ...draft, config: { ...draft.config } });
      setSaveSuccess(true);
      setIsSavingNode(false);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      setIsSavingNode(false);
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function handleNodeCancel() {
    // Reset draft to last-saved snapshot, then deselect / close the config panel
    if (originalSnapshot) {
      setDraft({ ...originalSnapshot, config: { ...originalSnapshot.config } });
    }
    setSelectedNodeId(null);
  }

  const entryCount = nodes.filter(n => n.data.isEntry).length;
  // Use draft config for the form; fall back to store until draft is initialised
  const cfg = (draft?.config ?? data.config) as Record<string, unknown>;
  const otherNodes = nodes.filter((n) => n.id !== selectedNodeId);
  const savedTestResult = selectedNodeId ? (testResults[selectedNodeId] ?? null) : null;

  return (
    <div className="flex flex-col min-h-full">
    {/* Scrollable config body */}
    <div className="p-4 space-y-4 flex-1">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="min-w-0 flex-1 mr-2">
          <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            {nodeType}
            {isDirtyLocal && (
              <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-semibold bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-500/30">
                ● unsaved
              </span>
            )}
          </p>
          <p className={`text-sm font-semibold truncate ${data.disabled ? 'text-slate-400 dark:text-slate-500 line-through' : 'text-gray-900 dark:text-white'}`}>
            {draft?.label ?? data.label}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Disable / Enable toggle — auto-saves on click */}
          <button
            onClick={toggleDisabled}
            disabled={isSavingDisabled}
            title={
              isSavingDisabled ? 'Saving…' :
              data.disabled ? 'Node is disabled — click to enable' :
              'Disable this node (it will be skipped during execution)'
            }
            className={`transition-colors disabled:opacity-50 disabled:cursor-wait ${
              data.disabled ? 'text-red-400 hover:text-red-300' : 'text-slate-400 dark:text-slate-500 hover:text-red-400'
            }`}
          >
            {isSavingDisabled
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Power className="w-4 h-4" />
            }
          </button>
          {/* Star / entry toggle */}
          <button
            onClick={toggleEntry}
            title={data.isEntry ? 'Remove as start node' : 'Mark as start node (⭐ = runs on trigger)'}
            className={`transition-colors ${data.isEntry ? 'text-amber-400' : 'text-slate-400 dark:text-slate-500 hover:text-amber-400'}`}
          >
            <Star className={`w-4 h-4 ${data.isEntry ? 'fill-amber-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Disabled banner */}
      {data.disabled && (
        <div className="flex items-center gap-2 px-2.5 py-2 bg-slate-200 dark:bg-slate-700/40 border border-dashed border-slate-500/50 rounded-md">
          <Power className="w-3 h-3 text-slate-500 dark:text-slate-400 shrink-0" />
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            This node is <span className="font-semibold text-slate-700 dark:text-slate-300">disabled</span> — it will be skipped when the workflow runs. Any downstream node that uses its output will fail.
          </p>
        </div>
      )}

      {/* Multi-entry hint */}
      {entryCount > 1 && data.isEntry && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/30 rounded-md">
          <Star className="w-2.5 h-2.5 text-amber-500 dark:text-amber-400 fill-amber-500 dark:fill-amber-400 shrink-0" />
          <p className="text-[10px] text-amber-700 dark:text-amber-300">
            {entryCount} start nodes — they will run simultaneously when triggered.
          </p>
        </div>
      )}

      {/* Node name */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Node name</label>
        <input
          type="text"
          value={draft?.label ?? data.label}
          onChange={(e) => setDraft((prev) => prev ? { ...prev, label: e.target.value } : prev)}
          className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Test panel */}
      {isUnsaved ? (
        <div className="flex items-center gap-1.5 px-2.5 py-2 bg-slate-100 dark:bg-slate-800/50 rounded-md border border-slate-200 dark:border-slate-700">
          <AlertCircle className="w-3 h-3 text-slate-400 dark:text-slate-500 shrink-0" />
          <p className="text-[10px] text-slate-400 dark:text-slate-500">Save the workflow first to enable node testing.</p>
        </div>
      ) : (
        <NodeTestPanel
          key={selectedNodeId}
          nodeId={selectedNodeId!}
          workflowId={activeWorkflow!.id}
          nodeType={nodeType}
          savedResult={savedTestResult}
        />
      )}

      <div className="border-t border-slate-200 dark:border-slate-700" />

      {/* Type-specific config */}
      {nodeType === 'http' && (
        <HttpConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'llm' && (
        <LLMConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'condition' && (
        <ConditionConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'switch' && (
        <SwitchConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'transform' && (
        <TransformConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'output' && (
        <OutputConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'gmail' && (
        <GmailConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'gdrive' && (
        <GDriveConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'gdocs' && (
        <GDocsConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'gsheets' && (
        <GSheetsConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'slack' && (
        <SlackConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'teams' && (
        <TeamsConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'basecamp' && (
        <BasecampConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} />
      )}
      {nodeType === 'trigger' && (
        <TriggerConfig cfg={cfg} onChange={updateConfig} otherNodes={otherNodes} testResults={testResults} workflowId={activeWorkflow?.id ?? ''} nodeId={selectedNode.id} />
      )}

      {/* Retry & Timeout */}
      <div className="border-t border-slate-200 dark:border-slate-700" />
      <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">Retry & Timeout</p>
      {[
        { label: 'Retries (0–5)', key: 'retries' as const, min: 0, max: 5, val: draft?.retries ?? 0 },
        { label: 'Retry delay (ms)', key: 'retryDelayMs' as const, min: 0, val: draft?.retryDelayMs ?? 0 },
        { label: 'Timeout (ms, 0 = none)', key: 'timeoutMs' as const, min: 0, val: draft?.timeoutMs ?? 0 },
      ].map(({ label, key, min, max, val }) => (
        <div key={key} className="space-y-1">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
          <input
            type="number"
            min={min}
            max={max}
            value={String(val)}
            onChange={(e) =>
              setDraft((prev) => prev ? {
                ...prev,
                [key]: key === 'timeoutMs'
                  ? (Number(e.target.value) || undefined)
                  : Number(e.target.value),
              } : prev)
            }
            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      ))}

      {/* Disable-confirmation modal — rendered inside the panel so it inherits
          the correct stacking context but portals to the viewport via fixed positioning */}
      <DisableNodeWarningModal
        open={disableModal.open}
        nodeName={data.label}
        dependents={disableModal.dependents}
        isLoading={isSavingDisabled}
        onConfirm={confirmDisable}
        onCancel={() => setDisableModal({ open: false, dependents: [] })}
      />
    </div>

    {/* ── Sticky Save / Cancel footer ─────────────────────────────────────── */}
    <div className="sticky bottom-0 z-10 bg-slate-50 dark:bg-slate-900/95 backdrop-blur-sm border-t border-slate-200 dark:border-slate-700/70 px-4 py-3 flex items-center gap-2 shrink-0">
      <button
        onClick={handleNodeSave}
        disabled={!isDirtyLocal || isSavingNode}
        title={isDirtyLocal ? 'Save changes to this node' : 'No changes to save'}
        className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-semibold transition-all duration-150 ${
          saveSuccess
            ? 'bg-green-600/80 text-gray-900 dark:text-white cursor-default'
            : isDirtyLocal && !isSavingNode
            ? 'bg-blue-600 hover:bg-blue-500 text-gray-900 dark:text-white shadow-sm shadow-blue-900/50'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
        }`}
      >
        {isSavingNode ? (
          <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
        ) : saveSuccess ? (
          <><CheckCircle2 className="w-3 h-3" /> Saved</>
        ) : (
          <><Save className="w-3 h-3" /> Save</>
        )}
      </button>

      <button
        onClick={handleNodeCancel}
        title={isDirtyLocal ? 'Discard changes and close' : 'Close config panel'}
        className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-gray-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700/60 transition-colors"
      >
        <X className="w-3 h-3" />
        {isDirtyLocal ? 'Discard' : 'Close'}
      </button>
    </div>
    </div>
  );
}

// ── Per-type config forms ─────────────────────────────────────────────────────

type ConfigProps = {
  cfg: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
  otherNodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
};

function HttpConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const headers = (cfg.headers as Record<string, string>) ?? {};
  const headerEntries = Object.entries(headers);

  function updateHeader(oldKey: string, newKey: string, value: string) {
    const updated: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      updated[k === oldKey ? newKey : k] = k === oldKey ? value : v;
    }
    onChange({ headers: updated });
  }

  function addHeader() {
    onChange({ headers: { ...headers, '': '' } });
  }

  function removeHeader(key: string) {
    const updated = { ...headers };
    delete updated[key];
    onChange({ headers: Object.keys(updated).length ? updated : undefined });
  }

  return (
    <>
      <Select
        label="Method"
        value={String(cfg.method ?? 'GET')}
        onChange={(e) => onChange({ method: e.target.value })}
        options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m }))}
      />
      <ExpressionInput
        label="URL"
        value={String(cfg.url ?? '')}
        onChange={(v) => onChange({ url: v })}
        placeholder="https://api.example.com/data"
        nodes={otherNodes}
        testResults={testResults}
      />

      {/* Headers */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Headers</label>
          <button
            type="button"
            onClick={addHeader}
            className="text-[10px] text-blue-500 dark:text-blue-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700 px-1.5 py-0.5 rounded transition-colors"
          >
            + Add header
          </button>
        </div>
        {headerEntries.length === 0 && (
          <p className="text-[10px] text-slate-600 italic">
            No custom headers — Content-Type: application/json is sent by default.
          </p>
        )}
        {headerEntries.map(([key, value], i) => (
          <div key={i} className="flex items-center gap-1">
            <input
              className="flex-1 min-w-0 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded px-2 py-1 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={key}
              onChange={(e) => updateHeader(key, e.target.value, value)}
              placeholder="Header name"
            />
            <span className="text-slate-600 text-xs shrink-0">:</span>
            <input
              className="flex-1 min-w-0 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded px-2 py-1 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={value}
              onChange={(e) => updateHeader(key, key, e.target.value)}
              placeholder="Value"
            />
            <button
              type="button"
              onClick={() => removeHeader(key)}
              className="text-slate-400 dark:text-slate-500 hover:text-red-400 px-1 shrink-0 text-sm"
            >
              ×
            </button>
          </div>
        ))}
        {headerEntries.length > 0 && (
          <p className="text-[10px] text-slate-600">
            Custom headers are merged with Content-Type: application/json (your value overrides it if set).
          </p>
        )}
      </div>

      <ExpressionTextArea
        label="Body (JSON)"
        rows={3}
        value={
          cfg.body == null
            ? ''
            : typeof cfg.body === 'string'
              ? cfg.body
              : JSON.stringify(cfg.body, null, 2)
        }
        onChange={(v) => {
          if (!v.trim()) { onChange({ body: undefined }); return; }
          try { onChange({ body: JSON.parse(v) }); }
          catch { onChange({ body: v }); }
        }}
        placeholder='{"key": "value"}'
        nodes={otherNodes}
        testResults={testResults}
      />
    </>
  );
}

function LLMConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  return (
    <>
      <Select
        label="Provider"
        value={String(cfg.provider ?? 'openai')}
        onChange={(e) => onChange({ provider: e.target.value })}
        options={[
          { value: 'openai', label: 'OpenAI' },
          { value: 'anthropic', label: 'Anthropic' },
        ]}
      />
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Model</label>
        <input type="text" value={String(cfg.model ?? '')} onChange={(e) => onChange({ model: e.target.value })}
          placeholder="gpt-4o-mini"
          className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Temperature (0–2)</label>
        <input type="number" min={0} max={2} step={0.1} value={String(cfg.temperature ?? 0.7)}
          onChange={(e) => onChange({ temperature: parseFloat(e.target.value) })}
          className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Max tokens</label>
        <input type="number" min={1} value={String(cfg.maxTokens ?? 500)}
          onChange={(e) => onChange({ maxTokens: Number(e.target.value) })}
          className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
      </div>
      <ExpressionTextArea
        label="System prompt"
        rows={2}
        value={String(cfg.systemPrompt ?? '')}
        onChange={(v) => onChange({ systemPrompt: v })}
        placeholder="You are a helpful assistant..."
        nodes={otherNodes}
        testResults={testResults}
      />
      <ExpressionTextArea
        label="User prompt"
        rows={3}
        value={String(cfg.userPrompt ?? '')}
        onChange={(v) => onChange({ userPrompt: v })}
        placeholder="Summarize the following content…"
        nodes={otherNodes}
        testResults={testResults}
      />
    </>
  );
}

const NO_VALUE_OPERATORS = new Set(['isNull', 'isNotNull']);

function ConditionConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const condition = (cfg.condition as Record<string, unknown>) ?? {};
  const operator = String(condition.operator ?? 'eq');
  const needsValue = !NO_VALUE_OPERATORS.has(operator);

  function updateCond(patch: Record<string, unknown>) {
    onChange({ condition: { ...condition, ...patch } });
  }

  function handleOperatorChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const op = e.target.value;
    // Clear the right-side value when switching to a no-value operator
    updateCond({ operator: op, ...(NO_VALUE_OPERATORS.has(op) ? { right: '' } : {}) });
  }

  return (
    <>
      <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">Condition</p>
      <ExpressionInput
        label="Left side (what to check)"
        value={String(condition.left ?? '')}
        onChange={(v) => updateCond({ left: v })}
        placeholder="Pick a variable → e.g. HTTP status code"
        nodes={otherNodes}
        testResults={testResults}
      />
      <Select
        label="Operator"
        value={operator}
        onChange={handleOperatorChange}
        options={[
          { value: 'eq', label: 'equals (=)' },
          { value: 'neq', label: 'not equals (≠)' },
          { value: 'gt', label: 'greater than (>)' },
          { value: 'gte', label: 'greater or equal (≥)' },
          { value: 'lt', label: 'less than (<)' },
          { value: 'lte', label: 'less or equal (≤)' },
          { value: 'contains', label: 'contains' },
          { value: 'startsWith', label: 'starts with' },
          { value: 'endsWith', label: 'ends with' },
          { value: 'isNull', label: 'is empty / null' },
          { value: 'isNotNull', label: 'is not empty / null' },
        ]}
      />
      {needsValue ? (
        <ExpressionInput
          label="Right side (value to compare)"
          value={String(condition.right ?? '')}
          onChange={(v) => updateCond({ right: v })}
          placeholder="200"
          nodes={otherNodes}
          testResults={testResults}
        />
      ) : (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/40 rounded text-[11px] text-slate-400 dark:text-slate-500 italic">
          No comparison value needed for this operator.
        </div>
      )}
      <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">
        Connect the <strong className="text-amber-400">true</strong> and{' '}
        <strong className="text-amber-400">false</strong> handles on the canvas to set routing.
      </p>
    </>
  );
}

function SwitchConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const cases = (cfg.cases as Array<Record<string, unknown>>) ?? [];

  function updateCase(i: number, patch: Record<string, unknown>) {
    onChange({ cases: cases.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  }
  function addCase() {
    onChange({
      cases: [...cases, { label: `Case ${cases.length + 1}`, condition: { type: 'leaf', left: '', operator: 'eq', right: '' }, next: '' }],
    });
  }
  function removeCase(i: number) {
    onChange({ cases: cases.filter((_, idx) => idx !== i) });
  }

  return (
    <>
      {cases.map((c, i) => {
        const cond = (c.condition as Record<string, unknown>) ?? {};
        return (
          <div key={i} className="bg-slate-100 dark:bg-slate-800 rounded-md p-2 space-y-2">
            <div className="flex items-center justify-between gap-1">
              <input
                className="flex-1 min-w-0 bg-slate-200 dark:bg-slate-700 border border-slate-600 text-gray-800 dark:text-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={String(c.label ?? `Case ${i + 1}`)}
                onChange={(e) => updateCase(i, { label: e.target.value })}
                placeholder="Case label"
              />
              <button onClick={() => removeCase(i)} className="text-slate-400 dark:text-slate-500 hover:text-red-400 ml-1 shrink-0 text-sm">×</button>
            </div>
            <ExpressionInput
              label="Check this value"
              value={String(cond.left ?? '')}
              onChange={(v) => updateCase(i, { condition: { ...cond, left: v } })}
              placeholder="Pick a variable to check"
              nodes={otherNodes}
              testResults={testResults}
            />
            <Select
              label="Operator"
              value={String(cond.operator ?? 'eq')}
              onChange={(e) => {
                const op = e.target.value;
                updateCase(i, {
                  condition: { ...cond, operator: op, ...(NO_VALUE_OPERATORS.has(op) ? { right: '' } : {}) },
                });
              }}
              options={[
                { value: 'eq', label: 'equals (=)' },
                { value: 'neq', label: 'not equals (≠)' },
                { value: 'gt', label: 'greater than (>)' },
                { value: 'lt', label: 'less than (<)' },
                { value: 'contains', label: 'contains' },
                { value: 'isNull', label: 'is empty / null' },
                { value: 'isNotNull', label: 'is not empty / null' },
              ]}
            />
            {!NO_VALUE_OPERATORS.has(String(cond.operator ?? 'eq')) ? (
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Compare to</label>
                <input
                  className="w-full bg-slate-200 dark:bg-slate-700 border border-slate-600 text-gray-800 dark:text-slate-200 rounded px-2 py-1 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={String(cond.right ?? '')}
                  onChange={(e) => updateCase(i, { condition: { ...cond, right: e.target.value } })}
                  placeholder="e.g. 200"
                />
              </div>
            ) : (
              <div className="flex items-center gap-2 px-2 py-1.5 bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/40 rounded text-[11px] text-slate-400 dark:text-slate-500 italic">
                No comparison value needed.
              </div>
            )}
          </div>
        );
      })}
      <button
        onClick={addCase}
        className="w-full text-xs text-slate-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white border border-dashed border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-400 rounded-md py-1.5 transition-colors"
      >
        + Add case
      </button>
      <p className="text-[10px] text-slate-400 dark:text-slate-500">
        Connect each case handle on the canvas to route to the target node.
      </p>
    </>
  );
}

function TransformConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const mappings = (cfg.mappings as Record<string, string>) ?? {};
  const entries = Object.entries(mappings);

  function updateKey(oldKey: string, newKey: string) {
    const updated: Record<string, string> = {};
    for (const [k, v] of Object.entries(mappings)) updated[k === oldKey ? newKey : k] = v;
    onChange({ mappings: updated });
  }
  function addMapping() {
    onChange({ mappings: { ...mappings, [`field${entries.length + 1}`]: '' } });
  }
  function removeMapping(key: string) {
    const updated = { ...mappings };
    delete updated[key];
    onChange({ mappings: updated });
  }

  return (
    <>
      <p className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">Mappings</p>
      <p className="text-[10px] text-slate-400 dark:text-slate-500">
        Left = output key name. Right = where the value comes from (use{' '}
        <span className="text-blue-400">Insert variable</span> to pick from another node).
      </p>
      {entries.map(([k, v]) => (
        <TransformMappingRow
          key={k}
          outputKey={k}
          valueExpr={v}
          nodes={otherNodes}
          testResults={testResults}
          onKeyChange={(newKey) => updateKey(k, newKey)}
          onValueChange={(newVal) => onChange({ mappings: { ...mappings, [k]: newVal } })}
          onRemove={() => removeMapping(k)}
        />
      ))}
      <button
        onClick={addMapping}
        className="w-full text-xs text-slate-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white border border-dashed border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-400 rounded-md py-1.5 transition-colors"
      >
        + Add mapping
      </button>
    </>
  );
}

function TransformMappingRow({
  outputKey, valueExpr, nodes, testResults, onKeyChange, onValueChange, onRemove,
}: {
  outputKey: string;
  valueExpr: string;
  nodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
  onKeyChange: (k: string) => void;
  onValueChange: (v: string) => void;
  onRemove: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const valueRef = useRef<HTMLInputElement>(null);

  function handleInsert(expr: string) {
    if (valueRef.current) insertAtCursor(valueRef.current, expr, valueExpr, onValueChange);
    else onValueChange(valueExpr + expr);
    setPickerOpen(false);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <input
          className="flex-1 min-w-0 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={outputKey}
          onChange={(e) => onKeyChange(e.target.value)}
          placeholder="outputKey"
        />
        <span className="text-slate-600 text-xs shrink-0">←</span>
        <input
          ref={valueRef}
          className="flex-1 min-w-0 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={valueExpr}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder="variable or static value"
        />
        {nodes.length > 0 && (
          <button
            type="button"
            onClick={() => setPickerOpen((p) => !p)}
            title="Insert variable"
            className={`shrink-0 p-1 rounded transition-colors ${
              pickerOpen ? 'bg-blue-600 text-white' : 'text-blue-500 dark:text-blue-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Braces className="w-3 h-3" />
          </button>
        )}
        <button onClick={onRemove} className="text-slate-400 dark:text-slate-500 hover:text-red-400 px-1 shrink-0 text-sm">×</button>
      </div>
      {pickerOpen && (
        <VariablePickerPanel nodes={nodes} testResults={testResults} onInsert={handleInsert} />
      )}
    </div>
  );
}

function OutputConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  return (
    <ExpressionInput
      label="Output value"
      value={String(cfg.value ?? '')}
      onChange={(v) => onChange({ value: v })}
      placeholder="Pick a variable or type a static value"
      nodes={otherNodes}
      testResults={testResults}
      hint="This value becomes the final result of the workflow execution."
    />
  );
}

// ── Google Workspace shared helper ─────────────────────────────────────────────

function CredentialSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { data: credentials = [], isLoading } = useCredentialList();
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Google Account</label>
      {isLoading ? (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">Loading accounts…</p>
      ) : credentials.length === 0 ? (
        <p className="text-[10px] text-amber-400">
          No Google accounts connected. Click <strong>Credentials</strong> in the toolbar to connect one.
        </p>
      ) : (
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={[
            { value: '', label: '— select account —' },
            ...credentials.map((c) => ({ value: c.id, label: c.email })),
          ]}
        />
      )}
    </div>
  );
}

// ── GmailConfig ────────────────────────────────────────────────────────────────

function GmailConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const action = (cfg.action as string) ?? 'send';
  return (
    <div className="space-y-3">
      <CredentialSelect
        value={String(cfg.credentialId ?? '')}
        onChange={(id) => onChange({ credentialId: id })}
      />
      <Select
        label="Action"
        value={action}
        onChange={(e) => onChange({ action: e.target.value })}
        options={[
          { value: 'send', label: 'Send Email' },
          { value: 'list', label: 'List Emails' },
          { value: 'read', label: 'Read Email' },
        ]}
      />

      {action === 'send' && (
        <>
          <ExpressionInput label="To" value={String(cfg.to ?? '')} onChange={(v) => onChange({ to: v })}
            placeholder="recipient@example.com" nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="CC (optional)" value={String(cfg.cc ?? '')} onChange={(v) => onChange({ cc: v })}
            placeholder="cc@example.com" nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="BCC (optional)" value={String(cfg.bcc ?? '')} onChange={(v) => onChange({ bcc: v })}
            placeholder="bcc@example.com" nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="Subject" value={String(cfg.subject ?? '')} onChange={(v) => onChange({ subject: v })}
            placeholder="Email subject" nodes={otherNodes} testResults={testResults} />
          <ExpressionTextArea label="Body" value={String(cfg.body ?? '')} onChange={(v) => onChange({ body: v })}
            placeholder="Email body…" nodes={otherNodes} testResults={testResults} rows={4} />
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="gmail-html"
              checked={Boolean(cfg.isHtml)}
              onChange={(e) => onChange({ isHtml: e.target.checked })}
              className="w-3.5 h-3.5 rounded"
            />
            <label htmlFor="gmail-html" className="text-xs text-slate-500 dark:text-slate-400">Send as HTML</label>
          </div>
        </>
      )}

      {action === 'list' && (
        <>
          <ExpressionInput label="Search query (Gmail format)" value={String(cfg.query ?? '')}
            onChange={(v) => onChange({ query: v })} placeholder="from:example.com is:unread"
            nodes={otherNodes} testResults={testResults} />
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Max results</label>
            <input type="number" min={1} max={500} value={String(cfg.maxResults ?? 10)}
              onChange={(e) => onChange({ maxResults: Number(e.target.value) })}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
        </>
      )}

      {action === 'read' && (
        <ExpressionInput label="Message ID" value={String(cfg.messageId ?? '')}
          onChange={(v) => onChange({ messageId: v })} placeholder="Enter or pick from a list result"
          nodes={otherNodes} testResults={testResults} />
      )}
    </div>
  );
}

// ── GDriveConfig ───────────────────────────────────────────────────────────────

function GDriveConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const action = (cfg.action as string) ?? 'list';
  return (
    <div className="space-y-3">
      <CredentialSelect
        value={String(cfg.credentialId ?? '')}
        onChange={(id) => onChange({ credentialId: id })}
      />
      <Select
        label="Action"
        value={action}
        onChange={(e) => onChange({ action: e.target.value })}
        options={[
          { value: 'list',     label: 'List Files' },
          { value: 'upload',   label: 'Upload File' },
          { value: 'download', label: 'Download File' },
        ]}
      />

      {action === 'list' && (
        <>
          <ExpressionInput label="Search query (Drive format)" value={String(cfg.query ?? '')}
            onChange={(v) => onChange({ query: v })} placeholder="name contains 'report'"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionInput label="Folder ID (optional)" value={String(cfg.folderId ?? '')}
            onChange={(v) => onChange({ folderId: v })} placeholder="Leave blank to search all"
            nodes={otherNodes} testResults={testResults} />
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Max results</label>
            <input type="number" min={1} max={1000} value={String(cfg.maxResults ?? 20)}
              onChange={(e) => onChange({ maxResults: Number(e.target.value) })}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
        </>
      )}

      {action === 'upload' && (
        <>
          <ExpressionInput label="File name" value={String(cfg.fileName ?? '')}
            onChange={(v) => onChange({ fileName: v })} placeholder="report.csv"
            nodes={otherNodes} testResults={testResults} />
          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">MIME type</label>
            <input type="text" value={String(cfg.mimeType ?? 'text/plain')}
              onChange={(e) => onChange({ mimeType: e.target.value })}
              className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <ExpressionTextArea label="Content" value={String(cfg.content ?? '')}
            onChange={(v) => onChange({ content: v })} placeholder="File content or expression"
            nodes={otherNodes} testResults={testResults} rows={4} />
          <ExpressionInput label="Folder ID (optional)" value={String(cfg.folderId ?? '')}
            onChange={(v) => onChange({ folderId: v })} placeholder="Upload destination folder"
            nodes={otherNodes} testResults={testResults} />
        </>
      )}

      {action === 'download' && (
        <ExpressionInput label="File ID" value={String(cfg.fileId ?? '')}
          onChange={(v) => onChange({ fileId: v })} placeholder="Google Drive file ID"
          nodes={otherNodes} testResults={testResults} />
      )}
    </div>
  );
}

// ── GDocsConfig ────────────────────────────────────────────────────────────────

function GDocsConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const action = (cfg.action as string) ?? 'read';
  return (
    <div className="space-y-3">
      <CredentialSelect
        value={String(cfg.credentialId ?? '')}
        onChange={(id) => onChange({ credentialId: id })}
      />
      <Select
        label="Action"
        value={action}
        onChange={(e) => onChange({ action: e.target.value })}
        options={[
          { value: 'create', label: 'Create Document' },
          { value: 'read',   label: 'Read Document' },
          { value: 'append', label: 'Append to Document' },
        ]}
      />

      {action === 'create' && (
        <>
          <ExpressionInput label="Document title" value={String(cfg.title ?? '')}
            onChange={(v) => onChange({ title: v })} placeholder="My Document"
            nodes={otherNodes} testResults={testResults} />
          <ExpressionTextArea label="Initial content (optional)" value={String(cfg.content ?? '')}
            onChange={(v) => onChange({ content: v })} placeholder="Starting text…"
            nodes={otherNodes} testResults={testResults} rows={4} />
        </>
      )}

      {(action === 'read' || action === 'append') && (
        <ExpressionInput label="Document ID" value={String(cfg.documentId ?? '')}
          onChange={(v) => onChange({ documentId: v })} placeholder="Google Docs document ID"
          nodes={otherNodes} testResults={testResults} />
      )}

      {action === 'append' && (
        <ExpressionTextArea label="Text to append" value={String(cfg.text ?? '')}
          onChange={(v) => onChange({ text: v })} placeholder="Text to add at the end of the document"
          nodes={otherNodes} testResults={testResults} rows={4} />
      )}
    </div>
  );
}

// ── Slack credential helper ────────────────────────────────────────────────────

function SlackCredentialSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { data: credentials = [], isLoading } = useCredentialList();
  const slackCreds = credentials.filter((c) => c.provider === 'slack');
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Slack Workspace</label>
      {isLoading ? (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">Loading workspaces…</p>
      ) : slackCreds.length === 0 ? (
        <p className="text-[10px] text-amber-400">
          No Slack workspaces connected. Click <strong>Credentials</strong> in the toolbar to connect one.
        </p>
      ) : (
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={[
            { value: '', label: '— select workspace —' },
            ...slackCreds.map((c) => ({ value: c.id, label: c.label })),
          ]}
        />
      )}
    </div>
  );
}

// ── SlackResourceSelect ────────────────────────────────────────────────────────
// Smart picker: shows a searchable list when a credential is selected,
// with a toggle to switch to free-form expression input.

function SlackResourceSelect({
  label,
  value,
  onChange,
  items,
  isLoading,
  isError,
  placeholder,
  renderItem,
  hasCredential,
  otherNodes,
  testResults,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  items: { id: string; display: string }[];
  isLoading: boolean;
  isError: boolean;
  placeholder: string;
  renderItem: (item: { id: string; display: string }) => string;
  hasCredential: boolean;
  otherNodes: ConfigProps['otherNodes'];
  testResults: ConfigProps['testResults'];
}) {
  const looksLikeExpression = value.includes('{{');
  const [expressionMode, setExpressionMode] = useState(!hasCredential || looksLikeExpression);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    // Fall back to expression mode when credential is cleared
    if (!hasCredential) { setExpressionMode(true); return; }
    // Auto-switch to picker mode once items have loaded and value isn't an expression
    if (hasCredential && items.length > 0 && !value.includes('{{')) {
      setExpressionMode(false);
    }
  }, [hasCredential, items.length, value]);

  const filtered = items.filter((i) =>
    i.display.toLowerCase().includes(filter.toLowerCase())
  );
  const selected = items.find((i) => i.id === value);

  if (!hasCredential || expressionMode) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
          {hasCredential && (
            <button
              type="button"
              onClick={() => setExpressionMode(false)}
              className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors"
            >
              Pick from list
            </button>
          )}
        </div>
        <ExpressionInput
          label=""
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          nodes={otherNodes}
          testResults={testResults}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
        <button
          type="button"
          onClick={() => setExpressionMode(true)}
          className="text-[10px] text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
        >
          Use expression
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </div>
      )}

      {isError && (
        <p className="text-[10px] text-red-400">
          Failed to load. <button type="button" className="underline" onClick={() => setExpressionMode(true)}>Enter manually.</button>
        </p>
      )}

      {!isLoading && !isError && (
        <div className="space-y-1">
          {/* Search box */}
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search…"
            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-violet-500 placeholder-slate-500"
          />
          {/* Scrollable list */}
          <div className="max-h-36 overflow-y-auto rounded-md border border-slate-600 bg-slate-100 dark:bg-slate-800 divide-y divide-slate-700">
            {filtered.length === 0 && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No results.</p>
            )}
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { onChange(item.id); setFilter(''); }}
                className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                  item.id === value
                    ? 'bg-violet-600/30 text-violet-300'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {renderItem(item)}
              </button>
            ))}
          </div>
          {/* Selected value badge */}
          {selected && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
              Selected: <span className="text-slate-700 dark:text-slate-300">{renderItem(selected)}</span>
              <span className="ml-1 text-slate-600">({selected.id})</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── SlackConfig ────────────────────────────────────────────────────────────────

function SlackConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const action      = (cfg.action as string) ?? 'send_message';
  const credentialId = String(cfg.credentialId ?? '');

  const {
    channels, missingScopes,
    isLoading: loadingChannels, isError: errorChannels,
  } = useSlackChannels(credentialId);
  const { data: users = [],    isLoading: loadingUsers,    isError: errorUsers }    =
    useSlackUsers(credentialId);

  const channelItems = channels.map((c) => ({
    id:      c.id!,
    // prefix: private channels get 🔒, non-member public channels get "(not joined)"
    display: c.isPrivate
      ? `🔒 ${c.name}`
      : c.isMember
        ? c.name!
        : `${c.name} (not joined)`,
  }));
  const userItems = users.map((u) => ({
    id:      u.id!,
    display: u.displayName || u.realName || u.name,
  }));

  return (
    <div className="space-y-3">
      <SlackCredentialSelect
        value={credentialId}
        onChange={(id) => onChange({ credentialId: id })}
      />

      {/* Reconnect hint when the stored token is missing required scopes */}
      {credentialId && missingScopes.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-2.5 py-2">
          <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
          <p className="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">
            Private channels are hidden because your token is missing{' '}
            <code className="font-mono bg-amber-100 dark:bg-amber-500/20 px-0.5 rounded">
              {missingScopes.join(', ')}
            </code>
            . Add it in your Slack app under <strong>OAuth &amp; Permissions → User Token Scopes</strong>,
            then reconnect your workspace from the Credentials panel.
          </p>
        </div>
      )}

      <Select
        label="Action"
        value={action}
        onChange={(e) => onChange({ action: e.target.value })}
        options={[
          { value: 'send_message',  label: 'Send Message to Channel' },
          { value: 'send_dm',       label: 'Send Direct Message' },
          { value: 'upload_file',   label: 'Upload File' },
          { value: 'read_messages', label: 'Read Messages' },
        ]}
      />

      {(action === 'send_message' || action === 'upload_file' || action === 'read_messages') && (
        <SlackResourceSelect
          label="Channel"
          value={String(cfg.channel ?? '')}
          onChange={(v) => onChange({ channel: v })}
          items={channelItems}
          isLoading={loadingChannels}
          isError={errorChannels}
          placeholder="C1234567890 or {{nodes.x.channel}}"
          renderItem={(item) => `#${item.display}`}
          hasCredential={!!credentialId}
          otherNodes={otherNodes}
          testResults={testResults}
        />
      )}

      {action === 'send_dm' && (
        <SlackResourceSelect
          label="User"
          value={String(cfg.userId ?? '')}
          onChange={(v) => onChange({ userId: v })}
          items={userItems}
          isLoading={loadingUsers}
          isError={errorUsers}
          placeholder="U1234567890 or {{nodes.x.userId}}"
          renderItem={(item) => `@${item.display}`}
          hasCredential={!!credentialId}
          otherNodes={otherNodes}
          testResults={testResults}
        />
      )}

      {(action === 'send_message' || action === 'send_dm') && (
        <ExpressionTextArea
          label="Message Text"
          value={String(cfg.text ?? '')}
          onChange={(v) => onChange({ text: v })}
          placeholder="Hello from your workflow!"
          nodes={otherNodes}
          testResults={testResults}
          rows={3}
        />
      )}

      {action === 'upload_file' && (
        <>
          <ExpressionInput
            label="Filename"
            value={String(cfg.filename ?? '')}
            onChange={(v) => onChange({ filename: v })}
            placeholder="output.txt"
            nodes={otherNodes}
            testResults={testResults}
          />
          <ExpressionTextArea
            label="File Content"
            value={String(cfg.fileContent ?? '')}
            onChange={(v) => onChange({ fileContent: v })}
            placeholder="File contents or an expression…"
            nodes={otherNodes}
            testResults={testResults}
            rows={4}
          />
        </>
      )}

      {action === 'read_messages' && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Message limit</label>
          <input
            type="number"
            min={1}
            max={200}
            value={String(cfg.limit ?? 10)}
            onChange={(e) => onChange({ limit: Number(e.target.value) })}
            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}
    </div>
  );
}

// ── GSheetsConfig ──────────────────────────────────────────────────────────────

function GSheetsConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const action = (cfg.action as string) ?? 'read';
  return (
    <div className="space-y-3">
      <CredentialSelect
        value={String(cfg.credentialId ?? '')}
        onChange={(id) => onChange({ credentialId: id })}
      />
      <Select
        label="Action"
        value={action}
        onChange={(e) => onChange({ action: e.target.value })}
        options={[
          { value: 'read',   label: 'Read Rows' },
          { value: 'write',  label: 'Write / Update Rows' },
          { value: 'append', label: 'Append Rows' },
        ]}
      />

      <ExpressionInput label="Spreadsheet ID" value={String(cfg.spreadsheetId ?? '')}
        onChange={(v) => onChange({ spreadsheetId: v })} placeholder="Google Sheets spreadsheet ID"
        nodes={otherNodes} testResults={testResults} />

      <ExpressionInput label="Range (A1 notation)" value={String(cfg.range ?? '')}
        onChange={(v) => onChange({ range: v })} placeholder="Sheet1!A1:Z100"
        nodes={otherNodes} testResults={testResults} />

      {(action === 'write' || action === 'append') && (
        <>
          <ExpressionTextArea
            label="Values (2-D array or expression)"
            value={typeof cfg.values === 'string' ? cfg.values : JSON.stringify(cfg.values ?? [['value1', 'value2']], null, 2)}
            onChange={(v) => onChange({ values: v })}
            placeholder={'[["col1","col2"],["val1","val2"]]'}
            nodes={otherNodes}
            testResults={testResults}
            rows={4}
          />
          <Select
            label="Value input option"
            value={String(cfg.valueInputOption ?? 'USER_ENTERED')}
            onChange={(e) => onChange({ valueInputOption: e.target.value })}
            options={[
              { value: 'USER_ENTERED', label: 'User Entered (parse formulas)' },
              { value: 'RAW', label: 'Raw (treat as plain text)' },
            ]}
          />
        </>
      )}
    </div>
  );
}

// ── Teams credential helper ────────────────────────────────────────────────────

function TeamsCredentialSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { data: credentials = [], isLoading } = useCredentialList();
  const teamsCreds = credentials.filter((c) => c.provider === 'teams');
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Microsoft Account</label>
      {isLoading ? (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">Loading accounts…</p>
      ) : teamsCreds.length === 0 ? (
        <p className="text-[10px] text-amber-400">
          No Microsoft accounts connected. Click <strong>Credentials</strong> in the toolbar to connect one.
        </p>
      ) : (
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={[
            { value: '', label: '— select account —' },
            ...teamsCreds.map((c) => ({ value: c.id, label: c.label })),
          ]}
        />
      )}
    </div>
  );
}

// ── TeamsConfig ────────────────────────────────────────────────────────────────

function TeamsConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const action       = (cfg.action as string) ?? 'send_message';
  const credentialId = String(cfg.credentialId ?? '');
  const teamId       = String(cfg.teamId ?? '');
  const channelId    = String(cfg.channelId ?? '');

  const { teams,    isLoading: loadingTeams,    isError: errorTeams }    = useTeamsTeams(credentialId);
  const { channels, isLoading: loadingChannels, isError: errorChannels } = useTeamsChannels(credentialId, teamId);
  const { data: users = [], isLoading: loadingUsers, isError: errorUsers } = useTeamsUsers(
    action === 'send_dm' ? credentialId : ''
  );

  const teamItems = teams.map((t) => ({ id: t.id, display: t.displayName }));
  const channelItems = channels.map((c) => ({
    id:      c.id,
    display: c.membershipType === 'private' ? `🔒 ${c.displayName}` : c.displayName,
  }));
  const userItems = users.map((u) => ({
    id:      u.id,
    display: u.displayName || u.mail || u.userPrincipalName,
  }));

  const needsTeamChannel = action === 'send_message' || action === 'read_messages';

  return (
    <div className="space-y-3">
      <TeamsCredentialSelect
        value={credentialId}
        onChange={(id) => onChange({ credentialId: id, teamId: '', channelId: '' })}
      />

      <Select
        label="Action"
        value={action}
        onChange={(e) => onChange({ action: e.target.value })}
        options={[
          { value: 'send_message',  label: 'Send Channel Message' },
          { value: 'send_dm',       label: 'Send Direct Message' },
          { value: 'read_messages', label: 'Read Channel Messages' },
        ]}
      />

      {needsTeamChannel && (
        <>
          {/* Team picker */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Team</span>
            </div>
            {!credentialId ? (
              <p className="text-[10px] text-slate-400 dark:text-slate-500">Select an account first.</p>
            ) : loadingTeams ? (
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading teams…
              </div>
            ) : errorTeams ? (
              <p className="text-[10px] text-red-400">Failed to load teams.</p>
            ) : (
              <div className="max-h-36 overflow-y-auto rounded-md border border-slate-600 bg-slate-100 dark:bg-slate-800 divide-y divide-slate-700">
                {teamItems.length === 0 && (
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No teams found.</p>
                )}
                {teamItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onChange({ teamId: item.id, channelId: '' })}
                    className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                      item.id === teamId
                        ? 'bg-blue-200 dark:bg-blue-600/30 text-blue-700 dark:text-blue-300'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {item.display}
                  </button>
                ))}
              </div>
            )}
            {teamId && teams.length > 0 && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                Selected: <span className="text-slate-700 dark:text-slate-300">{teams.find((t) => t.id === teamId)?.displayName ?? teamId}</span>
              </p>
            )}
          </div>

          {/* Channel picker — shown only once a team is selected */}
          {teamId && (
            <div className="space-y-1">
              <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Channel</span>
              {loadingChannels ? (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading channels…
                </div>
              ) : errorChannels ? (
                <p className="text-[10px] text-red-400">Failed to load channels.</p>
              ) : (
                <div className="max-h-36 overflow-y-auto rounded-md border border-slate-600 bg-slate-100 dark:bg-slate-800 divide-y divide-slate-700">
                  {channelItems.length === 0 && (
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No channels found.</p>
                  )}
                  {channelItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onChange({ channelId: item.id })}
                      className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                        item.id === channelId
                          ? 'bg-blue-200 dark:bg-blue-600/30 text-blue-700 dark:text-blue-300'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {item.display}
                    </button>
                  ))}
                </div>
              )}
              {channelId && channels.length > 0 && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                  Selected: <span className="text-slate-700 dark:text-slate-300">{channels.find((c) => c.id === channelId)?.displayName ?? channelId}</span>
                </p>
              )}
            </div>
          )}
        </>
      )}

      {action === 'send_dm' && (
        <div className="space-y-1">
          {!credentialId ? (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">User</label>
              <p className="text-[10px] text-slate-400 dark:text-slate-500">Select an account first.</p>
            </div>
          ) : loadingUsers ? (
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">User</label>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading users…
              </div>
            </div>
          ) : errorUsers ? (
            <div className="space-y-2">
              <div className="flex items-start gap-2 rounded-md border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-2.5 py-2">
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                <p className="text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">
                  Could not load users. This usually means your Microsoft account needs to be reconnected
                  to grant the <code className="font-mono bg-amber-100 dark:bg-amber-500/20 px-0.5 rounded">User.ReadBasic.All</code> permission.
                  Go to <strong>Credentials</strong> and reconnect your Microsoft account, then try again.
                </p>
              </div>
              <ExpressionInput
                label="User"
                value={String(cfg.userId ?? '')}
                onChange={(v) => onChange({ userId: v })}
                placeholder="User ID or {{nodes.x.userId}}"
                nodes={otherNodes}
                testResults={testResults}
              />
            </div>
          ) : (
            <Select
              label="User"
              value={String(cfg.userId ?? '')}
              onChange={(e) => onChange({ userId: e.target.value })}
              options={[
                { value: '', label: '— select user —' },
                ...userItems.map((u) => ({ value: u.id, label: u.display })),
              ]}
            />
          )}
        </div>
      )}

      {(action === 'send_message' || action === 'send_dm') && (
        <ExpressionTextArea
          label="Message Text"
          value={String(cfg.text ?? '')}
          onChange={(v) => onChange({ text: v })}
          placeholder="Hello from your workflow!"
          nodes={otherNodes}
          testResults={testResults}
          rows={3}
        />
      )}

      {action === 'read_messages' && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Message limit</label>
          <input
            type="number"
            min={1}
            max={50}
            value={String(cfg.limit ?? 10)}
            onChange={(e) => onChange({ limit: Number(e.target.value) })}
            className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}
    </div>
  );
}

// ── Basecamp credential helper ──────────────────────────────────────────────

function BasecampCredentialSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const { data: credentials = [], isLoading } = useCredentialList();
  const basecampCreds = credentials.filter((c) => c.provider === 'basecamp');
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Basecamp Account</label>
      {isLoading ? (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">Loading accounts…</p>
      ) : basecampCreds.length === 0 ? (
        <p className="text-[10px] text-amber-400">
          No Basecamp accounts connected. Click <strong>Credentials</strong> in the toolbar to connect one.
        </p>
      ) : (
        <Select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={[
            { value: '', label: '— select account —' },
            ...basecampCreds.map((c) => ({ value: c.id, label: c.label })),
          ]}
        />
      )}
    </div>
  );
}

// ── BasecampAssigneePicker ──────────────────────────────────────────────────

function BasecampAssigneePicker({
  people,
  loading,
  hasProject,
  assigneeIds,
  onChange,
  otherNodes,
  testResults,
}: {
  people: Array<{ id: number; name: string; email: string; company: string | null }>;
  loading: boolean;
  hasProject: boolean;
  assigneeIds: string;
  onChange: (ids: string) => void;
  otherNodes: ConfigProps['otherNodes'];
  testResults: ConfigProps['testResults'];
}) {
  const [filter, setFilter] = useState('');
  const currentIds = assigneeIds.split(',').map((s) => s.trim()).filter(Boolean);
  const selectedCount = currentIds.length;

  if (!hasProject) {
    return (
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Assignees (optional)</label>
        <p className="text-[10px] text-slate-400 dark:text-slate-500">Select a project first to see available people.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Assignees (optional)</label>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading people…
        </div>
      </div>
    );
  }

  if (people.length === 0) {
    return (
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Assignees (optional)</label>
        <ExpressionInput
          value={assigneeIds}
          onChange={onChange}
          placeholder="Comma-separated person IDs"
          nodes={otherNodes}
          testResults={testResults}
        />
      </div>
    );
  }

  const q = filter.toLowerCase();
  const filtered = q
    ? people.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q) ||
        (p.company ?? '').toLowerCase().includes(q)
      )
    : people;

  const companies = [...new Set(filtered.map((p) => p.company ?? ''))].sort((a, b) =>
    !a ? 1 : !b ? -1 : a.localeCompare(b)
  );

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Assignees (optional)</label>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">{people.length} people</span>
      </div>

      {selectedCount > 0 && (
        <p className="text-[10px] text-green-400">{selectedCount} assignee{selectedCount !== 1 ? 's' : ''} selected</p>
      )}

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search by name, email, or company…"
        className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-green-500 placeholder-slate-500"
      />

      <div className="max-h-64 overflow-y-auto rounded-md border border-slate-600 bg-slate-100 dark:bg-slate-800">
        {filtered.length === 0 && (
          <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No people match "{filter}"</p>
        )}
        {companies.map((company) => {
          const group = filtered.filter((p) => (p.company ?? '') === company);
          return (
            <div key={company || '__none__'}>
              {companies.length > 1 && (
                <div className="px-2.5 py-1 bg-slate-200 dark:bg-slate-700/50 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-[1]">
                  <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {company || 'No company'}
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-1.5">({group.length})</span>
                </div>
              )}
              {group.map((p) => {
                const isSelected = currentIds.includes(String(p.id));
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      const next = isSelected
                        ? currentIds.filter((id) => id !== String(p.id))
                        : [...currentIds, String(p.id)];
                      onChange(next.join(','));
                    }}
                    className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors flex items-center gap-2 border-b border-slate-200 dark:border-slate-700/50 last:border-0 ${
                      isSelected ? 'bg-green-600/20 text-green-300' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    <span className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 ${
                      isSelected ? 'bg-green-600 border-green-500' : 'border-slate-500'
                    }`}>
                      {isSelected && <Check className="w-2 h-2 text-gray-900 dark:text-white" />}
                    </span>
                    <span className="truncate">{p.name}</span>
                    {p.email && <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate ml-auto">{p.email}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── BasecampConfig ──────────────────────────────────────────────────────────

function needsTodolistForAction(action: string): boolean {
  return ['create_todo', 'list_todos'].includes(action);
}

function BasecampConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const action       = (cfg.action as string) ?? 'create_todo';
  const credentialId = String(cfg.credentialId ?? '');
  const projectId    = String(cfg.projectId ?? '');
  const todolistId   = String(cfg.todolistId ?? '');
  const groupId          = String(cfg.groupId ?? '');
  const includeCompleted = Boolean(cfg.includeCompleted);

  const { data: projects = [],  isLoading: loadingProjects,  isError: errorProjects }  = useBasecampProjects(credentialId);
  const { data: todolists = [], isLoading: loadingTodolists, isError: errorTodolists } = useBasecampTodolists(credentialId, projectId);
  const { data: todoGroups = [], isLoading: loadingGroups } = useBasecampTodoGroups(
    needsTodolistForAction(action) ? credentialId : '', todolistId
  );
  const todoStatus = action === 'uncomplete_todo' ? 'completed' as const : 'active' as const;
  const { data: todos = [],     isLoading: loadingTodos,     isError: errorTodos }     = useBasecampTodos(
    (action === 'complete_todo' || action === 'uncomplete_todo') ? credentialId : '', todolistId, todoStatus
  );
  const { data: people = [],    isLoading: loadingPeople }    = useBasecampPeople(credentialId, projectId || undefined);

  const needsProject  = ['create_todo', 'post_message', 'send_campfire', 'list_todos'].includes(action);
  const needsTodolist = ['create_todo', 'list_todos'].includes(action);

  return (
    <div className="space-y-3">
      <BasecampCredentialSelect
        value={credentialId}
        onChange={(id) => onChange({ credentialId: id, projectId: '', todolistId: '', groupId: '', todoId: '' })}
      />

      <Select
        label="Action"
        value={action}
        onChange={(e) => onChange({ action: e.target.value, projectId: '', todolistId: '', groupId: '', todoId: '' })}
        options={[
          { value: 'create_todo',     label: 'Create To-Do' },
          { value: 'complete_todo',   label: 'Complete a To-Do' },
          { value: 'uncomplete_todo', label: 'Re-Open a To-Do' },
          { value: 'post_message',    label: 'Post Message' },
          { value: 'post_comment',    label: 'Post Comment' },
          { value: 'send_campfire',   label: 'Send Campfire Message' },
          { value: 'list_todos',      label: 'List To-Dos' },
        ]}
      />

      {/* ── Project picker (cascading) ────────────────────────────────── */}
      {needsProject && (
        <div className="space-y-1">
          <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Project</span>
          {!credentialId ? (
            <p className="text-[10px] text-slate-400 dark:text-slate-500">Select an account first.</p>
          ) : loadingProjects ? (
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading projects…
            </div>
          ) : errorProjects ? (
            <p className="text-[10px] text-red-400">Failed to load projects.</p>
          ) : (
            <div className="max-h-36 overflow-y-auto rounded-md border border-slate-600 bg-slate-100 dark:bg-slate-800 divide-y divide-slate-700">
              {projects.length === 0 && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No projects found.</p>
              )}
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onChange({ projectId: String(p.id), todolistId: '', groupId: '', todoId: '' })}
                  className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                    String(p.id) === projectId
                      ? 'bg-green-600/30 text-green-300'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
          {projectId && projects.length > 0 && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
              Selected: <span className="text-slate-700 dark:text-slate-300">{projects.find((p) => String(p.id) === projectId)?.name ?? projectId}</span>
            </p>
          )}
        </div>
      )}

      {/* ── To-do list picker (cascading from project) ────────────────── */}
      {needsTodolist && projectId && (
        <div className="space-y-1">
          <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">To-Do List</span>
          {loadingTodolists ? (
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Loading to-do lists…
            </div>
          ) : errorTodolists ? (
            <p className="text-[10px] text-red-400">Failed to load to-do lists.</p>
          ) : (
            <div className="max-h-36 overflow-y-auto rounded-md border border-slate-600 bg-slate-100 dark:bg-slate-800 divide-y divide-slate-700">
              {todolists.length === 0 && (
                <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No to-do lists found.</p>
              )}
              {todolists.map((tl) => (
                <button
                  key={tl.id}
                  type="button"
                  onClick={() => onChange({ todolistId: String(tl.id), groupId: '', todoId: '' })}
                  className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                    String(tl.id) === todolistId
                      ? 'bg-green-600/30 text-green-300'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {tl.name}
                  {tl.todosRemaining > 0 && (
                    <span className="ml-1.5 text-[10px] text-slate-400 dark:text-slate-500">({tl.todosRemaining} remaining)</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {todolistId && todolists.length > 0 && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
              Selected: <span className="text-slate-700 dark:text-slate-300">{todolists.find((tl) => String(tl.id) === todolistId)?.name ?? todolistId}</span>
            </p>
          )}
        </div>
      )}

      {/* ── Group (section) picker (optional, cascading from todolist) ── */}
      {needsTodolist && todolistId && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
            Group / Section <span className="text-slate-600">(optional)</span>
          </label>
          {loadingGroups && <p className="text-xs text-slate-400 dark:text-slate-500 italic">Loading groups…</p>}
          {!loadingGroups && todoGroups.length === 0 && (
            <p className="text-[10px] text-slate-600 italic">No groups in this to-do list (all to-dos are ungrouped)</p>
          )}
          {!loadingGroups && todoGroups.length > 0 && (
            <div className="max-h-36 overflow-y-auto rounded-md border border-slate-600 bg-slate-100 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => onChange({ groupId: '' })}
                className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                  !groupId
                    ? 'bg-green-600/30 text-green-300'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                (Ungrouped / Top-level)
              </button>
              {todoGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onChange({ groupId: String(g.id) })}
                  className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors ${
                    String(g.id) === groupId
                      ? 'bg-green-600/30 text-green-300'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
          {groupId && todoGroups.length > 0 && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
              Selected: <span className="text-slate-700 dark:text-slate-300">{todoGroups.find((g) => String(g.id) === groupId)?.name ?? groupId}</span>
            </p>
          )}
        </div>
      )}

      {/* ── create_todo fields ────────────────────────────────────────── */}
      {action === 'create_todo' && (
        <>
          <ExpressionInput
            label="To-Do Title"
            value={String(cfg.content ?? '')}
            onChange={(v) => onChange({ content: v })}
            placeholder="What needs to be done?"
            nodes={otherNodes}
            testResults={testResults}
          />
          <ExpressionTextArea
            label="Description (optional, supports HTML)"
            value={String(cfg.description ?? '')}
            onChange={(v) => onChange({ description: v })}
            placeholder="Additional details…"
            nodes={otherNodes}
            testResults={testResults}
            rows={3}
          />
          <ExpressionInput
            label="Due Date (optional, YYYY-MM-DD)"
            value={String(cfg.dueOn ?? '')}
            onChange={(v) => onChange({ dueOn: v })}
            placeholder="2026-04-15"
            nodes={otherNodes}
            testResults={testResults}
          />
          {/* Assignees multi-select */}
          <BasecampAssigneePicker
            people={people}
            loading={loadingPeople}
            hasProject={!!projectId}
            assigneeIds={String(cfg.assigneeIds ?? '')}
            onChange={(ids) => onChange({ assigneeIds: ids })}
            otherNodes={otherNodes}
            testResults={testResults}
          />
        </>
      )}

      {/* ── complete_todo / uncomplete_todo fields ──────────────────────── */}
      {(action === 'complete_todo' || action === 'uncomplete_todo') && (
        <>
          {/* Optional: pick from a list if project + todolist are set */}
          <div className="space-y-1">
            <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">Project (optional, to browse to-dos)</span>
              {!credentialId ? (
                <p className="text-[10px] text-slate-400 dark:text-slate-500">Select an account first.</p>
              ) : loadingProjects ? (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading…
                </div>
              ) : (
                <Select
                  value={projectId}
                  onChange={(e) => onChange({ projectId: e.target.value, todolistId: '', todoId: '' })}
                  options={[
                    { value: '', label: '— select project —' },
                    ...projects.map((p) => ({ value: String(p.id), label: p.name })),
                  ]}
                />
              )}
          </div>

          {projectId && (
            <div className="space-y-1">
              <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">To-Do List (optional)</span>
              {loadingTodolists ? (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading…
                </div>
              ) : (
                <Select
                  value={todolistId}
                  onChange={(e) => onChange({ todolistId: e.target.value, todoId: '' })}
                  options={[
                    { value: '', label: '— select to-do list —' },
                    ...todolists.map((tl) => ({ value: String(tl.id), label: tl.name })),
                  ]}
                />
              )}
            </div>
          )}

          {todolistId && (
            <div className="space-y-1">
              <span className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                To-Do {todos.length > 0 && (
                  <span className="text-slate-600 font-normal">
                    ({todos.length} {action === 'uncomplete_todo' ? 'completed' : 'active'})
                  </span>
                )}
              </span>
              {loadingTodos ? (
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 py-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading {action === 'uncomplete_todo' ? 'completed' : 'active'} to-dos…
                </div>
              ) : errorTodos ? (
                <p className="text-[10px] text-red-400">Failed to load to-dos.</p>
              ) : (
                <div className="max-h-64 overflow-y-auto rounded-md border border-slate-600 bg-slate-100 dark:bg-slate-800">
                  {todos.length === 0 && (
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 px-2.5 py-2">No to-dos found.</p>
                  )}
                  {(() => {
                    const ungrouped = todos.filter((t) => !t.groupName);
                    const grouped = todos.filter((t) => !!t.groupName);
                    const groupNames = [...new Set(grouped.map((t) => t.groupName!))];
                    return (
                      <>
                        {ungrouped.length > 0 && groupNames.length > 0 && (
                          <div className="px-2.5 py-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/50 uppercase tracking-wider">
                            Ungrouped
                          </div>
                        )}
                        {ungrouped.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => onChange({ todoId: String(t.id) })}
                            className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors flex items-center gap-1.5 ${
                              String(t.id) === String(cfg.todoId ?? '')
                                ? 'bg-green-600/30 text-green-300'
                                : t.completed ? 'text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                            }`}
                          >
                            <span className={`inline-block w-2.5 h-2.5 rounded-sm border flex-shrink-0 ${t.completed ? 'bg-green-600/60 border-green-600' : 'border-slate-500'}`} />
                            <span className={t.completed ? 'line-through' : ''}>{t.title}</span>
                          </button>
                        ))}
                        {groupNames.map((gn) => (
                          <div key={gn}>
                            <div className="px-2.5 py-1 text-[10px] font-semibold text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/50 uppercase tracking-wider">
                              {gn}
                            </div>
                            {grouped.filter((t) => t.groupName === gn).map((t) => (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => onChange({ todoId: String(t.id) })}
                                className={`w-full text-left px-2.5 py-1.5 text-xs transition-colors pl-4 flex items-center gap-1.5 ${
                                  String(t.id) === String(cfg.todoId ?? '')
                                    ? 'bg-green-600/30 text-green-300'
                                    : t.completed ? 'text-slate-400 dark:text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                                }`}
                              >
                                <span className={`inline-block w-2.5 h-2.5 rounded-sm border flex-shrink-0 ${t.completed ? 'bg-green-600/60 border-green-600' : 'border-slate-500'}`} />
                                <span className={t.completed ? 'line-through' : ''}>{t.title}</span>
                              </button>
                            ))}
                          </div>
                        ))}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          <ExpressionInput
            label="To-Do ID"
            value={String(cfg.todoId ?? '')}
            onChange={(v) => onChange({ todoId: v })}
            placeholder="Basecamp to-do ID or pick from list above"
            nodes={otherNodes}
            testResults={testResults}
            hint="You can type a to-do ID directly or pick one from the list above."
          />
        </>
      )}

      {/* ── post_message fields ───────────────────────────────────────── */}
      {action === 'post_message' && (
        <>
          <ExpressionInput
            label="Subject"
            value={String(cfg.subject ?? '')}
            onChange={(v) => onChange({ subject: v })}
            placeholder="Message subject"
            nodes={otherNodes}
            testResults={testResults}
          />
          <ExpressionTextArea
            label="Content (supports HTML)"
            value={String(cfg.text ?? '')}
            onChange={(v) => onChange({ text: v })}
            placeholder="Your message content…"
            nodes={otherNodes}
            testResults={testResults}
            rows={4}
          />
        </>
      )}

      {/* ── post_comment fields ───────────────────────────────────────── */}
      {action === 'post_comment' && (
        <>
          <ExpressionInput
            label="Recording ID"
            value={String(cfg.recordingId ?? '')}
            onChange={(v) => onChange({ recordingId: v })}
            placeholder="Basecamp recording ID (to-do, message, etc.)"
            nodes={otherNodes}
            testResults={testResults}
            hint="The ID of the to-do, message, or other item you want to comment on."
          />
          <ExpressionTextArea
            label="Comment (supports HTML)"
            value={String(cfg.text ?? '')}
            onChange={(v) => onChange({ text: v })}
            placeholder="Your comment…"
            nodes={otherNodes}
            testResults={testResults}
            rows={3}
          />
        </>
      )}

      {/* ── send_campfire fields ──────────────────────────────────────── */}
      {action === 'send_campfire' && (
        <ExpressionTextArea
          label="Message"
          value={String(cfg.text ?? '')}
          onChange={(v) => onChange({ text: v })}
          placeholder="Your Campfire message…"
          nodes={otherNodes}
          testResults={testResults}
          rows={3}
        />
      )}

      {/* ── list_todos fields ─────────────────────────────────────────── */}
      {action === 'list_todos' && (
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="basecamp-include-completed"
            checked={includeCompleted}
            onChange={(e) => onChange({ includeCompleted: e.target.checked })}
            className="w-3.5 h-3.5 rounded"
          />
          <label htmlFor="basecamp-include-completed" className="text-xs text-slate-500 dark:text-slate-400">
            Include completed to-dos (including hidden)
          </label>
        </div>
      )}
    </div>
  );
}

// ── TriggerConfig ────────────────────────────────────────────────────────────

const TRIGGER_TYPE_OPTIONS = [
  { value: 'manual',    label: 'Manual' },
  { value: 'webhook',   label: 'Webhook' },
  { value: 'cron',      label: 'Schedule / Cron' },
  { value: 'app_event', label: 'App Event' },
  { value: 'email',     label: 'Email (Gmail)' },
];

const WEBHOOK_METHOD_OPTIONS = ['POST', 'GET', 'PUT'].map((m) => ({ value: m, label: m }));

const APP_EVENT_APP_OPTIONS = [
  { value: '', label: 'Select an app…' },
  { value: 'basecamp', label: 'Basecamp' },
  { value: 'slack',    label: 'Slack' },
  { value: 'teams',    label: 'Microsoft Teams' },
  { value: 'gmail',    label: 'Gmail' },
];

const APP_EVENT_TYPE_OPTIONS: Record<string, { value: string; label: string }[]> = {
  basecamp: [
    { value: '', label: 'Select an event…' },
    { value: 'new_todo',     label: 'New To-Do created' },
    { value: 'new_message',  label: 'New Message posted' },
    { value: 'new_comment',  label: 'New Comment posted' },
    { value: 'todo_completed', label: 'To-Do completed' },
  ],
  slack: [
    { value: '', label: 'Select an event…' },
    { value: 'new_message',  label: 'New message in channel' },
    { value: 'new_reaction', label: 'New reaction added' },
  ],
  teams: [
    { value: '', label: 'Select an event…' },
    { value: 'new_message',  label: 'New message in channel' },
  ],
  gmail: [
    { value: '', label: 'Select an event…' },
    { value: 'new_email', label: 'New email received' },
  ],
};

const CRON_PRESETS = [
  { value: '',                 label: 'Choose a preset…' },
  { value: '* * * * *',       label: 'Every minute' },
  { value: '*/5 * * * *',     label: 'Every 5 minutes' },
  { value: '*/15 * * * *',    label: 'Every 15 minutes' },
  { value: '0 * * * *',       label: 'Every hour' },
  { value: '0 0 * * *',       label: 'Every day at midnight' },
  { value: '0 9 * * *',       label: 'Every day at 9:00 AM' },
  { value: '0 9 * * 1-5',     label: 'Every weekday at 9 AM' },
  { value: '0 9 * * 1',       label: 'Every Monday at 9 AM' },
  { value: '0 0 1 * *',       label: 'First of month at midnight' },
];

const LABEL_FILTER_OPTIONS = [
  { value: 'INBOX',     label: 'Inbox' },
  { value: 'UNREAD',    label: 'Unread' },
  { value: 'STARRED',   label: 'Starred' },
  { value: 'IMPORTANT', label: 'Important' },
];

function describeCron(expr: string): string {
  const preset = CRON_PRESETS.find((p) => p.value === expr);
  return preset?.label ?? '';
}

function TriggerConfig({
  cfg,
  onChange,
  workflowId,
  nodeId,
}: ConfigProps & { workflowId: string; nodeId: string }) {
  const triggerType = (cfg.triggerType as string) || 'manual';
  const credentials = useCredentialList();

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = workflowId && nodeId
    ? `${baseUrl}/webhooks/${workflowId}/trigger/${nodeId}`
    : '';

  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const credentialOptions = (provider: string) => {
    const filtered = (credentials.data ?? []).filter((c) => {
      if (provider === 'gmail') return c.provider === 'google';
      return c.provider === provider;
    });
    return [
      { value: '', label: 'Select credential…' },
      ...filtered.map((c) => ({ value: c.id, label: c.label || c.provider })),
    ];
  };

  return (
    <div className="space-y-3">
      <Select
        label="Trigger Type"
        value={triggerType}
        onChange={(e) => onChange({ triggerType: e.target.value })}
        options={TRIGGER_TYPE_OPTIONS}
      />

      {/* ── Manual ── */}
      {triggerType === 'manual' && (
        <div className="bg-slate-100 dark:bg-slate-800/50 rounded-lg p-3 space-y-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Click <span className="font-semibold text-purple-400">Run</span> or use the{' '}
            <span className="font-semibold text-purple-400">Test This Node</span> button to trigger this workflow manually.
          </p>
        </div>
      )}

      {/* ── Webhook ── */}
      {triggerType === 'webhook' && (
        <div className="space-y-3">
          <Select
            label="HTTP Method"
            value={(cfg.webhookMethod as string) || 'POST'}
            onChange={(e) => onChange({ webhookMethod: e.target.value })}
            options={WEBHOOK_METHOD_OPTIONS}
          />

          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Webhook URL</label>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                readOnly
                value={webhookUrl || 'Save workflow first to generate URL'}
                className="flex-1 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 font-mono select-all"
              />
              {webhookUrl && (
                <button
                  type="button"
                  className="p-1.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
                  onClick={() => {
                    navigator.clipboard.writeText(webhookUrl);
                    setCopiedWebhook(true);
                    setTimeout(() => setCopiedWebhook(false), 2000);
                  }}
                >
                  {copiedWebhook ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
                </button>
              )}
            </div>
            {webhookUrl && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                Send a {(cfg.webhookMethod as string) || 'POST'} request to this URL to trigger the workflow.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Cron / Schedule ── */}
      {triggerType === 'cron' && (
        <div className="space-y-3">
          <Select
            label="Preset"
            value=""
            onChange={(e) => { if (e.target.value) onChange({ cronExpression: e.target.value }); }}
            options={CRON_PRESETS}
          />

          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Cron Expression</label>
            <input
              type="text"
              value={(cfg.cronExpression as string) || ''}
              onChange={(e) => onChange({ cronExpression: e.target.value })}
              placeholder="* * * * *"
              className="w-full rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs text-gray-900 dark:text-white font-mono placeholder-slate-600"
            />
            {Boolean(cfg.cronExpression) && (
              <p className="text-[10px] text-slate-400 dark:text-slate-500">
                {describeCron(cfg.cronExpression as string) || 'Custom expression'}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Timezone (optional)</label>
            <input
              type="text"
              value={(cfg.cronTimezone as string) || ''}
              onChange={(e) => onChange({ cronTimezone: e.target.value })}
              placeholder="e.g. America/New_York"
              className="w-full rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs text-gray-900 dark:text-white placeholder-slate-600"
            />
          </div>
        </div>
      )}

      {/* ── App Event ── */}
      {triggerType === 'app_event' && (
        <div className="space-y-3">
          <Select
            label="App"
            value={(cfg.appType as string) || ''}
            onChange={(e) => onChange({ appType: e.target.value, eventType: '', credentialId: '' })}
            options={APP_EVENT_APP_OPTIONS}
          />

          {Boolean(cfg.appType) && (
            <>
              <Select
                label="Event"
                value={(cfg.eventType as string) || ''}
                onChange={(e) => onChange({ eventType: e.target.value })}
                options={APP_EVENT_TYPE_OPTIONS[cfg.appType as string] ?? [{ value: '', label: 'Select an event…' }]}
              />

              <Select
                label="Credential"
                value={(cfg.credentialId as string) || ''}
                onChange={(e) => onChange({ credentialId: e.target.value })}
                options={credentialOptions(cfg.appType as string)}
              />

              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
                  Poll Interval (minutes)
                </label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={(cfg.pollIntervalMinutes as number) || 5}
                  onChange={(e) => onChange({ pollIntervalMinutes: Number(e.target.value) })}
                  className="w-full rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs text-gray-900 dark:text-white"
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Email (Gmail) ── */}
      {triggerType === 'email' && (
        <div className="space-y-3">
          <Select
            label="Gmail Credential"
            value={(cfg.credentialId as string) || ''}
            onChange={(e) => onChange({ credentialId: e.target.value })}
            options={credentialOptions('gmail')}
          />

          <Select
            label="Label Filter"
            value={(cfg.labelFilter as string) || 'INBOX'}
            onChange={(e) => onChange({ labelFilter: e.target.value })}
            options={LABEL_FILTER_OPTIONS}
          />

          <div className="space-y-1">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">
              Poll Interval (minutes)
            </label>
            <input
              type="number"
              min={1}
              max={1440}
              value={(cfg.pollIntervalMinutes as number) || 5}
              onChange={(e) => onChange({ pollIntervalMinutes: Number(e.target.value) })}
              className="w-full rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs text-gray-900 dark:text-white"
            />
          </div>
        </div>
      )}
    </div>
  );
}

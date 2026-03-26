import { Settings2, Star, Braces, Play, Loader2, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Clock, Copy, Check, ArrowRight } from 'lucide-react';
import { useRef, useState } from 'react';
import { useWorkflowStore } from '../../store/workflowStore';
import type { CanvasNode } from '../../store/workflowStore';
import { Select } from '../ui/Input';
import { useTestNode, useNodeTestResults } from '../../hooks/useNodeTest';
import type { NodeTestResult } from '../../types/workflow';

// ── Output field catalogue (human-friendly labels per node type) ──────────────

interface OutputField {
  key: string;
  label: string;
}

const NODE_OUTPUT_FIELDS: Record<string, OutputField[]> = {
  trigger: [{ key: 'payload', label: 'Trigger payload (full input)' }],
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
};

// ── "No data" badge ───────────────────────────────────────────────────────────

function NoDataBadge() {
  return (
    <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold bg-amber-900/40 text-amber-400 border border-amber-700/40">
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
      <span className="text-slate-400">[{value.length} item{value.length !== 1 ? 's' : ''}]</span>
    );
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    if (keys.length === 0) return <NoDataBadge />;
    return <span className="text-slate-400">{'{'}{keys.slice(0, 2).join(', ')}{keys.length > 2 ? ', …' : ''}{'}'}</span>;
  }
  const str = String(value);
  return (
    <span className="text-emerald-400 font-mono">
      {str.length > 40 ? str.slice(0, 40) + '…' : str}
    </span>
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
      <div className="bg-slate-800 px-2.5 py-1.5 border-b border-slate-700">
        <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider">
          Click a field to insert it
        </p>
        <p className="text-[10px] text-slate-500 mt-0.5">
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
                <span className="text-[11px] font-semibold text-white truncate">{n.data.label}</span>
                <span className="text-[9px] text-slate-500 shrink-0">{n.data.nodeType}</span>
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
                      className="inline-flex items-center gap-1 text-[10px] bg-slate-700 hover:bg-blue-700 text-emerald-300 hover:text-white rounded px-1.5 py-0.5 font-mono transition-colors"
                      title="Replace YOUR_KEY with your mapping key name"
                    >
                      .YOUR_KEY
                    </button>
                    <span className="text-[10px] text-slate-500 self-center">← replace with your mapping key</span>
                  </>
                ) : fields.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => onInsert(`{{nodes.${n.id}}}`)}
                    className="text-[10px] bg-slate-700 hover:bg-blue-700 text-emerald-300 hover:text-white rounded px-1.5 py-0.5 font-mono transition-colors"
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
                        className="inline-flex items-center gap-1 text-[10px] bg-slate-700 hover:bg-blue-700 text-emerald-300 hover:text-white rounded px-1.5 py-0.5 transition-colors font-mono"
                      >
                        <span>.{f.key}</span>
                        {f.hasReal ? (
                          <span className="font-sans text-slate-400 group-hover:text-slate-200 ml-0.5">
                            = <ValuePreview value={f.realValue} />
                          </span>
                        ) : (
                          <span className="font-sans text-slate-500 ml-0.5">{f.label}</span>
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
  const ref = useRef<HTMLTextAreaElement>(null);

  function handleInsert(expr: string) {
    if (ref.current) insertAtCursor(ref.current, expr, value, onChange);
    else onChange(value + expr);
    setOpen(false);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-1">
        <label className="block text-xs font-medium text-slate-400">{label}</label>
        {nodes.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((p) => !p)}
            title="Insert a variable from another node"
            className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors shrink-0 ${
              open ? 'bg-blue-600 text-white' : 'text-blue-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            <Braces className="w-2.5 h-2.5" />
            Insert variable
          </button>
        )}
      </div>
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-800 border border-slate-600 text-slate-200 rounded-md px-2.5 py-1.5 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-none"
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
  const ref = useRef<HTMLInputElement>(null);

  function handleInsert(expr: string) {
    if (ref.current) insertAtCursor(ref.current, expr, value, onChange);
    else onChange(value + expr);
    setOpen(false);
  }

  return (
    <div className="space-y-1">
      {(label || nodes.length > 0) && (
        <div className="flex items-center justify-between gap-1">
          {label && <label className="block text-xs font-medium text-slate-400">{label}</label>}
          {nodes.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((p) => !p)}
              title="Insert a variable from another node"
              className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors shrink-0 ${
                open ? 'bg-blue-600 text-white' : 'text-blue-400 hover:text-white hover:bg-slate-700'
              }`}
            >
              <Braces className="w-2.5 h-2.5" />
              Insert variable
            </button>
          )}
        </div>
      )}
      <input
        ref={ref}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-slate-800 border border-slate-600 text-slate-200 rounded-md px-2.5 py-1.5 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
      />
      {hint && <p className="text-slate-500 text-[10px]">{hint}</p>}
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
      className={`p-1 rounded hover:bg-slate-700 transition-colors text-slate-500 hover:text-slate-200 ${className}`}
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
      result.status === 'success' ? 'bg-emerald-900/30' : 'bg-red-900/30'
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
      <div className="flex items-center gap-2.5 text-[10px] text-slate-500">
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
            <p className="text-xs font-medium text-slate-300">
              {httpOk ? 'Request succeeded' : 'Request failed'}
            </p>
            <p className="text-[10px] text-slate-500">HTTP status code</p>
          </div>
        </div>
      )}

      {/* Response body */}
      {bodyStr && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              Response data
            </span>
            <CopyButton text={bodyStr} />
          </div>
          <pre className="bg-slate-800 rounded-md p-2.5 text-[10px] text-slate-300 font-mono overflow-auto max-h-44 leading-relaxed whitespace-pre-wrap break-all">
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
            className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            {headersOpen
              ? <ChevronUp   className="w-3 h-3" />
              : <ChevronDown className="w-3 h-3" />}
            Response headers ({Object.keys(out.headers).length})
          </button>
          {headersOpen && (
            <div className="mt-1 space-y-0.5 bg-slate-800 rounded p-2">
              {Object.entries(out.headers).map(([k, v]) => (
                <div key={k} className="flex gap-1 text-[10px]">
                  <span className="text-slate-500 shrink-0 min-w-0">{k}:</span>
                  <span className="text-slate-400 break-all">{v}</span>
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
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              AI Response
            </span>
            <CopyButton text={out.content} />
          </div>
          <div className="bg-slate-800 rounded-md p-2.5 border-l-2 border-blue-500">
            <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap">
              {out.content}
            </p>
          </div>
        </div>
      )}

      {/* Stats strip */}
      <div className="flex flex-wrap gap-3 text-[10px] text-slate-500 bg-slate-800/50 rounded px-2.5 py-2">
        {out.model && (
          <span>
            <span className="text-slate-400 font-medium">Model </span>
            {out.model}
          </span>
        )}
        {out.usage?.totalTokens != null && (
          <span>
            <span className="text-slate-400 font-medium">Tokens </span>
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
        <p className="text-xs text-slate-300 leading-snug">
          {passed
            ? 'Condition was met — takes the true branch'
            : 'Condition was not met — takes the false branch'}
        </p>
      </div>
      {out.nextNodeId && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <ArrowRight className="w-3 h-3 shrink-0" />
          Routes to node{' '}
          <span className="font-mono text-slate-400">{out.nextNodeId}</span>
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
        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">
          Matched case
        </p>
        <span className={`inline-block px-2.5 py-1 rounded text-xs font-semibold ${
          isDefault
            ? 'bg-slate-700 text-slate-300'
            : 'bg-blue-900/50 text-blue-300 border border-blue-700/40'
        }`}>
          {out.matchedCase ?? 'default'}
        </span>
      </div>
      {out.nextNodeId && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <ArrowRight className="w-3 h-3 shrink-0" />
          Routes to{' '}
          <span className="font-mono text-slate-400">{out.nextNodeId}</span>
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
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Output</span>
          <CopyButton text={out} />
        </div>
        <div className="bg-slate-800 rounded-md p-2.5">
          <p className="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">{out}</p>
        </div>
      </div>
    );
  }

  if (typeof out === 'object' && out !== null) {
    const entries = Object.entries(out as Record<string, unknown>);
    return (
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            Output — {entries.length} field{entries.length !== 1 ? 's' : ''}
          </span>
          <CopyButton text={outStr} />
        </div>
        <div className="space-y-1">
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-start gap-2 bg-slate-800 rounded px-2.5 py-1.5">
              <span className="text-[10px] font-mono text-blue-400 shrink-0 pt-0.5 min-w-[60px]">{k}</span>
              <span className="text-[10px] text-slate-300 break-all min-w-0 flex-1">
                {v == null
                  ? <span className="text-slate-600 italic">empty</span>
                  : typeof v === 'boolean'
                    ? <span className={v ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                        {v ? 'true' : 'false'}
                      </span>
                    : typeof v === 'object'
                      ? <span className="text-slate-400 font-mono">{JSON.stringify(v)}</span>
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
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Output</span>
        {out != null && <CopyButton text={String(out)} />}
      </div>
      <p className="text-xs text-slate-200 bg-slate-800 rounded px-2.5 py-2">
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
        <div className="p-3 bg-red-950/20 space-y-1">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">What went wrong</p>
          <p className="text-xs text-red-300 break-words leading-relaxed">{result.error}</p>
        </div>
      )}

      {/* Success output — node-type-aware */}
      {result.status === 'success' && result.output != null && (
        <div className="bg-slate-900/80">
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

  const displayResult = localResult ?? savedResult;

  async function handleRun() {
    const result = await testNode.mutateAsync({ workflowId, nodeId });
    setLocalResult(result);
  }

  return (
    <div className="rounded-md border border-slate-700 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="w-full flex items-center justify-between px-2.5 py-1.5 bg-slate-800 hover:bg-slate-750 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <Play className="w-3 h-3 text-blue-400" />
          <span className="text-[10px] font-semibold text-slate-300 uppercase tracking-wider">
            Test this node
          </span>
          {displayResult && (
            <span className={`w-1.5 h-1.5 rounded-full ${
              displayResult.status === 'success' ? 'bg-emerald-400' : 'bg-red-400'
            }`} />
          )}
        </div>
        {open ? <ChevronUp className="w-3 h-3 text-slate-500" /> : <ChevronDown className="w-3 h-3 text-slate-500" />}
      </button>

      {open && (
        <div className="p-2.5 space-y-2.5 bg-slate-900/60">
          {/* Run button */}
          <button
            type="button"
            onClick={handleRun}
            disabled={testNode.isPending}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-xs font-medium transition-colors"
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

// ── Main panel ────────────────────────────────────────────────────────────────

export function NodeConfigPanel() {
  const { nodes, selectedNodeId, setNodes, activeWorkflow, setActiveWorkflow } =
    useWorkflowStore();

  const isUnsaved = !activeWorkflow?.id || activeWorkflow.id.startsWith('__new__');
  const { data: testResults = {} } = useNodeTestResults(
    isUnsaved ? null : activeWorkflow?.id
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  if (!selectedNode) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-2 px-4 text-center">
        <Settings2 className="w-8 h-8" />
        <p className="text-xs">Click a node to edit its configuration</p>
      </div>
    );
  }

  const { data } = selectedNode;
  const nodeType = data.nodeType as string;

  function updateConfig(patch: Record<string, unknown>) {
    const updated = nodes.map((n) =>
      n.id === selectedNodeId
        ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } } }
        : n
    );
    setNodes(updated);
  }

  function updateData(patch: Partial<typeof data>) {
    const updated = nodes.map((n) =>
      n.id === selectedNodeId ? { ...n, data: { ...n.data, ...patch } } : n
    );
    setNodes(updated);
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

  const entryCount = nodes.filter(n => n.data.isEntry).length;
  const cfg = data.config as Record<string, unknown>;
  const otherNodes = nodes.filter((n) => n.id !== selectedNodeId);
  const savedTestResult = selectedNodeId ? (testResults[selectedNodeId] ?? null) : null;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">{nodeType}</p>
          <p className="text-sm font-semibold text-white truncate">{data.label}</p>
        </div>
        <button
          onClick={toggleEntry}
          title={data.isEntry ? 'Remove as start node' : 'Mark as start node (⭐ = runs on trigger)'}
          className={`transition-colors ${data.isEntry ? 'text-amber-400' : 'text-slate-500 hover:text-amber-400'}`}
        >
          <Star className={`w-4 h-4 ${data.isEntry ? 'fill-amber-400' : ''}`} />
        </button>
      </div>

      {/* Multi-entry hint */}
      {entryCount > 1 && data.isEntry && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-amber-900/20 border border-amber-700/30 rounded-md">
          <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400 shrink-0" />
          <p className="text-[10px] text-amber-300">
            {entryCount} start nodes — they will run simultaneously when triggered.
          </p>
        </div>
      )}

      {/* Node name */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-400">Node name</label>
        <input
          type="text"
          value={data.label}
          onChange={(e) => updateData({ label: e.target.value })}
          className="w-full bg-slate-800 border border-slate-600 text-slate-200 rounded-md px-2.5 py-1.5 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Test panel */}
      {isUnsaved ? (
        <div className="flex items-center gap-1.5 px-2.5 py-2 bg-slate-800/50 rounded-md border border-slate-700">
          <AlertCircle className="w-3 h-3 text-slate-500 shrink-0" />
          <p className="text-[10px] text-slate-500">Save the workflow first to enable node testing.</p>
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

      <div className="border-t border-slate-700" />

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

      {/* Retry & Timeout */}
      <div className="border-t border-slate-700" />
      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Retry & Timeout</p>
      {[
        { label: 'Retries (0–5)', key: 'retries', min: 0, max: 5, val: data.retries ?? 0 },
        { label: 'Retry delay (ms)', key: 'retryDelayMs', min: 0, val: data.retryDelayMs ?? 0 },
        { label: 'Timeout (ms, 0 = none)', key: 'timeoutMs', min: 0, val: data.timeoutMs ?? 0 },
      ].map(({ label, key, min, max, val }) => (
        <div key={key} className="space-y-1">
          <label className="block text-xs font-medium text-slate-400">{label}</label>
          <input
            type="number"
            min={min}
            max={max}
            value={String(val)}
            onChange={(e) =>
              updateData({
                [key]: key === 'timeoutMs'
                  ? (Number(e.target.value) || undefined)
                  : Number(e.target.value),
              })
            }
            className="w-full bg-slate-800 border border-slate-600 text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      ))}
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
          <label className="block text-xs font-medium text-slate-400">Headers</label>
          <button
            type="button"
            onClick={addHeader}
            className="text-[10px] text-blue-400 hover:text-white hover:bg-slate-700 px-1.5 py-0.5 rounded transition-colors"
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
              className="flex-1 min-w-0 bg-slate-800 border border-slate-600 text-slate-200 rounded px-2 py-1 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={key}
              onChange={(e) => updateHeader(key, e.target.value, value)}
              placeholder="Header name"
            />
            <span className="text-slate-600 text-xs shrink-0">:</span>
            <input
              className="flex-1 min-w-0 bg-slate-800 border border-slate-600 text-slate-200 rounded px-2 py-1 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={value}
              onChange={(e) => updateHeader(key, key, e.target.value)}
              placeholder="Value"
            />
            <button
              type="button"
              onClick={() => removeHeader(key)}
              className="text-slate-500 hover:text-red-400 px-1 shrink-0 text-sm"
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
        <label className="block text-xs font-medium text-slate-400">Model</label>
        <input type="text" value={String(cfg.model ?? '')} onChange={(e) => onChange({ model: e.target.value })}
          placeholder="gpt-4o-mini"
          className="w-full bg-slate-800 border border-slate-600 text-slate-200 rounded-md px-2.5 py-1.5 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-400">Temperature (0–2)</label>
        <input type="number" min={0} max={2} step={0.1} value={String(cfg.temperature ?? 0.7)}
          onChange={(e) => onChange({ temperature: parseFloat(e.target.value) })}
          className="w-full bg-slate-800 border border-slate-600 text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-slate-400">Max tokens</label>
        <input type="number" min={1} value={String(cfg.maxTokens ?? 500)}
          onChange={(e) => onChange({ maxTokens: Number(e.target.value) })}
          className="w-full bg-slate-800 border border-slate-600 text-slate-200 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
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

function ConditionConfig({ cfg, onChange, otherNodes, testResults }: ConfigProps) {
  const condition = (cfg.condition as Record<string, unknown>) ?? {};
  function updateCond(patch: Record<string, unknown>) {
    onChange({ condition: { ...condition, ...patch } });
  }
  return (
    <>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Condition</p>
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
        value={String(condition.operator ?? 'eq')}
        onChange={(e) => updateCond({ operator: e.target.value })}
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
      <ExpressionInput
        label="Right side (value to compare)"
        value={String(condition.right ?? '')}
        onChange={(v) => updateCond({ right: v })}
        placeholder="200"
        nodes={otherNodes}
        testResults={testResults}
      />
      <p className="text-[10px] text-slate-500 mt-1">
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
          <div key={i} className="bg-slate-800 rounded-md p-2 space-y-2">
            <div className="flex items-center justify-between gap-1">
              <input
                className="flex-1 min-w-0 bg-slate-700 border border-slate-600 text-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={String(c.label ?? `Case ${i + 1}`)}
                onChange={(e) => updateCase(i, { label: e.target.value })}
                placeholder="Case label"
              />
              <button onClick={() => removeCase(i)} className="text-slate-500 hover:text-red-400 ml-1 shrink-0 text-sm">×</button>
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
              onChange={(e) => updateCase(i, { condition: { ...cond, operator: e.target.value } })}
              options={[
                { value: 'eq', label: 'equals (=)' },
                { value: 'neq', label: 'not equals (≠)' },
                { value: 'gt', label: 'greater than (>)' },
                { value: 'lt', label: 'less than (<)' },
                { value: 'contains', label: 'contains' },
              ]}
            />
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-400">Compare to</label>
              <input
                className="w-full bg-slate-700 border border-slate-600 text-slate-200 rounded px-2 py-1 text-xs placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={String(cond.right ?? '')}
                onChange={(e) => updateCase(i, { condition: { ...cond, right: e.target.value } })}
                placeholder="e.g. 200"
              />
            </div>
          </div>
        );
      })}
      <button
        onClick={addCase}
        className="w-full text-xs text-slate-400 hover:text-white border border-dashed border-slate-600 hover:border-slate-400 rounded-md py-1.5 transition-colors"
      >
        + Add case
      </button>
      <p className="text-[10px] text-slate-500">
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
      <p className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Mappings</p>
      <p className="text-[10px] text-slate-500">
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
        className="w-full text-xs text-slate-400 hover:text-white border border-dashed border-slate-600 hover:border-slate-400 rounded-md py-1.5 transition-colors"
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
          className="flex-1 min-w-0 bg-slate-800 border border-slate-600 text-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          value={outputKey}
          onChange={(e) => onKeyChange(e.target.value)}
          placeholder="outputKey"
        />
        <span className="text-slate-600 text-xs shrink-0">←</span>
        <input
          ref={valueRef}
          className="flex-1 min-w-0 bg-slate-800 border border-slate-600 text-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              pickerOpen ? 'bg-blue-600 text-white' : 'text-blue-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            <Braces className="w-3 h-3" />
          </button>
        )}
        <button onClick={onRemove} className="text-slate-500 hover:text-red-400 px-1 shrink-0 text-sm">×</button>
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

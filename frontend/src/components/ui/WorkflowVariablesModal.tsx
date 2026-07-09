import { useEffect, useRef, useState } from 'react';
import {
  X, Braces, Plus, Trash2, Loader2, CheckCircle2, AlertCircle, Info, Workflow, Copy, Check,
} from 'lucide-react';
import { useWorkflowStore } from '../../store/workflowStore';
import { useUpdateWorkflow } from '../../hooks/useWorkflows';
import type { WorkflowVariable } from '../../types/workflow';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Row extends WorkflowVariable {
  /** Stable client-only id so React keys survive key edits */
  _id: string;
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function makeRow(v?: Partial<WorkflowVariable>): Row {
  return {
    _id: `var-${Math.random().toString(36).slice(2, 10)}`,
    key: v?.key ?? '',
    value: v?.value ?? '',
    description: v?.description ?? '',
  };
}

export function WorkflowVariablesModal({ open, onClose }: Props) {
  const activeWorkflow = useWorkflowStore((s) => s.activeWorkflow);
  const setActiveWorkflow = useWorkflowStore((s) => s.setActiveWorkflow);
  const setDirty = useWorkflowStore((s) => s.setDirty);
  const update = useUpdateWorkflow();

  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isUnsaved = !activeWorkflow?.id || activeWorkflow.id.startsWith('__new__');

  // Seed the editor from the active workflow each time the modal opens.
  useEffect(() => {
    if (!open) return;
    const existing = activeWorkflow?.variables ?? [];
    setRows(existing.length > 0 ? existing.map((v) => makeRow(v)) : [makeRow()]);
    setError('');
    setSaveStatus('idle');
  }, [open, activeWorkflow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); }, []);

  if (!open) return null;

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r._id === id ? { ...r, ...patch } : r)));
    setError('');
  }

  function addRow() {
    setRows((prev) => [...prev, makeRow()]);
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r._id !== id));
    setError('');
  }

  async function copyRef(row: Row) {
    if (!row.key) return;
    try {
      await navigator.clipboard.writeText(`{{vars.${row.key}}}`);
      setCopiedId(row._id);
      setTimeout(() => setCopiedId((c) => (c === row._id ? null : c)), 1500);
    } catch { /* clipboard unavailable */ }
  }

  /** Validate + normalise rows into the persisted variable list. */
  function build(): WorkflowVariable[] | null {
    const cleaned: WorkflowVariable[] = [];
    const seen = new Set<string>();

    for (const r of rows) {
      const key = r.key.trim();
      // Skip fully-empty rows so an accidental blank line isn't an error.
      if (!key && !r.value.trim() && !(r.description ?? '').trim()) continue;

      if (!key) {
        setError('Every variable needs a name.');
        return null;
      }
      if (!KEY_RE.test(key)) {
        setError(`"${key}" is not a valid name. Use letters, numbers, and underscores; start with a letter or underscore.`);
        return null;
      }
      if (seen.has(key)) {
        setError(`Duplicate variable name "${key}". Names must be unique.`);
        return null;
      }
      seen.add(key);

      const desc = (r.description ?? '').trim();
      cleaned.push({ key, value: r.value, ...(desc ? { description: desc } : {}) });
    }

    return cleaned;
  }

  async function handleSave() {
    const cleaned = build();
    if (cleaned === null) return;
    if (!activeWorkflow) return;

    setSaveStatus('saving');
    try {
      if (!isUnsaved) {
        const updated = await update.mutateAsync({
          id: activeWorkflow.id,
          body: { variables: cleaned },
        });
        setActiveWorkflow({
          ...activeWorkflow,
          variables: cleaned,
          version: updated?.version ?? activeWorkflow.version,
        });
      } else {
        // Unsaved workflow — keep the values in the store so they're included in
        // the definition on the next full save, and mark the canvas dirty.
        setActiveWorkflow({ ...activeWorkflow, variables: cleaned });
        setDirty(true);
      }
      setSaveStatus('saved');
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      setSaveStatus('idle');
      setError(err instanceof Error ? err.message : 'Failed to save variables.');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-white dark:bg-[#1a2236] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col max-h-[90vh] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-slate-700/60 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center">
            <Braces className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white leading-tight">
              Workflow Variables
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {activeWorkflow?.name
                ? <span className="flex items-center gap-1"><Workflow className="w-3 h-3" />{activeWorkflow.name}</span>
                : 'Reusable values for this workflow'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {!activeWorkflow ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <Workflow className="w-8 h-8 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Open a workflow to define its variables.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30">
                <Info className="w-4 h-4 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
                <p className="text-xs text-indigo-700 dark:text-indigo-300 leading-relaxed">
                  Define values once and reuse them across any node in this workflow with{' '}
                  <code className="bg-indigo-100 dark:bg-indigo-500/20 px-1 py-0.5 rounded text-[11px]">{'{{vars.name}}'}</code>.
                  Variables are scoped to this workflow only. Do not store secrets here — values are saved in plain text.
                </p>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-[1fr_1.3fr_auto] gap-2 px-1">
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Name</span>
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Value</span>
                <span className="w-16" />
              </div>

              {/* Rows */}
              <div className="space-y-2">
                {rows.map((row) => (
                  <div key={row._id} className="grid grid-cols-[1fr_1.3fr_auto] gap-2 items-start">
                    <div>
                      <input
                        value={row.key}
                        onChange={(e) => updateRow(row._id, { key: e.target.value })}
                        placeholder="BASE_URL"
                        spellCheck={false}
                        className="w-full px-2.5 py-2 text-sm font-mono rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/15 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      />
                      <input
                        value={row.description ?? ''}
                        onChange={(e) => updateRow(row._id, { description: e.target.value })}
                        placeholder="Description (optional)"
                        className="w-full mt-1 px-2.5 py-1 text-[11px] rounded-lg bg-transparent border border-transparent hover:border-slate-200 dark:hover:border-white/10 focus:border-slate-200 dark:focus:border-white/10 text-slate-500 dark:text-slate-400 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none"
                      />
                    </div>
                    <input
                      value={row.value}
                      onChange={(e) => updateRow(row._id, { value: e.target.value })}
                      placeholder="https://api.example.com"
                      className="w-full px-2.5 py-2 text-sm rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/15 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    />
                    <div className="flex items-center gap-1 pt-1">
                      <button
                        onClick={() => copyRef(row)}
                        disabled={!row.key}
                        title={row.key ? `Copy {{vars.${row.key}}}` : 'Name the variable to copy its reference'}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {copiedId === row._id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => removeRow(row._id)}
                        title="Remove variable"
                        className="p-1.5 rounded-lg text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={addRow}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add variable
              </button>

              {error && (
                <div className="flex items-center gap-2 text-xs text-red-500 dark:text-red-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-slate-700/60 shrink-0 bg-slate-50/50 dark:bg-white/[0.02]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!activeWorkflow || saveStatus === 'saving'}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            {saveStatus === 'saving' ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</>
            ) : saveStatus === 'saved' ? (
              <><CheckCircle2 className="w-3.5 h-3.5" />Saved</>
            ) : (
              'Save variables'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import CodeMirror from '@uiw/react-codemirror';
import {
  EditorView,
  Decoration,
  WidgetType,
  ViewPlugin,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import {
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  autocompletion,
  completionKeymap,
  acceptCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { Braces, X, ChevronLeft } from 'lucide-react';
import { useWorkflowStore } from '../../store/workflowStore';
import type { CanvasNode } from '../../store/workflowStore';
import type { NodeTestResult } from '../../types/workflow';
import { VariablePickerPanel, computeNodeFields, nodeTypeLabel } from './NodeConfigPanel';
import { NodeIcon } from '../nodes/NodeIcons';

// ── Token model ───────────────────────────────────────────────────────────────
//
// The stored field value keeps the template form (`{{nodes.<id>.<field>}}` /
// `{{vars.<key>}}`) so the backend ExpressionResolver is unaffected. This editor
// only changes *rendering* (tokens shown as chips) and *entry* (@ autocomplete).

const TOKEN_RE =
  /\{\{\s*(?:nodes\.[A-Za-z0-9_-]+(?:\.[^}]*?)?|vars\.[A-Za-z0-9_.]+)\s*\}\}/g;

type TokenInfo =
  | { kind: 'node'; type: string; name: string; field: string }
  | { kind: 'vars'; key: string };

function parseToken(token: string, nodes: CanvasNode[]): TokenInfo | null {
  const nm = token.match(/^\{\{\s*nodes\.([A-Za-z0-9_-]+)(?:\.([^}]*?))?\s*\}\}$/);
  if (nm) {
    const id = nm[1];
    const field = (nm[2] ?? '').trim();
    const node = nodes.find((n) => n.id === id);
    return { kind: 'node', type: node?.data.nodeType ?? '', name: node?.data.label ?? id, field };
  }
  const vm = token.match(/^\{\{\s*vars\.([A-Za-z0-9_.]+)\s*\}\}$/);
  if (vm) return { kind: 'vars', key: vm[1] };
  return null;
}

// Stable identity string so the chip widget re-renders when the label changes
// (e.g. a referenced node is renamed) even if the raw token text is unchanged.
function tokenLabelKey(token: string, nodes: CanvasNode[]): string {
  const info = parseToken(token, nodes);
  if (!info) return `raw|${token}`;
  return info.kind === 'vars'
    ? `vars|${info.key}`
    : `node|${info.type}|${info.name}|${info.field}`;
}

const CHIP_CLASS =
  'cm-expr-chip inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 mx-[1px] rounded bg-blue-100 ' +
  'dark:bg-blue-900/60 border border-blue-300 dark:border-blue-700/50 text-[10px] font-medium ' +
  'align-middle whitespace-nowrap cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800/70';

function chipPart(text: string, cls: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}
function chipSep(): HTMLSpanElement {
  return chipPart('·', 'text-blue-400 dark:text-blue-600');
}

function renderChipDOM(token: string, nodes: CanvasNode[]): HTMLElement {
  const span = document.createElement('span');
  span.className = CHIP_CLASS;
  span.title = 'Click to change · double-click to edit as text';
  const info = parseToken(token, nodes);
  const body = document.createElement('span');
  body.className = 'cm-expr-chip-body inline-flex items-center gap-1';
  if (!info) {
    body.textContent = token;
  } else if (info.kind === 'vars') {
    body.appendChild(chipPart('VAR', 'text-indigo-600 dark:text-indigo-400 font-bold uppercase text-[9px]'));
    body.appendChild(chipSep());
    body.appendChild(chipPart(info.key, 'font-mono text-indigo-700 dark:text-indigo-300'));
  } else {
    body.appendChild(chipPart(nodeTypeLabel(info.type), 'text-blue-700 dark:text-blue-400 font-bold uppercase text-[9px]'));
    body.appendChild(chipSep());
    body.appendChild(chipPart(info.name, 'text-gray-900 dark:text-slate-200'));
    if (info.field) {
      body.appendChild(chipSep());
      body.appendChild(chipPart(info.field, 'font-mono text-blue-700 dark:text-blue-300'));
    }
  }
  span.appendChild(body);

  const remove = document.createElement('span');
  remove.className =
    'cm-expr-chip-remove inline-flex items-center justify-center w-3 h-3 rounded-sm leading-none ' +
    'text-blue-400 hover:text-white hover:bg-red-500 dark:hover:bg-red-600 font-bold text-[11px]';
  remove.textContent = '×';
  remove.title = 'Remove variable';
  span.appendChild(remove);

  return span;
}

class ChipWidget extends WidgetType {
  constructor(
    readonly token: string,
    readonly labelKey: string,
    readonly getNodes: () => CanvasNode[],
  ) {
    super();
  }
  eq(other: ChipWidget) {
    return other.token === this.token && other.labelKey === this.labelKey;
  }
  toDOM() {
    return renderChipDOM(this.token, this.getNodes());
  }
  ignoreEvent() {
    return false;
  }
}

// Effect used to force a decoration rebuild when node metadata (names/types)
// changes without a document edit.
const refreshChips = StateEffect.define<void>();

// ── "Reveal as text" state ─────────────────────────────────────────────────────
//
// Double-clicking a chip reveals its raw `{{nodes.<id>.<path>}}` text so the user
// can edit the id/path directly. Revealed ranges are tracked (and mapped across
// edits) and skipped by the chip decoration builder.

const revealEffect = StateEffect.define<{ from: number; to: number }>();
const clearRevealEffect = StateEffect.define<void>();

const revealField = StateField.define<{ from: number; to: number }[]>({
  create: () => [],
  update(value, tr) {
    let next = value;
    if (tr.docChanged) {
      next = value
        .map((r) => ({ from: tr.changes.mapPos(r.from, 1), to: tr.changes.mapPos(r.to, -1) }))
        .filter((r) => r.to > r.from);
    }
    for (const e of tr.effects) {
      if (e.is(revealEffect)) next = [...next, e.value];
      if (e.is(clearRevealEffect)) next = [];
    }
    return next;
  },
});

// ── Shared editor state (read by CodeMirror extensions via a live ref) ─────────
//
// Extensions are created once; they read the latest props/callbacks from this ref
// so we never rebuild the editor on every render (which would drop cursor state).

interface EditorRuntime {
  nodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
  edges: { source: string; target: string }[];
  selectedNodeId: string | null;
  onChipOpenMenu: (from: number, to: number, anchor: DOMRect) => void;
}

function findRangeAt(decorations: DecorationSet, pos: number): { from: number; to: number } | null {
  const ranges: { from: number; to: number }[] = [];
  decorations.between(0, 1e9, (from, to) => {
    ranges.push({ from, to });
  });
  return (
    ranges.find((r) => r.from <= pos && pos < r.to) ??
    ranges.find((r) => r.from <= pos && pos <= r.to) ??
    null
  );
}

function buildDecorations(view: EditorView, rt: EditorRuntime): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const revealed = view.state.field(revealField, false) ?? [];
  const text = view.state.doc.toString();
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    const token = m[0];
    const isRevealed = revealed.some((r) => !(to <= r.from || from >= r.to));
    if (isRevealed) continue;
    builder.add(
      from,
      to,
      Decoration.replace({
        widget: new ChipWidget(token, tokenLabelKey(token, rt.nodes), () => rt.nodes),
      }),
    );
  }
  return builder.finish();
}

function makeChipPlugin(rt: EditorRuntime) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      clickTimer: ReturnType<typeof setTimeout> | null = null;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, rt);
      }
      update(u: ViewUpdate) {
        const forced = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshChips)));
        const revealChanged = u.startState.field(revealField) !== u.state.field(revealField);
        if (u.docChanged || u.viewportChanged || forced || revealChanged) {
          this.decorations = buildDecorations(u.view, rt);
        }
      }
      destroy() {
        if (this.clickTimer) clearTimeout(this.clickTimer);
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (plugin) =>
        EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
      eventHandlers: {
        mousedown(
          this: { decorations: DecorationSet; clickTimer: ReturnType<typeof setTimeout> | null },
          e: MouseEvent,
          view: EditorView,
        ) {
          const target = e.target as HTMLElement | null;
          const chip = target?.closest('.cm-expr-chip') as HTMLElement | null;
          if (!chip) return false;
          const range = findRangeAt(this.decorations, view.posAtDOM(chip));
          if (!range) return false;

          e.preventDefault();

          // ── Remove (× button) ───────────────────────────────────────────────
          if (target?.closest('.cm-expr-chip-remove')) {
            if (this.clickTimer) {
              clearTimeout(this.clickTimer);
              this.clickTimer = null;
            }
            view.dispatch({
              changes: { from: range.from, to: range.to, insert: '' },
              selection: { anchor: range.from },
            });
            view.focus();
            return true;
          }

          // ── Double-click → reveal raw text ──────────────────────────────────
          if (e.detail >= 2) {
            if (this.clickTimer) {
              clearTimeout(this.clickTimer);
              this.clickTimer = null;
            }
            view.dispatch({
              effects: revealEffect.of({ from: range.from, to: range.to }),
              selection: { anchor: range.to },
            });
            view.focus();
            return true;
          }

          // ── Single-click → open node menu (deferred to allow dbl-click) ─────
          const rect = chip.getBoundingClientRect();
          if (this.clickTimer) clearTimeout(this.clickTimer);
          this.clickTimer = setTimeout(() => {
            this.clickTimer = null;
            rt.onChipOpenMenu(range.from, range.to, rect);
          }, 240);
          return true;
        },
      },
    },
  );
}

// ── @ cascading autocomplete: nodes → fields ───────────────────────────────────

function orderNodesForMenu(
  nodes: CanvasNode[],
  edges: { source: string; target: string }[],
  selectedNodeId: string | null,
): CanvasNode[] {
  const upstream = new Set<string>();
  if (selectedNodeId) {
    for (const edge of edges) if (edge.target === selectedNodeId) upstream.add(edge.source);
  }
  const reversed = [...nodes].reverse();
  const up = reversed.filter((n) => upstream.has(n.id));
  const rest = reversed.filter((n) => !upstream.has(n.id));
  return [...up, ...rest];
}

function shortId(id: string): string {
  return id.length > 12 ? `…${id.slice(-8)}` : id;
}

type NodeCompletion = Completion & { nodeType?: string };

function makeCompletionSource(rt: EditorRuntime) {
  return (context: CompletionContext): CompletionResult | null => {
    // ── Field stage: cursor inside an unclosed `{{nodes.<id>.<partial>` ──────────
    const fieldCtx = context.matchBefore(/\{\{\s*nodes\.[A-Za-z0-9_-]+\.[A-Za-z0-9_.[\]]*/);
    if (fieldCtx) {
      const fm = fieldCtx.text.match(/\{\{\s*nodes\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_.[\]]*)$/);
      if (fm) {
        const nodeId = fm[1];
        const partial = fm[2];
        const node = rt.nodes.find((n) => n.id === nodeId);
        if (node) {
          const { fields } = computeNodeFields(node, rt.testResults);
          const usable = fields.filter((f) => f.key !== '…');
          if (usable.length === 0) return null;
          const fieldStart = fieldCtx.to - partial.length;
          return {
            from: fieldStart,
            options: usable.map((f) => ({
              label: f.key,
              detail: f.label && f.label !== f.key ? String(f.label) : undefined,
              type: 'property',
              apply: (view: EditorView, _c: Completion, from: number, to: number) => {
                const after = view.state.sliceDoc(to, to + 2);
                const closing = after === '}}' ? '' : '}}';
                const insert = f.key + closing;
                const anchor = from + f.key.length + (closing ? 2 : 0);
                view.dispatch({ changes: { from, to, insert }, selection: { anchor } });
              },
            })),
            validFor: /^[A-Za-z0-9_.[\]]*$/,
          };
        }
      }
    }

    // ── Node stage: `@<partial>` at start / after whitespace or punctuation ──────
    const at = context.matchBefore(/@[A-Za-z0-9_-]*/);
    if (at) {
      const prev = at.from > 0 ? context.state.sliceDoc(at.from - 1, at.from) : '';
      const okTrigger = at.from === 0 || /[\s([{,;:=]/.test(prev);
      if (okTrigger && (at.from < at.to || context.explicit)) {
        const atFrom = at.from;
        const options: NodeCompletion[] = orderNodesForMenu(
          rt.nodes,
          rt.edges,
          rt.selectedNodeId,
        ).map((n) => {
          const { fields } = computeNodeFields(n, rt.testResults);
          const hasFields = fields.some((f) => f.key !== '…');
          return {
            label: n.data.label || n.id,
            detail: `${n.data.nodeType} · ${shortId(n.id)}`,
            type: 'variable',
            nodeType: n.data.nodeType,
            apply: (view: EditorView) => {
              const to = view.state.selection.main.head;
              if (hasFields) {
                const insert = `{{nodes.${n.id}.`;
                view.dispatch({
                  changes: { from: atFrom, to, insert },
                  selection: { anchor: atFrom + insert.length },
                });
                startCompletion(view);
              } else {
                const insert = `{{nodes.${n.id}}}`;
                view.dispatch({
                  changes: { from: atFrom, to, insert },
                  selection: { anchor: atFrom + insert.length },
                });
              }
            },
          };
        });
        if (options.length === 0) return null;
        return { from: atFrom + 1, options, validFor: /^[A-Za-z0-9_-]*$/ };
      }
    }

    return null;
  };
}

// ── Node → field popup menu (opened by clicking a chip) ─────────────────────────

interface ChipMenuState {
  from: number;
  to: number;
  anchor: DOMRect;
}

function NodeFieldMenu({
  anchor,
  nodes,
  testResults,
  edges,
  selectedNodeId,
  onSelect,
  onClose,
}: {
  anchor: DOMRect;
  nodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
  edges: { source: string; target: string }[];
  selectedNodeId: string | null;
  onSelect: (expr: string) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeNode, setActiveNode] = useState<CanvasNode | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const MENU_W = 280;
  const MENU_MAX_H = 320;
  const openUp = anchor.bottom + MENU_MAX_H + 8 > window.innerHeight;
  const left = Math.min(anchor.left, window.innerWidth - MENU_W - 8);
  const style: React.CSSProperties = openUp
    ? { position: 'fixed', left, bottom: window.innerHeight - anchor.top + 4, width: MENU_W, maxHeight: MENU_MAX_H }
    : { position: 'fixed', left, top: anchor.bottom + 4, width: MENU_W, maxHeight: MENU_MAX_H };

  const ordered = useMemo(
    () => orderNodesForMenu(nodes, edges, selectedNodeId),
    [nodes, edges, selectedNodeId],
  );
  const q = query.trim().toLowerCase();
  const filtered = q
    ? ordered.filter(
        (n) =>
          (n.data.label || '').toLowerCase().includes(q) ||
          String(n.data.nodeType).toLowerCase().includes(q) ||
          n.id.toLowerCase().includes(q),
      )
    : ordered;

  const activeFields = activeNode ? computeNodeFields(activeNode, testResults) : null;
  const usableFields = activeFields?.fields.filter((f) => f.key !== '…') ?? [];

  function pickNode(n: CanvasNode) {
    const { fields } = computeNodeFields(n, testResults);
    if (fields.some((f) => f.key !== '…')) setActiveNode(n);
    else onSelect(`{{nodes.${n.id}}}`);
  }

  return createPortal(
    <div
      ref={menuRef}
      style={style}
      className="z-[9999] flex flex-col overflow-hidden rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-2xl"
    >
      <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
        {activeNode ? (
          <>
            <button
              type="button"
              onClick={() => setActiveNode(null)}
              className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
              title="Back to nodes"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="flex items-center justify-center w-4 h-4 shrink-0">
              <NodeIcon type={activeNode.data.nodeType} size={14} />
            </span>
            <span className="text-[11px] font-semibold text-gray-900 dark:text-white truncate">
              {activeNode.data.label || activeNode.id}
            </span>
          </>
        ) : (
          <>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Change variable
            </span>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400"
              title="Close"
            >
              <X className="w-3 h-3" />
            </button>
          </>
        )}
      </div>

      {!activeNode && (
        <div className="px-2 pt-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search nodes…"
            spellCheck={false}
            className="w-full px-2 py-1 text-[11px] rounded bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}

      <div className="overflow-y-auto py-1">
        {activeNode ? (
          <>
            <button
              type="button"
              onClick={() => onSelect(`{{nodes.${activeNode.id}}}`)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-blue-50 dark:hover:bg-slate-800"
            >
              <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-300">whole output</span>
              <span className="text-[9px] text-slate-400 ml-auto">{`{{nodes.${shortId(activeNode.id)}}}`}</span>
            </button>
            {usableFields.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => onSelect(`{{nodes.${activeNode.id}.${f.key}}}`)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-blue-50 dark:hover:bg-slate-800"
              >
                <span className="font-mono text-[11px] text-blue-700 dark:text-blue-300 truncate">.{f.key}</span>
                {f.label && f.label !== f.key && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto truncate max-w-[55%] text-right">
                    {String(f.label)}
                  </span>
                )}
              </button>
            ))}
          </>
        ) : filtered.length === 0 ? (
          <div className="px-2.5 py-4 text-center text-[11px] text-slate-400">No nodes found.</div>
        ) : (
          filtered.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => pickNode(n)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-blue-50 dark:hover:bg-slate-800"
            >
              <span className="flex items-center justify-center w-5 h-5 shrink-0 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <NodeIcon type={n.data.nodeType} size={13} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium text-gray-900 dark:text-white truncate">
                  {n.data.label || n.id}
                </span>
                <span className="block text-[9px] text-slate-400 dark:text-slate-500 truncate">
                  {n.data.nodeType} · {shortId(n.id)}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export interface ExpressionEditorProps {
  value: string;
  onChange: (v: string) => void;
  nodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
  singleLine?: boolean;
  rows?: number;
  placeholder?: string;
  label?: string;
  hint?: ReactNode;
  /** For comma-separated list fields: inserted before a token when the text
   *  before the cursor is non-empty and not already separated. */
  autoSeparator?: string;
}

export function ExpressionEditor({
  value,
  onChange,
  nodes,
  testResults,
  singleLine = false,
  rows = 3,
  placeholder,
  label,
  hint,
  autoSeparator,
}: ExpressionEditorProps) {
  const isDark = useWorkflowStore((s) => s.theme === 'dark');
  const edges = useWorkflowStore((s) => s.edges);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [chipMenu, setChipMenu] = useState<ChipMenuState | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Live runtime read by the (stable) CodeMirror extensions.
  const rtRef = useRef<EditorRuntime>({
    nodes,
    testResults,
    edges: [],
    selectedNodeId,
    onChipOpenMenu: () => {},
  });
  rtRef.current.nodes = nodes;
  rtRef.current.testResults = testResults;
  rtRef.current.edges = edges.map((e) => ({ source: e.source, target: e.target }));
  rtRef.current.selectedNodeId = selectedNodeId;
  rtRef.current.onChipOpenMenu = (from, to, anchor) => setChipMenu({ from, to, anchor });

  // A single runtime object identity is passed to the extensions so they always
  // observe the mutations above.
  const runtimeSingleton = useRef<EditorRuntime>(rtRef.current).current;

  // Chips display node names; when a referenced node is renamed (no doc edit),
  // force a decoration rebuild so the chip label stays in sync.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshChips.of() });
  }, [nodes]);

  const extensions = useMemo(() => {
    const theme = EditorView.theme(
      {
        '&': { color: isDark ? '#e2e8f0' : '#1e293b', backgroundColor: 'transparent', fontSize: '12px' },
        '.cm-content': {
          padding: '6px 10px',
          fontFamily: 'inherit',
          caretColor: isDark ? '#60a5fa' : '#3b82f6',
          ...(singleLine ? {} : { minHeight: `${rows * 20}px` }),
        },
        '.cm-scroller': {
          fontFamily: 'inherit',
          lineHeight: singleLine ? '1.5' : '1.6',
          overflowX: singleLine ? 'auto' : 'hidden',
          overflowY: singleLine ? 'hidden' : 'auto',
        },
        '.cm-line': { padding: '0' },
        '&.cm-focused': { outline: 'none' },
        '.cm-placeholder': { color: isDark ? '#64748b' : '#94a3b8' },
        '.cm-tooltip-autocomplete ul li': { display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 8px' },
        '.cm-expr-opt-icon': { display: 'inline-flex', alignItems: 'center', width: '15px', height: '15px' },
        '.cm-expr-opt-icon img, .cm-expr-opt-icon svg': { width: '14px', height: '14px' },
      },
      { dark: isDark },
    );

    const singleLineFilter = EditorState.transactionFilter.of((tr) => {
      if (!tr.docChanged) return tr;
      if (tr.newDoc.lines <= 1) return tr;
      const flat = tr.newDoc.toString().replace(/\r?\n/g, ' ');
      return {
        changes: { from: 0, to: tr.startState.doc.length, insert: flat },
        selection: { anchor: flat.length },
      };
    });

    const enterBlock = keymap.of([{ key: 'Enter', run: () => true }]);

    // Revealed (double-clicked) tokens re-chip when the field loses focus.
    const clearRevealOnBlur = EditorView.domEventHandlers({
      blur: (_e, view) => {
        if ((view.state.field(revealField, false) ?? []).length > 0) {
          view.dispatch({ effects: clearRevealEffect.of() });
        }
        return false;
      },
    });

    return [
      revealField,
      clearRevealOnBlur,
      keymap.of([
        { key: 'Tab', run: acceptCompletion },
        ...completionKeymap,
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      history(),
      autocompletion({
        override: [makeCompletionSource(runtimeSingleton)],
        icons: false,
        activateOnTyping: true,
        addToOptions: [
          {
            position: 20,
            render: (completion: Completion) => {
              const nodeType = (completion as NodeCompletion).nodeType;
              if (!nodeType) return null;
              const span = document.createElement('span');
              span.className = 'cm-expr-opt-icon';
              span.innerHTML = renderToStaticMarkup(<NodeIcon type={nodeType} size={14} />);
              return span;
            },
          },
        ],
      }),
      makeChipPlugin(runtimeSingleton),
      theme,
      ...(singleLine ? [singleLineFilter, enterBlock] : [EditorView.lineWrapping]),
    ];
    // Extensions read live data via runtimeSingleton; only structural props rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark, singleLine, rows]);

  function handleInsert(expr: string) {
    const view = viewRef.current;
    if (!view) {
      onChange(value + expr);
      setPickerOpen(false);
      return;
    }
    const sel = view.state.selection.main;
    let toInsert = expr;
    if (autoSeparator) {
      const before = view.state.sliceDoc(0, sel.from).trimEnd();
      if (before.length > 0 && !/[,;]$/.test(before)) toInsert = autoSeparator + expr;
    }
    view.dispatch(view.state.replaceSelection(toInsert));
    view.focus();
    setPickerOpen(false);
  }

  function handleChipMenuSelect(expr: string) {
    const view = viewRef.current;
    if (view && chipMenu) {
      view.dispatch({
        changes: { from: chipMenu.from, to: chipMenu.to, insert: expr },
        selection: { anchor: chipMenu.from + expr.length },
      });
      view.focus();
    }
    setChipMenu(null);
  }

  const showHeader = Boolean(label) || nodes.length > 0;

  return (
    <div className="space-y-1">
      {showHeader && (
        <div className="flex items-center justify-between gap-1">
          {label ? (
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
          ) : (
            <span />
          )}
          {nodes.length > 0 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setPickerOpen((p) => !p)}
              title="Insert a variable from another node"
              className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition-colors shrink-0 ${
                pickerOpen
                  ? 'bg-blue-600 text-white'
                  : 'text-blue-500 dark:text-blue-400 hover:text-gray-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Braces className="w-2.5 h-2.5" />
              Insert variable
            </button>
          )}
        </div>
      )}

      <div className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md overflow-hidden focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500 transition-shadow">
        <CodeMirror
          value={value}
          basicSetup={false}
          extensions={extensions}
          theme="none"
          placeholder={placeholder}
          indentWithTab={false}
          onChange={onChange}
          onCreateEditor={(view) => {
            viewRef.current = view;
          }}
        />
      </div>

      {hint && <p className="text-slate-400 dark:text-slate-500 text-[10px] leading-snug">{hint}</p>}

      {pickerOpen && (
        <VariablePickerPanel nodes={nodes} testResults={testResults} onInsert={handleInsert} />
      )}

      {chipMenu && (
        <NodeFieldMenu
          anchor={chipMenu.anchor}
          nodes={nodes}
          testResults={testResults}
          edges={rtRef.current.edges}
          selectedNodeId={selectedNodeId}
          onSelect={handleChipMenuSelect}
          onClose={() => setChipMenu(null)}
        />
      )}
    </div>
  );
}

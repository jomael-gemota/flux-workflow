import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
} from '@codemirror/state';
import {
  autocompletion,
  completionKeymap,
  startCompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { Braces } from 'lucide-react';
import { useWorkflowStore } from '../../store/workflowStore';
import type { CanvasNode } from '../../store/workflowStore';
import type { NodeTestResult } from '../../types/workflow';
import { VariablePickerPanel, computeNodeFields, nodeTypeLabel } from './NodeConfigPanel';

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
  'cm-expr-chip inline-flex items-center gap-1 px-1.5 py-0.5 mx-[1px] rounded bg-blue-100 ' +
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
  span.title = 'Click to change this variable';
  const info = parseToken(token, nodes);
  if (!info) {
    span.textContent = token;
    return span;
  }
  if (info.kind === 'vars') {
    span.appendChild(chipPart('VAR', 'text-indigo-600 dark:text-indigo-400 font-bold uppercase text-[9px]'));
    span.appendChild(chipSep());
    span.appendChild(chipPart(info.key, 'font-mono text-indigo-700 dark:text-indigo-300'));
    return span;
  }
  span.appendChild(chipPart(nodeTypeLabel(info.type), 'text-blue-700 dark:text-blue-400 font-bold uppercase text-[9px]'));
  span.appendChild(chipSep());
  span.appendChild(chipPart(info.name, 'text-gray-900 dark:text-slate-200'));
  if (info.field) {
    span.appendChild(chipSep());
    span.appendChild(chipPart(info.field, 'font-mono text-blue-700 dark:text-blue-300'));
  }
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

// ── Shared editor state (read by CodeMirror extensions via a live ref) ─────────
//
// Extensions are created once; they read the latest props/callbacks from this ref
// so we never rebuild the editor on every render (which would drop cursor state).

interface EditorRuntime {
  nodes: CanvasNode[];
  testResults: Record<string, NodeTestResult>;
  edges: { source: string; target: string }[];
  selectedNodeId: string | null;
  onChipClick: (from: number, to: number) => void;
}

function buildDecorations(view: EditorView, rt: EditorRuntime): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    const token = m[0];
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
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, rt);
      }
      update(u: ViewUpdate) {
        const forced = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshChips)));
        if (u.docChanged || u.viewportChanged || forced) {
          this.decorations = buildDecorations(u.view, rt);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (plugin) =>
        EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
      eventHandlers: {
        mousedown(this: { decorations: DecorationSet }, e: MouseEvent, view: EditorView) {
          const target = e.target as HTMLElement | null;
          const chip = target?.closest('.cm-expr-chip') as HTMLElement | null;
          if (!chip) return false;
          const pos = view.posAtDOM(chip);
          const ranges: { from: number; to: number }[] = [];
          this.decorations.between(0, view.state.doc.length, (from, to) => {
            ranges.push({ from, to });
          });
          const range =
            ranges.find((r) => r.from <= pos && pos < r.to) ??
            ranges.find((r) => r.from <= pos && pos <= r.to) ??
            null;
          if (range) {
            e.preventDefault();
            rt.onChipClick(range.from, range.to);
            return true;
          }
          return false;
        },
      },
    },
  );
}

// ── @ cascading autocomplete: nodes → fields ───────────────────────────────────

function orderNodesForMenu(rt: EditorRuntime): CanvasNode[] {
  const upstream = new Set<string>();
  if (rt.selectedNodeId) {
    for (const edge of rt.edges) if (edge.target === rt.selectedNodeId) upstream.add(edge.source);
  }
  const reversed = [...rt.nodes].reverse();
  const up = reversed.filter((n) => upstream.has(n.id));
  const rest = reversed.filter((n) => !upstream.has(n.id));
  return [...up, ...rest];
}

function shortId(id: string): string {
  return id.length > 12 ? `…${id.slice(-8)}` : id;
}

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
              apply: (view: EditorView, _c: unknown, from: number, to: number) => {
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
        const options = orderNodesForMenu(rt).map((n) => {
          const { fields } = computeNodeFields(n, rt.testResults);
          const hasFields = fields.some((f) => f.key !== '…');
          return {
            label: n.data.label || n.id,
            detail: `${n.data.nodeType} · ${shortId(n.id)}`,
            type: 'variable',
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
  const viewRef = useRef<EditorView | null>(null);
  // When a chip is clicked, the picker replaces this range instead of inserting
  // at the caret.
  const replaceRangeRef = useRef<{ from: number; to: number } | null>(null);

  // Live runtime read by the (stable) CodeMirror extensions.
  const rtRef = useRef<EditorRuntime>({
    nodes,
    testResults,
    edges: [],
    selectedNodeId,
    onChipClick: () => {},
  });
  rtRef.current.nodes = nodes;
  rtRef.current.testResults = testResults;
  rtRef.current.edges = edges.map((e) => ({ source: e.source, target: e.target }));
  rtRef.current.selectedNodeId = selectedNodeId;
  rtRef.current.onChipClick = (from, to) => {
    replaceRangeRef.current = { from, to };
    setPickerOpen(true);
  };

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

    return [
      keymap.of([...completionKeymap, ...historyKeymap, ...defaultKeymap]),
      history(),
      autocompletion({
        override: [makeCompletionSource(runtimeSingleton)],
        icons: false,
        activateOnTyping: true,
      }),
      makeChipPlugin(runtimeSingleton),
      theme,
      ...(singleLine ? [singleLineFilter, enterBlock] : [EditorView.lineWrapping]),
    ];
    // Extensions read live data via runtimeSingleton; only structural props rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark, singleLine, rows, placeholder]);

  function handleInsert(expr: string) {
    const view = viewRef.current;
    if (!view) {
      onChange(value + expr);
      setPickerOpen(false);
      return;
    }
    const replace = replaceRangeRef.current;
    if (replace) {
      view.dispatch({
        changes: { from: replace.from, to: replace.to, insert: expr },
        selection: { anchor: replace.from + expr.length },
      });
      replaceRangeRef.current = null;
    } else {
      const sel = view.state.selection.main;
      let toInsert = expr;
      if (autoSeparator) {
        const before = view.state.sliceDoc(0, sel.from).trimEnd();
        if (before.length > 0 && !/[,;]$/.test(before)) toInsert = autoSeparator + expr;
      }
      view.dispatch(view.state.replaceSelection(toInsert));
    }
    view.focus();
    setPickerOpen(false);
  }

  function togglePicker() {
    replaceRangeRef.current = null;
    setPickerOpen((p) => !p);
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
              onClick={togglePicker}
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
    </div>
  );
}

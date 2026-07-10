import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, tooltips, keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { acceptCompletion } from '@codemirror/autocomplete';
import { javascript, javascriptLanguage, scopeCompletionSource } from '@codemirror/lang-javascript';
import { useWorkflowStore } from '../../store/workflowStore';

// ── VSCode-like JavaScript editor ──────────────────────────────────────────────
//
// CodeMirror editor for the Code node (and multi-line Loop JS): line numbers,
// bracket matching, code folding, multiple selections, JS autocomplete (local
// identifiers + global built-ins), and the full default/search/history/fold
// keymaps via @uiw basicSetup. No minimap (CodeMirror has none). The completion
// tooltip renders in document.body so it isn't clipped by the config drawer.

const jsGlobals = javascriptLanguage.data.of({
  autocomplete: scopeCompletionSource(globalThis),
});

const baseTheme = EditorView.theme({
  '&': { fontSize: '12px' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    lineHeight: '1.6',
  },
  '.cm-gutters': { fontSize: '11px' },
});

export function JsCodeMirror({
  value,
  onChange,
  placeholder,
  minHeightPx,
  onCreateEditor,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minHeightPx: number;
  onCreateEditor: (view: EditorView) => void;
}) {
  const isDark = useWorkflowStore((s) => s.theme === 'dark');

  const extensions = useMemo(
    () => [
      // Tab accepts the open autocomplete suggestion; when no completion is
      // active acceptCompletion returns false so Tab falls through to indent.
      Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
      javascript(),
      jsGlobals,
      tooltips({ position: 'fixed', parent: document.body }),
      baseTheme,
    ],
    [],
  );

  return (
    <div className="rounded-md overflow-hidden border border-slate-300 dark:border-slate-600 focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500 transition-shadow">
      <CodeMirror
        value={value}
        theme={isDark ? 'dark' : 'light'}
        extensions={extensions}
        minHeight={`${minHeightPx}px`}
        maxHeight="60vh"
        placeholder={placeholder}
        onChange={onChange}
        onCreateEditor={onCreateEditor}
        indentWithTab
      />
    </div>
  );
}

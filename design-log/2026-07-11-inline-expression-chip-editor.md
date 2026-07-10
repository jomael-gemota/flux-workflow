# Inline Expression Chip Editor with `@` Autocomplete

**Date:** 2026-07-11
**Status:** accepted
**Author:** collaborative

## Context

Inserting variables into node fields is currently technical and slow:

- The shared `VariablePickerPanel` (`frontend/src/components/panels/NodeConfigPanel.tsx`)
  inserts template tokens like `{{nodes.node-94hamxb6.field}}` into a plain
  `<textarea>`/`<input>` via `insertAtCursor`.
- Chips (the readable `TYPE · NodeName · field` pill rendered by `ExprToken`) only
  appear **when the field is blurred** — the `ExpressionInput` / `ExpressionTextArea`
  components flip to a raw text view the moment the field gains focus
  (`showDisplay = !focused && !open && EXPR_RE.test(value)`). So users edit against
  raw tokens containing opaque node ids.
- There is no fast keyboard path: users must open the picker button, expand the
  accordion, and hunt for the node/field every time.

Builds on `2026-07-09-variable-picker-accordion.md`. That entry's accordion picker
is **kept** — this entry only changes how fields render/enter expressions.

## Decision

Introduce a shared CodeMirror-based `ExpressionEditor`
(`frontend/src/components/panels/ExpressionEditor.tsx`) that both `ExpressionInput`
(single-line) and `ExpressionTextArea` (multi-line) delegate to. Public prop
signatures of those two components are preserved so none of the ~100 call sites
change. Stored value stays the `{{nodes...}}` / `{{vars...}}` template string, so the
backend `ExpressionResolver` is unaffected.

The editor composes three CodeMirror concerns:

1. **Live chip widgets.** A `ViewPlugin` replaces each `{{nodes...}}` / `{{vars...}}`
   match with a `Decoration.replace({ widget })` rendered with the same Tailwind
   look as `ExprToken`. Chips are registered as **atomic ranges** so cursor motion
   and backspace treat each token as one unit. Chips are visible **while editing**,
   not just on blur.
2. **Click-to-change.** Clicking a chip opens the existing `VariablePickerPanel`
   scoped to *replace* that token's range instead of inserting at the cursor.
3. **`@` cascading autocomplete.** Typing `@` (at line start or after whitespace/
   punctuation, to avoid triggering inside emails) opens a node list (name + type +
   short id, ordered upstream-first then newest-first). Selecting a node inserts an
   unclosed `{{nodes.<id>.` and immediately re-triggers completion showing that
   node's fields (from the existing `computeNodeFields`). Selecting a field closes
   the token, which instantly renders as a chip. Nodes with no known fields insert a
   bare `{{nodes.<id>}}`.

The "Insert variable" button + `VariablePickerPanel` remain as the discovery path.

`JsCodeArea` (Code / Loop nodes) is out of scope: it stores real JS accessors, not
`{{...}}` templates, so it keeps its current textarea behavior.

## Alternatives Considered

- **`contentEditable` custom editor:** full control but requires hand-rolling
  selection, paste, undo, and chip atomicity — rejected as error-prone given
  CodeMirror is already a dependency (`@uiw/react-codemirror`, used by
  `HttpBodyEditor`).
- **Keep chips only on blur, add `@` + click only:** smaller change but fails the
  core ask (chips while editing). Rejected.
- **Extract `computeNodeFields`/`nodeTypeLabel` into a new shared module:** deferred;
  instead they are exported from `NodeConfigPanel` and consumed via the same
  (already-working) circular-import pattern `HttpBodyEditor` uses.

## Consequences

- One shared component upgrades every `ExpressionInput`/`ExpressionTextArea` field at
  once; the accordion picker and its live-value previews are preserved.
- Adds explicit `@codemirror/{state,view,autocomplete,commands}` dependencies (were
  transitive via `@uiw/react-codemirror`) so we don't rely on hoisting.
- Chip display names refresh on doc changes; a node rename while a field is open may
  lag until the next edit — acceptable (a no-op refresh dispatch mitigates it).
- Single-line fields enforce "no newlines" via a transaction filter; `autoSeparator`
  (comma-list fields) behavior is preserved.

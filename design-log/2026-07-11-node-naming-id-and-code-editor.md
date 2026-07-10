# Unique Node Names, Node ID Display, and VSCode-like Code Editor

**Date:** 2026-07-11
**Status:** accepted
**Author:** collaborative

## Context

Four usability gaps surfaced while using the canvas and node config drawers:

1. **Duplicate node names** are allowed per workflow. Adding two "HTTP Request"
   nodes yields two identically named nodes, which is confusing when picking
   variables (`@` menu / accordion both key on the human name).
2. Node **ids are hidden** in the UI, yet expressions (`{{nodes.<id>...}}`) and JS
   code (`nodes['<id>']`) need them. Users had to guess or read raw tokens.
3. The **Code node** editor was a plain `<textarea>` (`JsCodeArea`) — no line
   numbers, no JS autocomplete, no editor keyboard shortcuts.
4. The `@` autocomplete menu in `ExpressionEditor` was **clipped** by the config
   drawer's `overflow`, so options were cut off behind fields.

## Decision

1. **Unique names (Windows Explorer style).** Add `uniqueNodeName(desired,
   existingNames)` in `frontend/src/utils/nodeUtils.ts`. If the desired name is
   taken, append ` (1)`, ` (2)`, … against the name's root. Apply it everywhere a
   node is created or renamed:
   - Canvas add + drag-drop (`WorkflowCanvas.tsx`).
   - `duplicateNode` and `applyFluxelleProposal` adds (`workflowStore.ts`).
   - The "Node name" field in the config drawer (resolved on blur + re-checked on
     commit) so manual edits can't introduce a duplicate.
   Uniqueness is scoped to workflow nodes (sticky notes excluded).

2. **Node ID display.** Show a read-only "Node ID" field with a copy button
   (reusing the existing `CopyButton`) directly below the "Node name" field in the
   shared config drawer, so every node type gets it.

3. **VSCode-like Code editor.** Replace the multi-line branch of `JsCodeArea` with
   CodeMirror using `@codemirror/lang-javascript`:
   - Line numbers, bracket matching, code folding, active-line highlight, multiple
     selections, and the full default/search/history/fold keymaps via
     `@uiw/react-codemirror` `basicSetup` (Tab indents via `indentWithTab`).
   - JS autocomplete: language-local identifiers plus global built-ins via
     `scopeCompletionSource(globalThis)`.
   - No minimap (CodeMirror has none by default).
   - The "Insert variable" button is preserved (still converts picked tokens to JS
     member access via `templateToJsAccess`).
   Single-line JS inputs (loop `while` condition, initial accumulator) keep the
   lightweight `<input>`.

4. **Un-clipped `@` menu.** Add `tooltips({ position: 'fixed', parent:
   document.body })` to the `ExpressionEditor` (and Code editor) so completion
   popups render above the drawer instead of being clipped by `overflow-hidden`.

## Alternatives Considered

- **Block duplicate names with a validation error** instead of auto-suffixing:
  rejected — silent auto-rename matches the requested Explorer-like behavior and
  never blocks the user.
- **Enforce uniqueness only in the store:** insufficient because the config
  drawer edits `label` via a local draft; uniqueness must also be applied on
  rename.
- **Monaco editor** for the Code node: heavier bundle and a second editor engine;
  CodeMirror is already a dependency and covers the requirements (except minimap,
  which is not wanted).

## Consequences

- Adds `@codemirror/lang-javascript` as an explicit dependency.
- Node names are now guaranteed unique per workflow at creation and rename time;
  pre-existing workflows with duplicate names are left as-is until edited.
- The Code node bundle grows modestly (JS language + autocomplete), acceptable for
  the editor upgrade.

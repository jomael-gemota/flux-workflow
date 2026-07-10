# Code node variable chips + realtime Switch connectors + duplicate naming

**Date:** 2026-07-11
**Status:** accepted
**Author:** collaborative

## Context

Follow-up to `2026-07-11-node-naming-id-and-code-editor.md` and
`2026-07-11-inline-expression-chip-editor.md`. Three issues were reported:

1. Right-click **Duplicate** did not apply the Explorer-style unique-name rule
   (only the store's `duplicateNode` did; the canvas `handleDuplicate` built the
   node directly). Copy/paste and Ctrl+D were fixed earlier but the context-menu
   path was missed.
2. The **Code node** editor only supported plain JS + an "Insert variable"
   button that emitted JS member access. Users want the same `@` menu and live
   `{{...}}` chip experience as every other field.
3. **Switch** node handles render at the correct spots when many cases exist,
   but existing edge connectors do not re-route in real time as cases are
   added/removed — React Flow keeps them pinned to stale handle coordinates.

## Decision

**1. Duplicate naming.** Route the canvas `handleDuplicate` (right-click) through
the shared `withUniqueLabel` helper, matching copy/paste and Ctrl+D.

**2. Code node chips.** Add a `codeMode` prop to `ExpressionEditor` that layers
JavaScript language support, global/scope autocomplete, line numbers and the
full code-editing keymap on top of the existing chip + `@` machinery. The Code
node config now uses `ExpressionEditor codeMode` instead of the plain
`JsCodeMirror`.

Because the Code node executes real JavaScript (it never resolved `{{...}}`), the
backend `CodeNode` now pre-resolves each `{{...}}` token to its **real value**
and injects it into the sandbox as a generated binding (`__var0`, `__var1`, …)
rather than string-substituting it into the source. This preserves object
references and types, works for any value, and is fully backward compatible:
code with no `{{...}}` (including existing JS member-access usage) is unchanged.

**3. Switch connectors.** `BaseNode` calls React Flow's `useUpdateNodeInternals`
whenever its input/output handle count changes, forcing edges to re-measure and
reroute in real time.

## Alternatives Considered

- **String-substituting `{{...}}` into code** (like `resolveTemplate`): rejected
  — objects become `[object Object]`/JSON text and strings lose quoting, which
  breaks or corrupts the script. Binding injection keeps real values.
- **Emitting JS member access from the `@` menu (no chips):** rejected — the user
  explicitly wants the chip view, which requires `{{...}}` tokens.
- **Manually re-measuring Switch handles via refs:** rejected —
  `useUpdateNodeInternals` is the supported React Flow API for dynamic handles.

## Consequences

- Code authors can mix chips (`{{nodes.x.result}}`) and raw JS (`nodes['x']`).
- The runner's `resolvedInput` snapshot still string-resolves the code field for
  display only; execution uses the injected bindings.
- Loop node JS fields keep the existing JS-access "Insert variable" behavior
  (out of scope for this change).

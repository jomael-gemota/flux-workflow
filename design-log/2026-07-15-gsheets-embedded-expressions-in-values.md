# Google Sheets: Resolve Embedded Expressions in the Values Field

**Date:** 2026-07-15
**Status:** accepted
**Author:** collaborative

## Context

Builds on `2026-07-08-gsheets-write-values-and-clear-data.md`.

Users reported that in the Google Sheets node's **Values** field, `{{...}}` expressions
are only substituted when the whole field is a *single* expression. As soon as an
expression is concatenated with surrounding text — either literal text in a cell
(`Order: {{nodes.n.result}}`) or the brackets/commas of a grid
(`[[{{a}}, {{b}}, {{c}}]]`) — the placeholders are written to the sheet **verbatim**.

Root cause in `src/nodes/GSheetsNode.ts` → `resolveValues()`:

```ts
resolved = this.resolver.resolve(trimmed, context);
```

`ExpressionResolver.resolve()` only strips a `{{...}}` wrapper when it spans the
**entire** string (its regex is anchored `^\{\{ ... \}\}$`). A mixed/concatenated
string is not a single expression, so it is returned unchanged, then
`coerceJsonGrid()` fails to `JSON.parse` it (unquoted tokens are invalid JSON), and
`normalizeToGrid()` drops the raw text into one cell.

Every other Sheets field (`range`, `sheetName`, `keyColumn`, …) already uses
`resolveTemplate()`, which does a global find-and-replace of every embedded `{{...}}`.
Only the Values path diverged.

## Decision

Make the Values field resolve **every** embedded `{{...}}` token, in both string and
structured (JSON) forms, while preserving all behaviors that already work.

**`src/engine/ExpressionResolver.ts`:**
- Add `resolveTemplateJson(template, context)`: like `resolveTemplate()`, but each
  substituted value is inserted as its **JSON encoding** (`JSON.stringify`). This lets
  a template that is JSON with *unquoted* tokens (`[[{{a}}, {{b}}]]`) become valid JSON
  after substitution regardless of the value type (string → `"x"`, number → `5`,
  object → `{...}`). Missing/erroring tokens encode to a readable `"[missing: expr]"`.

**`src/nodes/GSheetsNode.ts` → `resolveValues()`** now branches on the input string:
1. **Single expression** (`{{...}}` spanning the whole field, no other tokens inside)
   → `resolver.resolve()` so the native array/object/primitive is preserved (unchanged
   behavior).
2. **Looks like JSON** (starts with `[` or `{`):
   a. Try `JSON.parse` on the **raw** text first — this preserves structure for the
      recommended quoted form (`[["{{a}}","{{b}}"]]`); tokens are then resolved
      per-cell (see below).
   b. If raw parse fails (e.g. unquoted `[[{{a}}, {{b}}]]`), run `resolveTemplateJson()`
      and parse again.
   c. If it still isn't JSON, fall back to `resolveTemplate()` → single cell.
3. **Anything else** (plain text, possibly mixing literals and tokens) →
   `resolveTemplate()`.
- Thread `context` through `normalizeToGrid()` → `serializeCell()` / `objectToRow()` so
  every **string leaf cell** is passed through `resolveTemplate()`. This resolves tokens
  inside parsed JSON cells (path 2a) and inside concatenated cell text
  (`"Order: {{n}}"`).

`=formula` cells, plain literals, pasted literal JSON grids, and single-expression
inputs are all unaffected.

## Alternatives Considered

- **Just swap `resolve()` for `resolveTemplate()`.** Insufficient: `resolveTemplate()`
  stringifies objects, so a single-expression field that resolves to an array would be
  JSON-stringified and only survive via a re-parse round-trip; and unquoted-token JSON
  grids with string values would still produce invalid JSON. The branching approach is
  explicit about each case.
- **Require users to quote every token (`[["{{a}}"]]`) and only resolve per-cell.**
  Rejected: the reported failing example uses unquoted tokens, and forcing exact JSON
  quoting is a poor authoring experience. `resolveTemplateJson()` supports both forms.
- **Resolve everything in the frontend before saving.** Rejected for the same reason as
  the 2026-07-08 entry: the field also holds raw expressions/partial templates; the
  backend is the single correct place to normalize.

## Consequences

- Concatenated text (`Order: {{n}}`), unquoted-token grids (`[[{{a}}, {{b}}]]`), and
  quoted-token grids (`[["{{a}}","{{b}}"]]`) now all resolve correctly and write real
  cells.
- Minor behavior change: a literal cell that intentionally contains `{{...}}` text will
  now be treated as an expression, consistent with every other field in the platform.
- Per-cell resolution runs `resolveTemplate()` over already-substituted cells in the
  unquoted path; this is a harmless no-op (no `{{` remains).

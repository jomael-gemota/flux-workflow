# Google Sheets: Reliable Write Values + "Clear Data" Action

**Date:** 2026-07-08
**Status:** accepted
**Author:** collaborative

## Context

Two problems with the Google Sheets node (`src/nodes/GSheetsNode.ts`, frontend `GSheetsConfig` in `NodeConfigPanel.tsx`):

1. **Write / Update Rows pastes 2-D arrays as text.** The frontend always stores the
   `values` field as a *string* (`GSheetsValuesInput` → `onChange({ values })`). When a user
   pastes a literal JSON grid such as `[["a","b"],["c","d"]]`, the backend `resolveValues()`
   ran it through `ExpressionResolver.resolve()`, which returns non-expression strings
   unchanged. The code then fell back to `[[values]]` — dumping the entire JSON string into a
   single cell. The `valueInputOption` toggle (RAW vs USER_ENTERED) therefore appeared "not to
   work", especially USER_ENTERED, because there was only ever one text cell to interpret.

2. **No first-class way to clear data by scope.** A `clear_sheet` action existed but was framed
   as a whole-tab clear; there was no clear UX for clearing a single cell, an arbitrary range,
   or the whole sheet from one action.

## Decision

**Backend (`src/nodes/GSheetsNode.ts`):**
- In `resolveValues()`, after resolving expressions, if the value is still a string that *looks
  like* JSON (starts with `[` or `{`) and parses to an array/object, coerce it into structured
  data before `normalizeToGrid()`. Plain text, numbers, and formula strings (e.g. `=SUM(A1:B1)`)
  are left untouched and still land in a single cell. New helper: `coerceJsonGrid()`.
- This makes structure (rows/cells) independent of `valueInputOption`, which continues to
  control per-cell interpretation (USER_ENTERED = parse formulas/numbers/dates = "apply
  formatting"; RAW = "paste as values").
- Add a new `clear_data` action using `spreadsheets.values.clear`, driven by a `clearMode`
  of `'cell' | 'range' | 'sheet'`. `cell`/`range` require an A1 `range`; `sheet` uses `sheetName`.
- Keep the existing `clear_sheet` handler for backward compatibility with saved workflows.

**Frontend (`NodeConfigPanel.tsx`):**
- Relabel the value-input-option selector so the choice is explicit:
  USER_ENTERED → "Apply formatting — parse formulas, numbers & dates";
  RAW → "Paste as values — store text exactly as entered".
- Add a `clear_data` option ("Clear Data") to the action dropdown with a "What to clear"
  mode selector and mode-appropriate fields (cell / range / whole sheet).

**Skill catalog (`src/skills/catalog/gsheets-manage.ts`):**
- Document `clear_data` and note that pasted JSON arrays are parsed into rows/cells.

## Alternatives Considered

- **Parse JSON in the frontend before saving `values`.** Rejected: the field also accepts
  expressions (`{{nodes.x.data}}`) and partial templates, so eager parsing in the UI would
  fight the expression flow. The backend is the single correct place to normalize.
- **Always `JSON.parse` any string cell in `normalizeToGrid`.** Rejected as too aggressive —
  a legitimate text cell that happens to look like JSON would be silently restructured. The
  coercion is gated on the value being a top-level array/object string.
- **Replace `clear_sheet` with `clear_data`.** Rejected to avoid orphaning existing nodes;
  `clear_data` is additive and `clear_sheet` remains supported.

## Consequences

- Pasted 2-D arrays, 1-D arrays, and objects now write as real rows/cells, and USER_ENTERED
  correctly parses each cell (formulas, numbers, dates).
- One rare behavior change: a string that is valid top-level JSON array/object is now treated
  as structure rather than a single literal cell. Users who need literal `[...]`/`{...}` text
  in one cell should provide it via an expression that resolves to that exact string.
- `clear_data` and `clear_sheet` both exist; the dropdown lists both. Documented here so future
  work can consolidate if desired.

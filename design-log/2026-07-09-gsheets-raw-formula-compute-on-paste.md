# Google Sheets: Compute Formulas When "Paste as Values" (RAW)

**Date:** 2026-07-09
**Status:** accepted
**Author:** collaborative

## Context

Builds on [2026-07-08-gsheets-write-values-and-clear-data.md](./2026-07-08-gsheets-write-values-and-clear-data.md).

The Google Sheets node (`src/nodes/GSheetsNode.ts`) exposes a `valueInputOption`
toggle rendered in the UI as:

- `USER_ENTERED` → "Apply formatting — parse formulas, numbers & dates"
- `RAW` → "Paste as values — store text exactly as entered"

When a user picks **Paste as values** (`RAW`) but types a formula (a cell value
starting with `=`, e.g. `=SUM(A1:B1)` or `=NOW()`), Google Sheets stores the
formula **as literal text** under `RAW`. The user's intent, however, is: *paste
the computed result as a value* — evaluate the formula, then store its output as
a plain value (no live formula left in the cell).

This should not be limited to the `write` action. It must apply to every action
that writes or appends cell values: `write`, `append`, `append_row`,
`append_update_row`, `update_row`, `append_to_row`, `append_to_column`.

## Decision

Introduce a single shared write path, `writeGridValues()`, that every
value-writing action funnels through. It normalizes the response shape and, when
needed, performs a **compute-then-paste** correction:

Trigger condition: `valueInputOption === 'RAW'` **and** the grid contains at
least one formula cell (a string starting with `=`).

Steps when triggered:
1. Write the grid with `USER_ENTERED` so Google Sheets evaluates each formula in
   its real target position (relative references resolve correctly). For append
   modes this also determines the final written range via the API response.
2. Read the written range back with `valueRenderOption: 'UNFORMATTED_VALUE'` to
   obtain the computed results.
3. Build a merged grid: **formula cells** are replaced by their computed value;
   **non-formula cells** keep the user's original input verbatim.
4. Overwrite the same range with the merged grid using `RAW`, so formula cells
   land as computed values and literal cells retain exact RAW semantics.

When the condition is not met (either `USER_ENTERED`, or `RAW` with no formulas),
the helper performs a single ordinary write with the requested
`valueInputOption` — no extra API calls, no behavior change.

Formula detection: a cell is a formula only when it is a string that starts with
`=` (no leading-space trim), matching Google Sheets' own rule (`" =A1"` is text).

## Alternatives Considered

- **Route the whole grid through USER_ENTERED → read-back → RAW.** Rejected: it
  would corrupt literal cells (e.g. `"1/2"` interpreted as a date, `"01"` losing
  its leading zero). Only formula cells are swapped for computed values; literal
  cells are written from the untouched original input.
- **Evaluate formulas locally / with a scratch cell.** Rejected: relative
  references (`=A1+B1`) only make sense at the true target position, and a local
  engine would not match Sheets semantics. Evaluating in place is authoritative.
- **Frontend-only change.** Rejected: the value pipeline and formula evaluation
  live in the backend; the API is the single correct place to compute.

## Consequences

- "Paste as values" now yields computed outputs for formula cells across all
  write/append actions, while literal cells keep exact RAW storage.
- The RAW-with-formulas path costs extra API calls (an interim USER_ENTERED
  write, a read-back, and a RAW rewrite). The common case (no formulas, or
  USER_ENTERED) stays a single call.
- Append modes append exactly one row set: the interim USER_ENTERED append and
  the RAW rewrite target the same returned range, so no duplicate rows.
- Edge cases not specially handled: array/spill formulas that expand beyond their
  origin cell, and formula error results (e.g. `#REF!`) which are pasted as their
  error string.

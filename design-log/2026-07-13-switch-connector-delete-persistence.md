# Switch case connector deletion does not persist

**Date:** 2026-07-13
**Status:** accepted
**Author:** collaborative

## Context

Users reported that deleting a line connector that leaves a **Switch** node's
case handle (or its `default` handle) does not stick: after refreshing the
canvas the deleted connector reappears. Connectors between ordinary nodes, and
Condition true/false connectors, delete correctly.

Edges are not persisted as their own list. On save, each node reconstructs its
outgoing connections from the current canvas edges (`serialize` in
`frontend/src/components/canvas/canvasUtils.ts`):

- **Regular nodes** rebuild `next[]` entirely from the edges — a missing edge
  simply produces no entry.
- **Condition nodes** write `trueNext`/`falseNext = edge?.target ?? ''` — a
  missing edge collapses to an empty string.
- **Switch nodes** wrote `next = edge?.target ?? c.next ?? ''` and
  `defaultNext = defaultEdge?.target ?? cfg.defaultNext ?? ''`.

The Switch fallbacks to the node's previously-stored `c.next` / `cfg.defaultNext`
are the bug. Deleting a connector only removes it from the `edges` array; it
never clears `data.config.cases[idx].next`. So on save the stale target is
written straight back, and on reload `deserialize` rebuilds the very edge that
was deleted.

A second, latent issue: when a case is removed from the **middle** of the list,
the output handles re-index (`"2"` → `"1"`) but the surviving edges keep their
old `sourceHandle`. The old prune logic in `NodeConfigPanel.updateConfig` only
dropped edges whose handle was out of range, so removing case 1 of `[A, B, C]`
kept `B`'s edge on handle `"1"` — which now belongs to `C` — and dropped `C`'s
edge. With the stale fallback this was masked; once the fallback is removed the
mismatch would instead mis-wire or drop the wrong connection.

## Decision

**1. Serialize honours deletion.** Drop the stale fallbacks in the Switch branch
of `serialize` so a missing edge means "no connection", mirroring Condition:

- `next: edge?.target ?? ''`
- `defaultNext: defaultEdge?.target ?? ''`

**2. Re-index handles on middle-case removal.** In
`NodeConfigPanel.updateConfig`, when the case count shrinks, detect the removed
index, drop that case's connector, and shift every higher case connector's
`sourceHandle` (and id) down by one so each surviving case stays aligned with
its handle. Adds still just append, so no remap is needed there.

## Alternatives Considered

- **Keep the fallback, clear `c.next` on edge delete instead:** rejected —
  edge deletion happens in several places (Delete key, edge trash button,
  `deleteElements`); the serializer is the single choke point where the edges
  are already the source of truth, so fixing it there is simplest and matches
  Condition nodes.
- **Key connectors by stable case id instead of positional index:** larger
  refactor touching serialize/deserialize, the widget handles, and the executor
  (which routes by numeric `matchedCase`). Out of scope; the index-based model
  is kept and the reindex is done at the one place cases are removed.

## Consequences

- Deleting a Switch case or default connector now persists across refresh/save.
- Removing a middle case keeps the remaining cases wired to the correct targets.
- Behaviour for regular and Condition connectors is unchanged.

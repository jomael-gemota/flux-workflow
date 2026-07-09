# Variable Picker Accordion & Search

**Date:** 2026-07-09
**Status:** accepted
**Author:** collaborative

## Context

`VariablePickerPanel` (`frontend/src/components/panels/NodeConfigPanel.tsx`) is the
shared control used by 6 node-config drawers to insert `{{nodes.*}}` and
`{{vars.*}}` expressions. It rendered every node section fully expanded inside a
288px scroll box, so with more than a few nodes the desired field was buried in a
long, undifferentiated scroll.

Builds on `2026-07-09-per-workflow-variables.md` (which added the `vars` section).

## Decision

Refactor the picker into a collapsible, searchable list:

- **Accordion:** each node (and the workflow-variables group) is a collapsible
  section driven by the existing `expanded` state map (new `section::<id>` keys).
- **Ordering:** direct upstream nodes of the node being edited first, then
  newest-first. New nodes are appended to the store array, so reversing it
  approximates creation order — accepted as approximate (no `createdAt` on
  `CanvasNode`).
- **Default open:** the top (most-relevant) node section and the variables group;
  all other node sections collapsed.
- **Search box:** filters variables and node fields; matching sections are
  force-opened. Node name/type match shows all its fields; otherwise only the
  matching fields are shown.
- **Polish:** sticky section headers, per-node field/var count badges, an "input"
  badge on direct upstream nodes, a clear-search button, taller scroll area
  (`max-h-96`), and a no-results state.

## Alternatives Considered

- **Add a reliable `createdAt`/creation index to nodes** for exact recency order:
  deferred by request; reverse-array ordering is good enough for now.
- **Pure newest-first ordering:** rejected in favor of upstream-first, since the
  node feeding the current one is the most likely reference target.
- **Virtualized list:** unnecessary at current node counts; the accordion already
  collapses the DOM cost of unopened sections.

## Consequences

- One shared component change improves all 6 drawers at once; the existing nested
  array/object drill-down and the GSheets column special-case are preserved.
- Expand state is per-mount (resets when the drawer closes) — acceptable; can be
  persisted later if desired.
- Ordering can occasionally misrepresent true creation order after bulk Fluxelle
  applies or reordering, by design (approximate).

# Switch cases sharing a target: fan-in deadlock + wrong edge highlight

**Date:** 2026-07-14
**Status:** accepted
**Author:** collaborative

## Context

When two different Switch cases point at the **same** target node (e.g. case 1
and case 2 both route to an Output node), two things went wrong at runtime:

1. Running the workflow so case 2 matched turned **case 1's connector green
   too**, and
2. The shared Output node was **never executed** — it showed "This node was not
   reached in the execution."

Investigation (`WorkflowRunner.ts`, `WorkflowCanvas.tsx`, `useExecutionOverlay`)
found two independent root causes.

### Bug A — backend fan-in deadlock

`WorkflowRunner.getAllNextIds()` returns every case target, so a Switch with two
cases pointing at the same node returns that node **twice**. `buildPendingCounts`
therefore gives the shared target an in-degree of 2. At runtime a Switch is an
*exclusive* branch — exactly one case fires — so the target only ever receives a
single arrival:

- `resolveNextNodes` returns the one taken `nextNodeId` → `executeNode(target)`
  runs once and decrements the pending count `2 → 1`, then returns early because
  `remaining > 0`.
- `skippedIds = getAllNextIds().filter(id => !takenIds.includes(id))` filters out
  **all** occurrences of the taken target, so no `skipBranch` fires for the
  duplicate edge either.

Net result: the target's count is stuck at 1, it never executes, and it reports
"not reached".

### Bug B — frontend highlight ignores which case fired

`resolveEdgeStatus` derives an edge's colour purely from the source node status
and target node status. It never looks at `sourceHandle` / `matchedCase`, so once
a Switch is `success`, **every** outgoing edge is coloured green — including the
cases that were not taken. The Switch executor already reports the taken branch
(`output.matchedCase` for switch, `output.branch` for condition), but the
visualization never consumed it.

## Decision

**A. Deduplicate branch targets in the runner.** `getAllNextIds` now returns
distinct node IDs. Because condition/switch are exclusive-choice, multiple edges
to the same target count as a single logical arrival, so pending-count in-degree,
skip accounting, and reachability all stay consistent (each distinct target is
counted and decremented exactly once per parent). Cross-node joins are
unaffected — dedup is only within a single node's outgoing edges.

**B. Highlight only the taken branch.** Add `computeTakenHandles(results)` which
maps each branch node id to the `sourceHandle` that actually fired
(`String(matchedCase)` for switch — numbers and `"default"`; `branch` for
condition). `resolveEdgeStatus` takes a new `isTakenBranch` argument: when the
source succeeded but this edge was **not** the taken branch, the edge renders as
`skipped` (grey) instead of `success` (green). Non-branch sources default to
`isTakenBranch = true`, so their behaviour is unchanged. The taken-handle map is
stored on the workflow store (populated by `useExecutionOverlay` for live runs)
and computed locally in `ExecutionReplayPage` for replays.

## Alternatives Considered

- **Emit an edge-level execution trace from the backend** (record the exact edge
  taken): cleaner long-term but requires new trace data structures, API/SSE
  changes, and persistence migration. The taken branch is already derivable from
  the Switch/Condition node output, so we reuse that instead.
- **Match the highlighted edge by `nextNodeId`/target instead of handle:** breaks
  precisely in the reported case (two edges share a target), so we key on
  `sourceHandle` = `matchedCase`, which is unique per case.
- **Only increment pending count for the taken branch at runtime:** the runner
  builds pending counts up-front before any node runs, so the taken branch isn't
  known yet. Dedup is the correct static fix.

## Consequences

- A Switch with multiple cases pointing to one node now executes that node once
  and marks it success; only the connector of the case that actually fired turns
  green, the rest render as skipped.
- Condition nodes with both branches pointing to the same node benefit from the
  same dedup + highlight fix.
- Edge highlighting now depends on the source node's result `output` shape; if a
  future branch node changes its output contract, `computeTakenHandles` must be
  updated alongside it.

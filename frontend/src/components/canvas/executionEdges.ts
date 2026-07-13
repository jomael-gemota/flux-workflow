import type { NodeResult } from '../../types/workflow';

/**
 * Maps each branch node (switch / condition) to the single `sourceHandle` that
 * actually fired during a run, derived from the node's result `output`:
 *
 *  - Switch:    `output.matchedCase` → `"0"`, `"1"`, … or `"default"`
 *  - Condition: `output.branch`      → `"true"` | `"false"`
 *
 * These string keys line up exactly with the `sourceHandle` values that
 * `deserialize` assigns to each edge, so the visualization can highlight only
 * the connector of the case/branch that was taken. Nodes that are not branch
 * nodes (or have not produced a successful result yet) are omitted, which the
 * callers treat as "every outgoing edge is taken".
 */
export function computeTakenHandles(results: NodeResult[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const r of results) {
    if (r.status !== 'success' || !r.output || typeof r.output !== 'object') continue;
    const out = r.output as Record<string, unknown>;
    if ('matchedCase' in out && out.matchedCase != null) {
      map[r.nodeId] = String(out.matchedCase);
    } else if (out.branch === 'true' || out.branch === 'false') {
      map[r.nodeId] = out.branch;
    }
  }
  return map;
}

/**
 * Given the taken-handle map and an edge, decide whether the edge represents the
 * branch that actually fired. Returns true for edges whose source is not a branch
 * node (or has no recorded result), so their highlighting is left unchanged.
 */
export function isEdgeTaken(
  takenHandles: Record<string, string>,
  source: string,
  sourceHandle: string | null | undefined
): boolean {
  const taken = takenHandles[source];
  if (taken === undefined) return true;
  return (sourceHandle ?? '') === taken;
}

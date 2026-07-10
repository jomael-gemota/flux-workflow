import type { CanvasNode } from '../store/workflowStore';

/**
 * Coerce a config value to a safe primitive for rendering as a React child.
 *
 * AI-proposed configs (Fluxelle, Claude) sometimes return objects or arrays where
 * the UI widget expects a string. Rendering those directly throws React error #31
 * ("Objects are not valid as a React child"). This helper is the single guard.
 */
export function safeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(safeText).filter(Boolean).join(', ');
  try { return JSON.stringify(value); } catch { return String(value); }
}

/**
 * Return a node name that is unique among `existingNames`, appending a Windows
 * Explorer–style suffix when needed: "HTTP Request" → "HTTP Request (1)" →
 * "HTTP Request (2)". If `desired` already ends in " (n)", its root is reused so
 * duplicating a duplicate keeps counting from the base name.
 */
export function uniqueNodeName(desired: string, existingNames: string[]): string {
  const base = (desired ?? '').trim() || 'Node';
  const taken = new Set(existingNames);
  if (!taken.has(base)) return base;

  const m = base.match(/^(.*?)\s*\((\d+)\)$/);
  const root = (m ? m[1].trim() : base) || 'Node';

  let i = 1;
  let candidate = `${root} (${i})`;
  while (taken.has(candidate)) {
    i += 1;
    candidate = `${root} (${i})`;
  }
  return candidate;
}

/** Recursively search any config value for {{nodes.<targetId>. expressions. */
export function configReferencesNode(obj: unknown, targetId: string): boolean {
  if (typeof obj === 'string') {
    return new RegExp(
      `\\{\\{\\s*nodes\\.${targetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`
    ).test(obj);
  }
  if (Array.isArray(obj)) return obj.some((v) => configReferencesNode(v, targetId));
  if (obj !== null && typeof obj === 'object') {
    return Object.values(obj as Record<string, unknown>).some((v) =>
      configReferencesNode(v, targetId)
    );
  }
  return false;
}

/** Returns all nodes (excluding the target itself) whose config references the target node's output. */
export function findDependentsOf(targetId: string, allNodes: CanvasNode[]): CanvasNode[] {
  return allNodes.filter(
    (n) => n.id !== targetId && configReferencesNode(n.data.config, targetId)
  );
}

// ── Graph-aware horizontal layout for AI-proposed new nodes ───────────────────

const X_SPACING = 280;  // horizontal distance between consecutive nodes
const Y_SPACING = 140;  // vertical distance between sibling branches
const X_MARGIN  = 80;   // left margin when there are no existing nodes
const Y_BASE    = 80;   // baseline Y when there are no existing nodes

interface MinimalNode {
  id: string;
  position: { x: number; y: number };
}

interface LayoutEdge {
  from: string;
  to:   string;
}

/**
 * Compute horizontal "growing roots" positions for newly added nodes.
 *
 * Each new node lands at `parent.x + X_SPACING` (one step right of its parent).
 * When several new children share a single parent (e.g. Switch -> Case A / B / C),
 * they fan out vertically around the parent's Y — like roots growing horizontally.
 *
 * @param addIds         Final (remapped) IDs of the new nodes, in the order Fluxelle proposed them.
 * @param edges          All edges in the merged graph (existing surviving + proposed) using final IDs.
 * @param existingNodes  Existing canvas nodes the new graph attaches to (positions used as anchors).
 * @returns A map of `addId -> { x, y }` with a position for every new ID.
 */
export function layoutNewNodes(
  addIds: string[],
  edges: LayoutEdge[],
  existingNodes: MinimalNode[],
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (addIds.length === 0) return positions;

  // Build adjacency
  const childrenOf = new Map<string, string[]>();
  const parentsOf  = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.from || !e.to) continue;
    if (!childrenOf.has(e.from)) childrenOf.set(e.from, []);
    childrenOf.get(e.from)!.push(e.to);
    if (!parentsOf.has(e.to)) parentsOf.set(e.to, []);
    parentsOf.get(e.to)!.push(e.from);
  }

  const existingMap = new Map(existingNodes.map((n) => [n.id, n.position]));
  const newSet      = new Set(addIds);

  /** Position lookup for any node already anchored — existing or just placed. */
  const posOf = (id: string): { x: number; y: number } | undefined =>
    existingMap.get(id) ?? positions.get(id);

  // Anchor for orphans (new nodes with no graph parent at all)
  let nextOrphanX = existingNodes.length === 0
    ? X_MARGIN
    : Math.max(...existingNodes.map((n) => n.position.x)) + X_SPACING;
  let nextOrphanY = existingNodes.length === 0
    ? Y_BASE
    : existingNodes.reduce((acc, n) => (n.position.x > acc.position.x ? n : acc), existingNodes[0]).position.y;

  const remaining = new Set(addIds);

  // Iteratively place nodes whose primary parent is already anchored.
  // This fixed-point loop converges in O(N) passes for any DAG.
  let progress = true;
  while (remaining.size > 0 && progress) {
    progress = false;

    // Group ready-to-place nodes by their anchoring parent.
    const groupsByParent = new Map<string, string[]>();
    const orphansThisPass: string[] = [];

    for (const id of remaining) {
      const ps = parentsOf.get(id) ?? [];
      const hasUnplacedNewParent = ps.some(
        (p) => newSet.has(p) && remaining.has(p),
      );
      if (hasUnplacedNewParent) continue; // wait until parent is placed

      // Pick the rightmost (deepest-x) anchored parent — visually feels right.
      let anchorId: string | null = null;
      let anchorX = -Infinity;
      for (const p of ps) {
        const pPos = posOf(p);
        if (pPos && pPos.x > anchorX) {
          anchorId = p;
          anchorX = pPos.x;
        }
      }

      if (anchorId) {
        if (!groupsByParent.has(anchorId)) groupsByParent.set(anchorId, []);
        groupsByParent.get(anchorId)!.push(id);
      } else if (ps.length === 0) {
        orphansThisPass.push(id);
      }
      // else: parents exist but none anchored yet → wait (handled by outer loop)
    }

    // Place each anchor group: kids fan vertically around anchor.y, all at anchor.x + X_SPACING.
    for (const [parentId, kids] of groupsByParent) {
      const pPos = posOf(parentId)!;
      const x = pPos.x + X_SPACING;
      const offset = (kids.length - 1) / 2;

      // Preserve the order in which Fluxelle proposed the nodes — keeps "Case A"
      // above "Case B" above "Case C" rather than randomising vertical order.
      kids.sort((a, b) => addIds.indexOf(a) - addIds.indexOf(b));

      kids.forEach((kid, idx) => {
        positions.set(kid, { x, y: pPos.y + (idx - offset) * Y_SPACING });
        remaining.delete(kid);
      });
      progress = true;
    }

    // Orphans go in their own column to the right.
    for (const id of orphansThisPass) {
      positions.set(id, { x: nextOrphanX, y: nextOrphanY });
      nextOrphanY += Y_SPACING;
      remaining.delete(id);
      progress = true;
    }
  }

  // Fallback for cycles / unreachable nodes — drop them somewhere visible.
  for (const id of remaining) {
    positions.set(id, { x: nextOrphanX, y: nextOrphanY });
    nextOrphanY += Y_SPACING;
  }

  return positions;
}

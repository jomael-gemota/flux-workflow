import type { CanvasEdge, CanvasNode } from '../../store/workflowStore';
import type { WorkflowDefinition, WorkflowNode } from '../../types/workflow';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const H_GAP = 280;
const V_GAP = 120;

// ── Deserialize ──────────────────────────────────────────────────────────────

export function deserialize(workflow: WorkflowDefinition): {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
} {
  // Only auto-compute positions for nodes that don't have a saved position.
  // This means first-time layouts are auto-arranged; after the user saves,
  // the persisted positions are used and manual arrangements are preserved.
  const hasSavedPositions = workflow.nodes.some((n) => n.position != null);
  const autoPositions = hasSavedPositions ? {} : computePositions(workflow);

  const entrySet = new Set(
    workflow.entryNodeIds?.length ? workflow.entryNodeIds : [workflow.entryNodeId]
  );
  const isParallel = entrySet.size > 1;

  const nodes: CanvasNode[] = workflow.nodes.map((wn, i) => ({
    id: wn.id,
    type: 'workflowNode',
    // Prefer the saved canvas position, then the auto-computed position,
    // then a simple fallback so nodes are never stacked on top of each other.
    position: wn.position ?? autoPositions[wn.id] ?? { x: i * H_GAP, y: 0 },
    data: {
      label: wn.name,
      nodeType: wn.type,
      config: { ...wn.config },
      isEntry: entrySet.has(wn.id),
      isParallelEntry: entrySet.has(wn.id) && isParallel,
      retries: wn.retries,
      retryDelayMs: wn.retryDelayMs,
      timeoutMs: wn.timeoutMs,
      disabled: wn.disabled,
    },
  }));

  const edges: CanvasEdge[] = [];

  for (const wn of workflow.nodes) {
    if (wn.type === 'condition') {
      const cfg = wn.config as Record<string, string>;
      if (cfg.trueNext) {
        edges.push(makeEdge(`${wn.id}-true`, wn.id, cfg.trueNext, 'true', 'true'));
      }
      if (cfg.falseNext) {
        edges.push(makeEdge(`${wn.id}-false`, wn.id, cfg.falseNext, 'false', 'false'));
      }
    } else if (wn.type === 'switch') {
      const cfg = wn.config as {
        cases?: Array<{ label?: string; next: string }>;
        defaultNext?: string;
      };
      (cfg.cases ?? []).forEach((c, idx) => {
        edges.push(
          makeEdge(`${wn.id}-case-${idx}`, wn.id, c.next, String(idx), c.label ?? `case ${idx}`)
        );
      });
      if (cfg.defaultNext) {
        edges.push(makeEdge(`${wn.id}-default`, wn.id, cfg.defaultNext, 'default', 'default'));
      }
    } else {
      for (const nextId of wn.next) {
        edges.push(makeEdge(`${wn.id}->${nextId}`, wn.id, nextId));
      }
    }
  }

  return { nodes, edges };
}

// ── Serialize ────────────────────────────────────────────────────────────────

export function serialize(
  workflowId: string,
  workflowName: string,
  rfNodes: CanvasNode[],
  rfEdges: CanvasEdge[],
  entryNodeId: string,
  schedule?: string,
  _entryNodeIds?: string[],
  viewport?: { x: number; y: number; zoom: number } | null,
): WorkflowDefinition {
  const nodes: WorkflowNode[] = rfNodes.map((rfn) => {
    const d = rfn.data;
    const nodeType = d.nodeType as WorkflowNode['type'];

    // Round positions to whole pixels to keep the JSON clean
    const position = {
      x: Math.round(rfn.position.x),
      y: Math.round(rfn.position.y),
    };

    if (nodeType === 'condition') {
      const trueEdge = rfEdges.find(
        (e) => e.source === rfn.id && e.sourceHandle === 'true'
      );
      const falseEdge = rfEdges.find(
        (e) => e.source === rfn.id && e.sourceHandle === 'false'
      );
      return {
        id: rfn.id,
        type: nodeType,
        name: d.label,
        config: {
          ...d.config,
          trueNext: trueEdge?.target ?? '',
          falseNext: falseEdge?.target ?? '',
        },
        next: [],
        retries: d.retries,
        retryDelayMs: d.retryDelayMs,
        timeoutMs: d.timeoutMs,
        disabled: d.disabled || undefined,
        position,
      };
    }

    if (nodeType === 'switch') {
      const cfg = d.config as {
        cases?: Array<{ label?: string; condition: unknown; next?: string }>;
        defaultNext?: string;
      };
      const updatedCases = (cfg.cases ?? []).map((c, idx) => {
        const edge = rfEdges.find(
          (e) => e.source === rfn.id && e.sourceHandle === String(idx)
        );
        return { ...c, next: edge?.target ?? c.next ?? '' };
      });
      const defaultEdge = rfEdges.find(
        (e) => e.source === rfn.id && e.sourceHandle === 'default'
      );
      return {
        id: rfn.id,
        type: nodeType,
        name: d.label,
        config: {
          ...d.config,
          cases: updatedCases,
          defaultNext: defaultEdge?.target ?? cfg.defaultNext ?? '',
        },
        next: [],
        retries: d.retries,
        retryDelayMs: d.retryDelayMs,
        timeoutMs: d.timeoutMs,
        disabled: d.disabled || undefined,
        position,
      };
    }

    const next = rfEdges
      .filter((e) => e.source === rfn.id)
      .map((e) => e.target);

    return {
      id: rfn.id,
      type: nodeType,
      name: d.label,
      config: { ...d.config },
      next,
      retries: d.retries,
      retryDelayMs: d.retryDelayMs,
      timeoutMs: d.timeoutMs,
      disabled: d.disabled || undefined,
      position,
    };
  });

  // Build a set of IDs that actually exist after this serialization pass
  const validNodeIds = new Set(nodes.map(n => n.id));

  // Clean up dangling references inside each node's config/next arrays
  for (const node of nodes) {
    // Filter out deleted targets from next[]
    node.next = node.next.filter(id => validNodeIds.has(id));

    if (node.type === 'condition') {
      const cfg = node.config as { trueNext?: string; falseNext?: string };
      if (cfg.trueNext && !validNodeIds.has(cfg.trueNext)) cfg.trueNext = '';
      if (cfg.falseNext && !validNodeIds.has(cfg.falseNext)) cfg.falseNext = '';
    } else if (node.type === 'switch') {
      const cfg = node.config as {
        cases?: Array<{ next?: string }>;
        defaultNext?: string;
      };
      for (const c of cfg.cases ?? []) {
        if (c.next && !validNodeIds.has(c.next)) c.next = '';
      }
      if (cfg.defaultNext && !validNodeIds.has(cfg.defaultNext)) cfg.defaultNext = '';
    }
  }

  // Auto-detect trigger nodes as entry nodes (they always start workflows)
  const triggerNodeIds = nodes
    .filter(n => n.type === 'trigger')
    .map(n => n.id);

  // Collect all canvas nodes marked as entry, filtered to those that still exist
  const manualEntryIds = rfNodes
    .filter(n => n.data.isEntry && validNodeIds.has(n.id))
    .map(n => n.id);

  // Merge: trigger nodes always come first, then any manually-marked entries
  const mergedEntryIds = [
    ...triggerNodeIds,
    ...manualEntryIds.filter(id => !triggerNodeIds.includes(id)),
  ];

  // Fall back to the passed-in entryNodeId only if it still exists in the current nodes
  const fallbackId = validNodeIds.has(entryNodeId) ? entryNodeId : (nodes[0]?.id ?? '');
  const resolvedEntryIds = mergedEntryIds.length > 0 ? mergedEntryIds : [fallbackId].filter(Boolean);
  const resolvedEntryNodeId = resolvedEntryIds[0] ?? '';

  return {
    id: workflowId,
    name: workflowName,
    version: 1,
    nodes,
    entryNodeId: resolvedEntryNodeId,
    // Always include entryNodeIds so saves always overwrite the stale DB value.
    // Use undefined only when there are no entries at all (empty workflow edge case).
    entryNodeIds: resolvedEntryIds.length > 0 ? resolvedEntryIds : undefined,
    schedule,
    viewport: viewport ?? undefined,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEdge(
  id: string,
  source: string,
  target: string,
  sourceHandle?: string,
  label?: string
): CanvasEdge {
  return {
    id,
    source,
    target,
    sourceHandle,
    label,
    animated: false,
  };
}

function computePositions(
  workflow: WorkflowDefinition
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const visited = new Set<string>();

  function visit(nodeId: string, col: number, row: number) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    positions[nodeId] = { x: col * H_GAP, y: row * (NODE_HEIGHT + V_GAP) };

    const node = workflow.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const nextIds: string[] = [];
    if (node.type === 'condition') {
      const cfg = node.config as Record<string, string>;
      if (cfg.trueNext) nextIds.push(cfg.trueNext);
      if (cfg.falseNext) nextIds.push(cfg.falseNext);
    } else if (node.type === 'switch') {
      const cfg = node.config as {
        cases?: Array<{ next: string }>;
        defaultNext?: string;
      };
      (cfg.cases ?? []).forEach((c) => nextIds.push(c.next));
      if (cfg.defaultNext) nextIds.push(cfg.defaultNext);
    } else {
      nextIds.push(...node.next);
    }

    nextIds.forEach((nid, i) => visit(nid, col + 1, row + i));
  }

  visit(workflow.entryNodeId, 0, 0);

  // Layout any orphaned nodes below the main graph
  let orphanRow = Object.keys(positions).length;
  for (const n of workflow.nodes) {
    if (!positions[n.id]) {
      positions[n.id] = { x: 0, y: orphanRow * (NODE_HEIGHT + V_GAP) };
      orphanRow++;
    }
  }

  return positions;
}

export { NODE_WIDTH, NODE_HEIGHT };

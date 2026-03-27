import { useUpdateWorkflow, useCreateWorkflow } from './useWorkflows';
import { useWorkflowStore } from '../store/workflowStore';
import { serialize } from '../components/canvas/canvasUtils';

/**
 * Shared save hook — works from any component (Toolbar, NodeConfigPanel, etc.).
 * Reads the LATEST store state via getState() at call time so it always picks up
 * any synchronous store mutations that happened just before save() was called.
 */
export function useSaveWorkflow() {
  const update = useUpdateWorkflow();
  const create = useCreateWorkflow();

  const isSaving = update.isPending || create.isPending;

  async function save() {
    // Read latest state at call-time — Zustand set() is synchronous so any
    // store update that happened before this call is already reflected here.
    const { activeWorkflow, nodes, edges, setDirty, setActiveWorkflow } =
      useWorkflowStore.getState();

    if (!activeWorkflow) return;
    if (nodes.length === 0) return;

    const entryNodes = nodes.filter((n) => n.data.isEntry);
    const entryNodeId = entryNodes[0]?.id ?? activeWorkflow.entryNodeId;
    const entryNodeIds =
      entryNodes.length > 0 ? entryNodes.map((n) => n.id) : undefined;

    const def = serialize(
      activeWorkflow.id,
      activeWorkflow.name,
      nodes,
      edges,
      entryNodeId,
      activeWorkflow.schedule,
      entryNodeIds,
    );

    if (!activeWorkflow.id || activeWorkflow.id.startsWith('__new__')) {
      const { id: _discarded, ...defWithoutId } = def;
      const created = await create.mutateAsync(defWithoutId);
      if (created?.id) {
        setActiveWorkflow({ ...created, version: created.version ?? 1 });
      }
    } else {
      const updated = await update.mutateAsync({
        id: activeWorkflow.id,
        body: {
          name: def.name,
          nodes: def.nodes,
          entryNodeId: def.entryNodeId,
          entryNodeIds: def.entryNodeIds,
        },
      });
      if (updated) {
        setActiveWorkflow({
          ...updated,
          version: updated.version ?? activeWorkflow.version + 1,
        });
      }
    }

    setDirty(false);
  }

  return { save, isSaving };
}

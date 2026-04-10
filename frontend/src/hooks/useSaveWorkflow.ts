import { useUpdateWorkflow, useCreateWorkflow } from './useWorkflows';
import { useWorkflowStore } from '../store/workflowStore';
import { serialize } from '../components/canvas/canvasUtils';

/**
 * Shared save hook — works from any component (Toolbar, NodeConfigPanel, etc.).
 * Reads the LATEST store state via getState() at call time so it always picks up
 * any synchronous store mutations that happened just before save() was called.
 *
 * Guards against a race condition where the user switches workflows while a save
 * is in-flight: after the async call returns, we re-check the store's active
 * workflow id and only update store state if the user is still on the same
 * workflow that was saved.
 */
export function useSaveWorkflow() {
  const update = useUpdateWorkflow();
  const create = useCreateWorkflow();

  const isSaving = update.isPending || create.isPending;

  async function save() {
    const { activeWorkflow, nodes, edges, canvasViewport } =
      useWorkflowStore.getState();

    if (!activeWorkflow) return;
    const workflowNodes = nodes.filter((n) => n.type !== 'stickyNote');
    if (workflowNodes.length === 0) return;

    const savedWorkflowId = activeWorkflow.id;

    const entryNodes = nodes.filter((n) => n.type !== 'stickyNote' && n.data.isEntry);
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
      canvasViewport,
    );

    if (!activeWorkflow.id || activeWorkflow.id.startsWith('__new__')) {
      const { id: _discarded, ...defWithoutId } = def;
      const created = await create.mutateAsync(defWithoutId);

      const { activeWorkflow: currentWf, setActiveWorkflow, setDirty } =
        useWorkflowStore.getState();
      if (created?.id && currentWf?.id === savedWorkflowId) {
        setActiveWorkflow({ ...created, version: created.version ?? 1 });
        setDirty(false);
      }
    } else {
      const updated = await update.mutateAsync({
        id: activeWorkflow.id,
        body: {
          name: def.name,
          nodes: def.nodes,
          entryNodeId: def.entryNodeId,
          entryNodeIds: def.entryNodeIds,
          viewport: def.viewport,
          stickyNotes: def.stickyNotes,
        },
      });

      const { activeWorkflow: currentWf, setActiveWorkflow, setDirty } =
        useWorkflowStore.getState();
      if (currentWf?.id === savedWorkflowId) {
        if (updated) {
          setActiveWorkflow({ ...updated });
        }
        setDirty(false);
      }
    }
  }

  return { save, isSaving };
}

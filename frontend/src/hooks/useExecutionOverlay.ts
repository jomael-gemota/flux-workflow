import { useEffect, useRef } from 'react';
import { useExecution } from './useExecutions';
import { useWorkflowStore, type NodeExecutionStatus } from '../store/workflowStore';
import { computeTakenHandles } from '../components/canvas/executionEdges';
import type { NodeResult } from '../types/workflow';

// How long to keep isExecuting=true after completion so the "flowing" animation
// has a visual runway before settling into the final solid colour.
const FLOW_LINGER_MS = 700;

export function useExecutionOverlay() {
  // Only subscribe to the values that should re-trigger the effect.
  // nodes/edges are read fresh inside the effect via getState() to avoid
  // stale-closure bugs when the canvas changes between poll ticks.
  const lastExecutionId = useWorkflowStore((s) => s.lastExecutionId);
  const setExecutionStatuses = useWorkflowStore((s) => s.setExecutionStatuses);
  const setExecutionTakenHandles = useWorkflowStore((s) => s.setExecutionTakenHandles);
  const clearExecutionStatuses = useWorkflowStore((s) => s.clearExecutionStatuses);
  const setIsExecuting = useWorkflowStore((s) => s.setIsExecuting);

  const { data: execution } = useExecution(lastExecutionId);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Only clear when there is genuinely no execution selected.
    if (!lastExecutionId) {
      if (lingerTimer.current) clearTimeout(lingerTimer.current);
      clearExecutionStatuses();
      return;
    }

    // Do NOT clear while waiting for the first poll result — return early so the
    // pre-activation state set in Toolbar (via beginExecution) is preserved.
    if (!execution) return;

    // Always read the latest nodes/edges from the store to avoid stale closures.
    const { nodes, edges } = useWorkflowStore.getState();

    const active = execution.status === 'pending' || execution.status === 'running';

    const resultMap = new Map(
      execution.results.map((r) => [r.nodeId, r.status as NodeExecutionStatus])
    );
    const completedIds = new Set(resultMap.keys());

    const statuses: Record<string, NodeExecutionStatus> = {};

    for (const canvasNode of nodes) {
      const id = canvasNode.id;
      if (resultMap.has(id)) {
        statuses[id] = resultMap.get(id)!;
      } else if (active) {
        statuses[id] = 'pending';
      } else {
        statuses[id] = 'skipped';
      }
    }

    // Mark nodes immediately downstream of a just-completed success node as
    // 'running' while the execution is still live (best-effort visual hint).
    if (active) {
      for (const edge of edges) {
        const srcStatus = resultMap.get(edge.source);
        if (srcStatus === 'success' && !completedIds.has(edge.target)) {
          statuses[edge.target] = 'running';
        }
      }
    }

    setExecutionStatuses(statuses);
    setExecutionTakenHandles(computeTakenHandles(execution.results as NodeResult[]));

    if (active) {
      setIsExecuting(true);
      if (lingerTimer.current) clearTimeout(lingerTimer.current);
    } else {
      // Keep isExecuting=true for a short linger window so the flowing dots
      // have time to visually "complete their journey" before turning solid green.
      if (lingerTimer.current) clearTimeout(lingerTimer.current);
      lingerTimer.current = setTimeout(() => setIsExecuting(false), FLOW_LINGER_MS);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [execution, lastExecutionId]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (lingerTimer.current) clearTimeout(lingerTimer.current);
  }, []);
}

import { useEffect, useRef } from 'react';
import { Routes, Route, useParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { WorkflowCanvas } from './components/canvas/WorkflowCanvas';
import { NodeConfigPanel } from './components/panels/NodeConfigPanel';
import { FluxellePanel } from './components/panels/FluxellePanel';
import { ExecutionReplayPage } from './components/pages/ExecutionReplayPage';
import { WorkflowHistoryPage } from './components/pages/WorkflowHistoryPage';
import { useExecutionOverlay } from './hooks/useExecutionOverlay';
import { useWorkflowStore } from './store/workflowStore';
import { useWorkflow } from './hooks/useWorkflows';
import { deserialize } from './components/canvas/canvasUtils';

function AppInner() {
  useExecutionOverlay();
  const theme = useWorkflowStore((s) => s.theme);

  useEffect(() => {
    const html = document.documentElement;
    if (theme === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }, [theme]);

  return (
    <Layout
      canvas={<WorkflowCanvas />}
      configPanel={<NodeConfigPanel />}
      fluxellePanel={<FluxellePanel />}
    />
  );
}

function WorkflowByIdRoute() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const { data: workflow } = useWorkflow(workflowId ?? null);
  const setActiveWorkflow = useWorkflowStore((s) => s.setActiveWorkflow);
  const setNodes = useWorkflowStore((s) => s.setNodes);
  const setEdges = useWorkflowStore((s) => s.setEdges);
  const setDirty = useWorkflowStore((s) => s.setDirty);
  const setSelectedNodeId = useWorkflowStore((s) => s.setSelectedNodeId);
  // Tracks which workflow's canvas has already been hydrated so background
  // refetches of the same workflow don't wipe in-progress edits.
  const hydratedIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!workflow) return;
    setActiveWorkflow(workflow);
    // On a direct page load/refresh of /workflows/:id the Zustand store is
    // empty, so the canvas must be hydrated from the fetched definition here
    // (client-side navigation does this via the sidebar). Only hydrate when
    // the active workflow actually changes.
    if (hydratedIdRef.current !== workflow.id) {
      const { nodes, edges } = deserialize(workflow);
      setNodes(nodes);
      setEdges(edges);
      setDirty(false);
      setSelectedNodeId(null);
      hydratedIdRef.current = workflow.id;
    }
  }, [workflow, setActiveWorkflow, setNodes, setEdges, setDirty, setSelectedNodeId]);

  return <AppInner />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/executions/:executionId/replay" element={<ExecutionReplayPage />} />
      <Route path="/workflows/:workflowId/history" element={<WorkflowHistoryPage />} />
      <Route path="/workflows/:workflowId" element={<WorkflowByIdRoute />} />
      <Route path="*" element={<AppInner />} />
    </Routes>
  );
}

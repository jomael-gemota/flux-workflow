import { useEffect } from 'react';
import { Routes, Route, useParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { WorkflowCanvas } from './components/canvas/WorkflowCanvas';
import { NodeConfigPanel } from './components/panels/NodeConfigPanel';
import { ExecutionLogPanel } from './components/panels/ExecutionLogPanel';
import { FluxellePanel } from './components/panels/FluxellePanel';
import { ExecutionReplayPage } from './components/pages/ExecutionReplayPage';
import { WorkflowHistoryPage } from './components/pages/WorkflowHistoryPage';
import { useExecutionOverlay } from './hooks/useExecutionOverlay';
import { useWorkflowStore } from './store/workflowStore';
import { useWorkflow } from './hooks/useWorkflows';

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
      executionLog={<ExecutionLogPanel />}
    />
  );
}

function WorkflowByIdRoute() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const { data: workflow } = useWorkflow(workflowId ?? null);
  const setActiveWorkflow = useWorkflowStore((s) => s.setActiveWorkflow);

  useEffect(() => {
    if (workflow) {
      setActiveWorkflow(workflow);
    }
  }, [workflow, setActiveWorkflow]);

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

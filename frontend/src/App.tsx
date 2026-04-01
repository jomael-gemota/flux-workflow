import { useEffect } from 'react';
import { Layout } from './components/Layout';
import { WorkflowCanvas } from './components/canvas/WorkflowCanvas';
import { NodeConfigPanel } from './components/panels/NodeConfigPanel';
import { ExecutionLogPanel } from './components/panels/ExecutionLogPanel';
import { useExecutionOverlay } from './hooks/useExecutionOverlay';
import { useWorkflowStore } from './store/workflowStore';

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
      executionLog={<ExecutionLogPanel />}
    />
  );
}

export default function App() {
  return <AppInner />;
}

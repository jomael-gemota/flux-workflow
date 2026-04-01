import { Save, Play, Loader2, GitBranch, LogOut, PanelRight, KeyRound, Sun, Moon } from 'lucide-react';
import { Button } from './ui/Button';
import { useWorkflowStore } from '../store/workflowStore';
import { useTriggerWorkflow } from '../hooks/useWorkflows';
import { useSaveWorkflow } from '../hooks/useSaveWorkflow';
import { useState } from 'react';
import { CredentialsModal } from './ui/CredentialsModal';

export function Toolbar() {
  const {
    activeWorkflow,
    setActiveWorkflow,
    nodes,
    isDirty,
    setDirty,
    setLogOpen,
    setLastExecutionId,
    beginExecution,
    configOpen,
    setConfigOpen,
    theme,
    setTheme,
  } = useWorkflowStore();

  const { save, isSaving } = useSaveWorkflow();
  const trigger = useTriggerWorkflow();
  const [nameEdit, setNameEdit] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [credentialsOpen, setCredentialsOpen] = useState(false);

  async function handleSave() {
    if (!activeWorkflow) return;
    if (nodes.length === 0) {
      alert('Add at least one node to the canvas before saving.');
      return;
    }
    try {
      await save();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      alert(`Save failed: ${msg}`);
    }
  }

  async function handleTrigger() {
    if (!activeWorkflow || !activeWorkflow.id || activeWorkflow.id.startsWith('__new__')) return;
    try {
      const preStatuses: Record<string, import('../store/workflowStore').NodeExecutionStatus> = {};
      for (const n of nodes) {
        preStatuses[n.id] = 'waiting';
      }
      beginExecution(preStatuses);

      const summary = await trigger.mutateAsync({ workflowId: activeWorkflow.id });
      setLastExecutionId(summary.executionId);
      setLogOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      alert(`Trigger failed: ${msg}`);
    }
  }

  function handleLogout() {
    localStorage.removeItem('wap_api_key');
    window.location.reload();
  }

  const saving = isSaving;
  const triggering = trigger.isPending;
  const isNew = activeWorkflow?.id?.startsWith('__new__') ?? false;

  return (
    <>
    <header className="h-12 glass-surface border-b border-black/[0.07] dark:border-white/10 flex items-center px-4 gap-4 shrink-0">
      <div className="flex items-center gap-2 font-semibold text-sm">
        <GitBranch className="w-4 h-4 text-blue-500 dark:text-blue-400" />
        <span className="text-slate-600 dark:text-slate-300">Workflow Platform</span>
      </div>

      <div className="w-px h-6 glass-divider" />

      {activeWorkflow ? (
        nameEdit ? (
          <input
            autoFocus
            className="bg-black/5 dark:bg-white/8 border border-black/10 dark:border-white/15 text-gray-900 dark:text-white text-sm rounded px-2 py-0.5 w-56 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={() => {
              if (nameValue.trim()) {
                setActiveWorkflow({ ...activeWorkflow, name: nameValue.trim() });
                setDirty(true);
              }
              setNameEdit(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setNameEdit(false);
            }}
          />
        ) : (
          <button
            className="text-gray-900 dark:text-white text-sm font-medium hover:text-blue-600 dark:hover:text-blue-300 transition-colors"
            onClick={() => { setNameValue(activeWorkflow.name); setNameEdit(true); }}
          >
            {activeWorkflow.name}
            {!isNew && (
              <span className="ml-1.5 text-slate-400 dark:text-slate-500 text-xs font-normal">
                v{activeWorkflow.version}
              </span>
            )}
            {isDirty && <span className="ml-1 text-amber-500 dark:text-amber-400 text-xs">●</span>}
          </button>
        )
      ) : (
        <span className="text-slate-400 dark:text-slate-500 text-sm">No workflow selected</span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={!activeWorkflow || !isDirty || saving}
          title="Save workflow structure (nodes, connections, positions). Use the Save button inside each node's config panel to save node settings."
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Save Workflow
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={handleTrigger}
          disabled={!activeWorkflow || isNew || triggering}
        >
          {triggering ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Play className="w-3 h-3" />
          )}
          Trigger
        </Button>

        <div className="w-px h-5 glass-divider" />

        <button
          onClick={() => setCredentialsOpen(true)}
          title="Manage Google Workspace credentials"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <KeyRound className="w-3.5 h-3.5" />
          Credentials
        </button>

        <div className="w-px h-5 glass-divider" />

        <button
          onClick={() => setConfigOpen(!configOpen)}
          title={configOpen ? 'Hide configuration panel' : 'Show configuration panel'}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
            configOpen
              ? 'bg-black/8 dark:bg-white/10 text-slate-700 dark:text-slate-200'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10'
          }`}
        >
          <PanelRight className="w-3.5 h-3.5" />
          Config
        </button>

        <div className="w-px h-5 glass-divider" />

        {/* ── Theme toggle ─────────────────────────────────────────────── */}
        <button
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="flex items-center justify-center w-7 h-7 rounded text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          {theme === 'dark'
            ? <Sun className="w-3.5 h-3.5" />
            : <Moon className="w-3.5 h-3.5" />
          }
        </button>

        <button
          onClick={handleLogout}
          className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors p-1"
          title="Change API key"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>

    <CredentialsModal open={credentialsOpen} onClose={() => setCredentialsOpen(false)} />
    </>
  );
}

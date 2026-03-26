import { Save, Play, Loader2, GitBranch, LogOut, PanelRight } from 'lucide-react';
import { Button } from './ui/Button';
import { useWorkflowStore } from '../store/workflowStore';
import { useUpdateWorkflow, useTriggerWorkflow, useCreateWorkflow } from '../hooks/useWorkflows';
import { serialize } from './canvas/canvasUtils';
import { useState } from 'react';

export function Toolbar() {
  const {
    activeWorkflow,
    nodes,
    edges,
    isDirty,
    setDirty,
    setActiveWorkflow,
    setLogOpen,
    setLastExecutionId,
    beginExecution,
    configOpen,
    setConfigOpen,
  } = useWorkflowStore();

  const update = useUpdateWorkflow();
  const create = useCreateWorkflow();
  const trigger = useTriggerWorkflow();
  const [nameEdit, setNameEdit] = useState(false);
  const [nameValue, setNameValue] = useState('');

  async function handleSave() {
    if (!activeWorkflow) return;
    if (nodes.length === 0) {
      alert('Add at least one node to the canvas before saving.');
      return;
    }
    const entryNodes = nodes.filter((n) => n.data.isEntry);
    const entryNodeId = entryNodes[0]?.id ?? activeWorkflow.entryNodeId;
    const entryNodeIds = entryNodes.map((n) => n.id);
    const def = serialize(
      activeWorkflow.id,
      activeWorkflow.name,
      nodes,
      edges,
      entryNodeId,
      activeWorkflow.schedule,
      entryNodeIds.length > 0 ? entryNodeIds : undefined
    );

    try {
      if (!activeWorkflow.id || activeWorkflow.id.startsWith('__new__')) {
        const { id: _discarded, ...defWithoutId } = def;
        const created = await create.mutateAsync(defWithoutId);
        if (created?.id) {
          setActiveWorkflow({ ...created, version: created.version ?? 1 });
        }
      } else {
        const updated = await update.mutateAsync({
          id: activeWorkflow.id,
          body: { name: def.name, nodes: def.nodes, entryNodeId: def.entryNodeId, entryNodeIds: def.entryNodeIds },
        });
        // Keep activeWorkflow in sync with what the server returned (e.g. new version number)
        if (updated) {
          setActiveWorkflow({ ...updated, version: updated.version ?? activeWorkflow.version + 1 });
        }
      }
      setDirty(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      alert(`Save failed: ${msg}`);
    }
  }

  async function handleTrigger() {
    if (!activeWorkflow || !activeWorkflow.id || activeWorkflow.id.startsWith('__new__')) return;
    try {
      // Phase 1 — dim everything immediately so the user sees the canvas "preparing"
      // before any animation starts.  All nodes get 'waiting'; the real statuses
      // (running / pending / success …) are set once the first poll result arrives.
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

  const saving = update.isPending || create.isPending;
  const triggering = trigger.isPending;
  const isNew = activeWorkflow?.id?.startsWith('__new__') ?? false;

  return (
    <header className="h-12 bg-slate-900 border-b border-slate-700 flex items-center px-4 gap-4 shrink-0">
      <div className="flex items-center gap-2 text-white font-semibold text-sm">
        <GitBranch className="w-4 h-4 text-blue-400" />
        <span className="text-slate-300">Workflow Platform</span>
      </div>

      <div className="w-px h-6 bg-slate-700" />

      {activeWorkflow ? (
        nameEdit ? (
          <input
            autoFocus
            className="bg-slate-800 border border-slate-600 text-white text-sm rounded px-2 py-0.5 w-56 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
            className="text-white text-sm font-medium hover:text-blue-300 transition-colors"
            onClick={() => { setNameValue(activeWorkflow.name); setNameEdit(true); }}
          >
            {activeWorkflow.name}
            {!isNew && (
              <span className="ml-1.5 text-slate-500 text-xs font-normal">
                v{activeWorkflow.version}
              </span>
            )}
            {isDirty && <span className="ml-1 text-amber-400 text-xs">●</span>}
          </button>
        )
      ) : (
        <span className="text-slate-500 text-sm">No workflow selected</span>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={!activeWorkflow || !isDirty || saving}
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
          Save
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

        <div className="w-px h-5 bg-slate-700" />

        <button
          onClick={() => setConfigOpen(!configOpen)}
          title={configOpen ? 'Hide configuration panel' : 'Show configuration panel'}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
            configOpen
              ? 'bg-slate-700 text-slate-200'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          <PanelRight className="w-3.5 h-3.5" />
          Config
        </button>

        <button
          onClick={handleLogout}
          className="text-slate-500 hover:text-slate-300 transition-colors p-1"
          title="Change API key"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
}

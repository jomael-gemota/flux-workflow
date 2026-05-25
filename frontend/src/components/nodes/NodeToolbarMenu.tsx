import { useState, useRef, useEffect } from 'react';
import { NodeToolbar, Position } from '@xyflow/react';
import {
  Settings2,
  Play,
  Power,
  MoreHorizontal,
  Copy,
  Trash2,
  Loader2,
} from 'lucide-react';
import { useWorkflowStore } from '../../store/workflowStore';
import { useRunNode } from '../../hooks/useNodeTest';
import { findDependentsOf } from '../../utils/nodeUtils';

interface NodeToolbarMenuProps {
  nodeId: string;
  nodeLabel: string;
  isDisabled?: boolean;
  isVisible: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function NodeToolbarMenu({
  nodeId,
  nodeLabel,
  isDisabled,
  isVisible,
  onMouseEnter,
  onMouseLeave,
}: NodeToolbarMenuProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const runNode = useRunNode();

  const {
    activeWorkflow,
    nodes,
    setSelectedNodeId,
    setConfigOpen,
    setLastExecutionId,
    setPendingDeleteNodeId,
    duplicateNode,
    setNodeDisabled,
    setNodeDisableModal,
    setExecutionStatuses,
    executionStatuses,
  } = useWorkflowStore();

  // Close dropdown when clicking outside — but only outside the dropdown's own tree
  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    // Use capture=true so we catch the event before anything else can stop it
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [dropdownOpen]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleOpenConfig(e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedNodeId(nodeId);
    setConfigOpen(true);
  }

  async function handleExecuteStep(e: React.MouseEvent) {
    e.stopPropagation();
    if (!activeWorkflow?.id || activeWorkflow.id === '__new__') return;

    // Show running status on the node
    setExecutionStatuses({ ...executionStatuses, [nodeId]: 'running' });

    try {
      const summary = await runNode.mutateAsync({ workflowId: activeWorkflow.id, nodeId });
      setExecutionStatuses({ ...executionStatuses, [nodeId]: summary.status === 'success' ? 'success' : 'failure' });
      // Auto-navigate the log panel to this execution
      setLastExecutionId(summary.executionId);
    } catch {
      setExecutionStatuses({ ...executionStatuses, [nodeId]: 'failure' });
    }

    // Clear the status ring after 3 s
    setTimeout(() => {
      const current = useWorkflowStore.getState().executionStatuses;
      if (current[nodeId] === 'success' || current[nodeId] === 'failure') {
        const updated = { ...current };
        delete updated[nodeId];
        setExecutionStatuses(updated);
      }
    }, 3000);
  }

  function handleToggleDisabled(e: React.MouseEvent) {
    e.stopPropagation();
    if (isDisabled) {
      setNodeDisabled(nodeId, false);
      return;
    }
    const dependents = findDependentsOf(nodeId, nodes);
    if (dependents.length === 0) {
      setNodeDisabled(nodeId, true);
    } else {
      setNodeDisableModal({ open: true, nodeId, dependents });
    }
  }

  function handleDuplicate(e: React.MouseEvent) {
    e.stopPropagation();
    duplicateNode(nodeId);
    setDropdownOpen(false);
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setPendingDeleteNodeId(nodeId);
    setDropdownOpen(false);
  }

  const isUnsaved = !activeWorkflow?.id || activeWorkflow.id === '__new__';
  const isRunning = runNode.isPending;

  const btn =
    'flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150 focus:outline-none shadow-sm backdrop-blur-sm';
  const btnNormal =
    `${btn} bg-white/85 dark:bg-slate-800/85 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white hover:shadow-md border border-white/60 dark:border-slate-600/60`;
  const btnWarning = isDisabled
    ? `${btn} bg-amber-500/15 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25 dark:hover:bg-amber-500/30 border border-amber-400/40 dark:border-amber-500/30 hover:shadow-md`
    : `${btn} bg-white/85 dark:bg-slate-800/85 text-slate-600 dark:text-slate-300 hover:bg-amber-50 dark:hover:bg-amber-500/15 hover:text-amber-600 dark:hover:text-amber-400 hover:shadow-md border border-white/60 dark:border-slate-600/60`;

  return (
    // NodeToolbar is a React Flow portal rendered outside the node's DOM tree.
    // isVisible OR dropdownOpen: keep the toolbar alive while the dropdown is open
    // even if the cursor briefly left the node hover zone.
    <NodeToolbar
      nodeId={nodeId}
      isVisible={isVisible || dropdownOpen}
      position={Position.Top}
      offset={10}
    >
      {/* Transparent container — onMouseEnter/Leave keep hover alive as the
          cursor transitions between the node and this portal element. */}
      <div
        className="flex items-center gap-1.5"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Config */}
        <button
          className={btnNormal}
          title="Edit configuration"
          onClick={handleOpenConfig}
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>

        {/* Execute step */}
        <button
          className={`${btnNormal} ${isUnsaved ? 'opacity-40 cursor-not-allowed' : ''}`}
          title={isUnsaved ? 'Save workflow first to run a step' : 'Execute this step (test run)'}
          onClick={handleExecuteStep}
          disabled={isUnsaved || isRunning}
        >
          {isRunning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
        </button>

        {/* Shutdown / Enable */}
        <button
          className={btnWarning}
          title={isDisabled ? 'Enable this node' : 'Disable this node'}
          onClick={handleToggleDisabled}
        >
          <Power className="w-3.5 h-3.5" />
        </button>

        {/* Three-dots dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            className={btnNormal}
            title="More options"
            onClick={(e) => {
              e.stopPropagation();
              setDropdownOpen((prev) => !prev);
            }}
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>

          {dropdownOpen && (
            /*
              Outer wrapper has pb-2 padding so its hit-area extends down 8px,
              bridging the visual gap between the dropdown card and the toolbar
              buttons below. This prevents an unwanted onMouseLeave gap.
            */
            <div
              className="absolute bottom-full left-1/2 -translate-x-1/2 pb-2 z-50"
              onMouseEnter={onMouseEnter}
              onMouseLeave={onMouseLeave}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="w-36 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl overflow-hidden">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                  onClick={handleDuplicate}
                >
                  <Copy className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                  Duplicate
                </button>
                <div className="h-px bg-slate-100 dark:bg-slate-700/50 mx-2" />
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                  onClick={handleDelete}
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <span className="sr-only">Node toolbar for {nodeLabel}</span>
    </NodeToolbar>
  );
}

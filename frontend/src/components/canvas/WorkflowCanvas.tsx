import React, { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { useWorkflowList } from '../../hooks/useWorkflows';
import {
  ReactFlow,
  Background,
  Controls,
  ControlButton,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  type ReactFlowInstance,
  type NodeProps,
  BackgroundVariant,
  type NodeChange,
  type EdgeChange,
  type Viewport,
  type OnSelectionChangeParams,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkflowStore, type CanvasNode, type CanvasEdge, type CanvasNodeData } from '../../store/workflowStore';
import { ExecutionEdge, type EdgeExecutionStatus } from '../edges/ExecutionEdge';
import { NodePickerPopup } from './NodePickerPopup';
import { ContextMenu, type ContextMenuState } from './ContextMenu';
import { nodeAccentColor } from '../nodes/NodeIcons';
import { StickyNoteNode } from '../nodes/StickyNoteNode';
import { HttpNodeWidget } from '../nodes/HttpNodeWidget';
import { LLMNodeWidget } from '../nodes/LLMNodeWidget';
import { ConditionNodeWidget } from '../nodes/ConditionNodeWidget';
import { SwitchNodeWidget } from '../nodes/SwitchNodeWidget';
import { TransformNodeWidget } from '../nodes/TransformNodeWidget';
import { ExtractNodeWidget } from '../nodes/ExtractNodeWidget';
import { OutputNodeWidget } from '../nodes/OutputNodeWidget';
import { GmailNodeWidget } from '../nodes/GmailNodeWidget';
import { GDriveNodeWidget } from '../nodes/GDriveNodeWidget';
import { GDocsNodeWidget } from '../nodes/GDocsNodeWidget';
import { GSheetsNodeWidget } from '../nodes/GSheetsNodeWidget';
import { SlackNodeWidget } from '../nodes/SlackNodeWidget';
import { TeamsNodeWidget } from '../nodes/TeamsNodeWidget';
import { BasecampNodeWidget } from '../nodes/BasecampNodeWidget';
import { TriggerNodeWidget } from '../nodes/TriggerNodeWidget';
import { MessageFormatterNodeWidget } from '../nodes/MessageFormatterNodeWidget';
import type { NodeType } from '../../types/workflow';
import { Plus, FolderPlus, Workflow, X, AlertTriangle, Loader2, Lock, Unlock } from 'lucide-react';
import { createPortal } from 'react-dom';
import { ConfirmModal } from '../ui/ConfirmModal';
import { NodeIcon } from '../nodes/NodeIcons';

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

// ── Node renderers ────────────────────────────────────────────────────────────

function WorkflowNodeRenderer(props: NodeProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = props as any;
  const nodeType = (props.data as CanvasNodeData).nodeType;
  switch (nodeType) {
    case 'trigger': return <TriggerNodeWidget {...p} />;
    case 'http': return <HttpNodeWidget {...p} />;
    case 'llm': return <LLMNodeWidget {...p} />;
    case 'condition': return <ConditionNodeWidget {...p} />;
    case 'switch': return <SwitchNodeWidget {...p} />;
    case 'transform': return <TransformNodeWidget {...p} />;
    case 'extract':   return <ExtractNodeWidget   {...p} />;
    case 'output': return <OutputNodeWidget {...p} />;
    case 'gmail':   return <GmailNodeWidget   {...p} />;
    case 'gdrive':  return <GDriveNodeWidget  {...p} />;
    case 'gdocs':   return <GDocsNodeWidget   {...p} />;
    case 'gsheets': return <GSheetsNodeWidget {...p} />;
    case 'slack':   return <SlackNodeWidget   {...p} />;
    case 'teams':     return <TeamsNodeWidget    {...p} />;
    case 'basecamp':  return <BasecampNodeWidget {...p} />;
    case 'formatter': return <MessageFormatterNodeWidget {...p} />;
    default: return null;
  }
}

const nodeTypes: NodeTypes = {
  workflowNode: WorkflowNodeRenderer,
  stickyNote: StickyNoteNode as unknown as React.ComponentType<NodeProps>,
};
const edgeTypes: EdgeTypes = { execution: ExecutionEdge };

const DEFAULT_CONFIGS: Partial<Record<NodeType, Record<string, unknown>>> = {
  trigger: { triggerType: 'manual' },
  http: { method: 'GET', url: '' },
  llm: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.7, maxTokens: 500, userPrompt: '' },
  condition: { condition: { type: 'leaf', left: '', operator: 'eq', right: '' }, trueNext: '', falseNext: '' },
  switch: { cases: [], defaultNext: '' },
  transform: { mappings: {} },
  extract: { source: '', preprocess: 'plain-text', fields: [], mode: 'auto', textPath: '', aiProvider: 'openai', aiModel: 'gpt-5.4-mini', aiTemperature: 0 },
  output: { value: '' },
  gmail:   { action: 'send',   credentialId: '', to: '', subject: '', body: '' },
  gdrive:  { action: 'list',   credentialId: '', query: '' },
  gdocs:   { action: 'read',   credentialId: '', documentId: '' },
  gsheets: { action: 'read',   credentialId: '', spreadsheetId: '', range: 'Sheet1!A1:Z100' },
  slack:   { action: 'send_message', credentialId: '', channels: '', text: '', uploadSource: 'content', readSource: 'channel', channelFilter: 'all' },
  teams:    { action: 'send_message', credentialId: '', teamId: '', channelId: '', text: '' },
  basecamp:  { action: 'create_todo', credentialId: '', projectId: '', todolistId: '' },
  formatter: { medium: 'slack', template: '' },
};

function resolveEdgeStatus(
  srcStatus: string | undefined,
  tgtStatus: string | undefined,
  isExecuting: boolean
): EdgeExecutionStatus {
  if (srcStatus === 'waiting' || tgtStatus === 'waiting') return 'waiting';
  if (!srcStatus) return 'idle';
  if (srcStatus === 'running') return 'flowing';
  if (srcStatus === 'success') {
    if (tgtStatus === 'skipped') return 'skipped';
    if (tgtStatus === 'failure') return 'failure';
    if (isExecuting) return 'flowing';
    return 'success';
  }
  if (srcStatus === 'failure') return 'failure';
  if (srcStatus === 'skipped') return 'skipped';
  return 'idle';
}

// ── Canvas loading state ──────────────────────────────────────────────────────

const LOADING_MESSAGES = [
  'Assembling your automation canvas…',
  'Fetching your workflow blueprints…',
  'Wiring up your automation flows…',
  'Loading your workflow studio…',
  'Syncing your workflow definitions…',
  'Preparing your creative workspace…',
  'Restoring your last session…',
  'Getting your pipelines ready…',
  'Mapping out your logic flows…',
  'Bringing your automations to life…',
];

function SkeletonNode({ lineWidths }: { lineWidths: number[] }) {
  return (
    <div className="rounded-xl bg-white/80 dark:bg-slate-800/80 shadow-md p-3 border border-slate-200/60 dark:border-slate-700/60 w-[148px] animate-pulse shrink-0">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="w-6 h-6 rounded-lg bg-slate-200 dark:bg-slate-700 shrink-0" />
        <div className="h-2.5 w-16 rounded-full bg-slate-200 dark:bg-slate-700" />
      </div>
      {lineWidths.map((w, i) => (
        <div
          key={i}
          className="h-2 rounded-full bg-slate-100 dark:bg-slate-700/60 mt-1.5"
          style={{ width: `${w}%` }}
        />
      ))}
    </div>
  );
}

function SkeletonEdge() {
  return (
    <div className="flex items-center gap-0 shrink-0">
      <div className="w-6 h-px bg-slate-300/70 dark:bg-slate-600/70" />
      <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
      <div className="w-6 h-px bg-slate-300/70 dark:bg-slate-600/70" />
    </div>
  );
}

function CanvasLoadingState() {
  const message = useMemo(
    () => LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)],
    [],
  );

  return (
    <div className="h-full flex items-center justify-center bg-[#E9EEF6] dark:bg-[#171717]">
      <div className="flex flex-col items-center gap-10 select-none px-8">

        {/* Skeleton flow diagram */}
        <div className="flex items-center gap-1">
          <SkeletonNode lineWidths={[100, 75]} />
          <SkeletonEdge />
          <SkeletonNode lineWidths={[100, 85, 60]} />
          <SkeletonEdge />
          <SkeletonNode lineWidths={[100, 70]} />
        </div>

        {/* Loading message */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex items-center gap-2.5">
            <Loader2 className="w-4 h-4 animate-spin text-blue-500 shrink-0" />
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              {message}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Powered by Google AI
          </p>
        </div>

      </div>
    </div>
  );
}

// ── Main canvas ───────────────────────────────────────────────────────────────

export function WorkflowCanvas() {
  const {
    nodes,
    edges,
    setNodes,
    setNodesOnly,
    setEdges,
    setSelectedNodeId,
    setConfigOpen,
    activeWorkflow,
    setDirty,
    executionStatuses,
    isExecuting,
    theme,
    setCanvasViewport,
    createNewWorkflow,
    setPendingNewProjectName,
    pendingDeleteNodeId,
    setPendingDeleteNodeId,
    deleteNode,
    nodeDisableModal,
    setNodeDisableModal,
    setNodeDisabled,
    isInteractive,
    setIsInteractive,
  } = useWorkflowStore();

  const { isLoading: isWorkflowsLoading } = useWorkflowList();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectNameInput, setProjectNameInput] = useState('');
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [newWfModalOpen, setNewWfModalOpen] = useState(false);
  const [newWfNameDraft, setNewWfNameDraft] = useState('');
  const projectNameInputRef = useRef<HTMLInputElement>(null);
  const newWfNameInputRef = useRef<HTMLInputElement>(null);
  const rfInstance = useRef<ReactFlowInstance<CanvasNode> | null>(null);
  const isDark = theme === 'dark';

  // Refs kept in sync with latest nodes/edges for keyboard handler (avoids stale closure)
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  // Clipboard for copy/paste (transient — not persisted)
  const clipboardRef = useRef<CanvasNode[]>([]);

  function openProjectModal() {
    setProjectNameInput('');
    setProjectModalOpen(true);
    setTimeout(() => projectNameInputRef.current?.focus(), 50);
  }

  function openNewWfModal() {
    setNewWfNameDraft('');
    setNewWfModalOpen(true);
    setTimeout(() => newWfNameInputRef.current?.focus(), 50);
  }

  function handleNewWfConfirm() {
    const name = newWfNameDraft.trim() || 'New Workflow';
    setNewWfModalOpen(false);
    createNewWorkflow(undefined, name);
  }

  function submitProjectModal() {
    const name = projectNameInput.trim();
    if (!name) return;
    setPendingNewProjectName(name);
    setProjectModalOpen(false);
    setProjectNameInput('');
  }

  // ── Viewport restore ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!rfInstance.current || !activeWorkflow) return;
    const vp = activeWorkflow.viewport;
    requestAnimationFrame(() => {
      if (!rfInstance.current) return;
      if (vp) {
        rfInstance.current.setViewport(vp, { duration: 150 });
      } else {
        rfInstance.current.fitView({ padding: 0.15, duration: 150 });
      }
    });
  }, [activeWorkflow?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, vp: Viewport) => {
      setCanvasViewport(vp);
    },
    [setCanvasViewport],
  );

  // ── RF change handlers ──────────────────────────────────────────────────────

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const updated = applyNodeChanges(changes, nodes) as CanvasNode[];

      // Only mark dirty for changes the user intentionally made.
      // React Flow fires 'dimensions' changes on every mount/re-layout to measure
      // nodes, and 'select' changes whenever focus moves.  Those are internal
      // bookkeeping events and must NOT flip isDirty to true — otherwise loading
      // any workflow immediately makes it appear modified and triggers spurious
      // auto-saves when the user switches tabs.
      //
      // Sticky-note resizes arrive as 'dimensions' with resizing:true; those ARE
      // user edits and should mark the canvas dirty.
      const hasDirtyChange = changes.some((c) => {
        if (c.type === 'remove') return true;
        if (c.type === 'position' && c.dragging) return true;
        if (c.type === 'dimensions' && (c as { resizing?: boolean }).resizing) return true;
        return false;
      });

      if (hasDirtyChange) {
        setNodes(updated);
      } else {
        setNodesOnly(updated);
      }
    },
    [nodes, setNodes, setNodesOnly]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      setEdges(applyEdgeChanges(changes, edges) as CanvasEdge[]);
    },
    [edges, setEdges]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      // Read the latest edges directly from the store to avoid stale-closure issues
      // (React state batching can leave the `edges` captured in the closure behind).
      const currentEdges = useWorkflowStore.getState().edges;
      setEdges(addEdge(connection, currentEdges) as CanvasEdge[]);
    },
    [setEdges]
  );

  // ── Drop from palette ───────────────────────────────────────────────────────

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!rfInstance.current) return;

      const type = e.dataTransfer.getData('application/workflow-node-type') as NodeType;
      const label = e.dataTransfer.getData('application/workflow-node-label');
      if (!type) return;

      const position = rfInstance.current.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      const id = `node-${randomId()}`;
      const isFirst = nodes.filter(n => n.type !== 'stickyNote').length === 0;
      const newNode: CanvasNode = {
        id,
        type: 'workflowNode',
        position,
        data: {
          label,
          nodeType: type,
          config: { ...(DEFAULT_CONFIGS[type] ?? {}) },
          isEntry: isFirst,
        },
      };

      setNodes([...nodes, newNode]);
      setDirty(true);
    },
    [nodes, setNodes, setDirty]
  );

  // ── Selection handling ──────────────────────────────────────────────────────

  const onSelectionChange = useCallback(
    ({ nodes: selected }: OnSelectionChangeParams) => {
      const workflowSelected = selected.filter((n) => n.type !== 'stickyNote');
      if (workflowSelected.length === 1 && selected.length === 1) {
        // Track the selected node but do NOT auto-open config — use the toolbar Config icon
        setSelectedNodeId(workflowSelected[0].id);
      } else if (selected.length === 0) {
        setSelectedNodeId(null);
        setConfigOpen(false);
      } else {
        // Multiple selections or only sticky notes
        setSelectedNodeId(null);
        setConfigOpen(false);
      }
    },
    [setSelectedNodeId, setConfigOpen]
  );

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: CanvasNode) => {
      // Multi-select: suppress config panel
      if (event.ctrlKey || event.metaKey || event.shiftKey) return;
      // Sticky notes: no config panel
      if (node.type === 'stickyNote') return;
      // Track selected node ID but don't open config — use toolbar Config icon instead
      setSelectedNodeId(node.id);
    },
    [setSelectedNodeId]
  );

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: CanvasNode) => {
      if (!isInteractive) return; // canvas is locked — ignore double-click
      if (node.type === 'stickyNote') return; // StickyNoteNode handles its own double-click
      setSelectedNodeId(node.id);
      setConfigOpen(true);
    },
    [isInteractive, setSelectedNodeId, setConfigOpen]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setConfigOpen(false);
    setContextMenu(null);
  }, [setSelectedNodeId, setConfigOpen]);

  // ── Right-click context menu ────────────────────────────────────────────────

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: CanvasNode) => {
      event.preventDefault();
      setContextMenu({
        nodeId: node.id,
        nodeType: node.type ?? 'workflowNode',
        x: event.clientX,
        y: event.clientY,
      });
    },
    []
  );

  const handleDuplicate = useCallback(
    (nodeId: string) => {
      const source = nodesRef.current.find((n) => n.id === nodeId);
      if (!source) return;
      const prefix = source.type === 'stickyNote' ? 'sticky' : 'node';
      const newNode: CanvasNode = {
        ...source,
        id: `${prefix}-${randomId()}`,
        position: { x: source.position.x + 24, y: source.position.y + 24 },
        selected: false,
      };
      setNodes([...nodesRef.current, newNode]);
      setDirty(true);
    },
    [setNodes, setDirty]
  );

  const handleDelete = useCallback(
    (nodeId: string) => {
      // Route through the confirmation modal
      setPendingDeleteNodeId(nodeId);
    },
    [setPendingDeleteNodeId]
  );

  // ── Keyboard: copy/paste, duplicate ────────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      // Don't intercept when typing in inputs / contenteditable areas
      if (
        target.isContentEditable ||
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA'
      ) return;

      const ctrlOrMeta = e.ctrlKey || e.metaKey;

      if (ctrlOrMeta && e.key === 'c') {
        clipboardRef.current = nodesRef.current.filter((n) => n.selected);
      }

      if (ctrlOrMeta && e.key === 'v') {
        if (clipboardRef.current.length === 0) return;
        const pasted = clipboardRef.current.map((n) => {
          const prefix = n.type === 'stickyNote' ? 'sticky' : 'node';
          return {
            ...n,
            id: `${prefix}-${randomId()}`,
            position: { x: n.position.x + 24, y: n.position.y + 24 },
            selected: true,
          } as CanvasNode;
        });
        setNodes([
          ...nodesRef.current.map((n) => ({ ...n, selected: false })),
          ...pasted,
        ]);
        setDirty(true);
      }

      // Ctrl+D: duplicate selected
      if (ctrlOrMeta && e.key === 'd') {
        e.preventDefault();
        const selected = nodesRef.current.filter((n) => n.selected);
        if (selected.length === 0) return;
        const duped = selected.map((n) => {
          const prefix = n.type === 'stickyNote' ? 'sticky' : 'node';
          return {
            ...n,
            id: `${prefix}-${randomId()}`,
            position: { x: n.position.x + 24, y: n.position.y + 24 },
            selected: false,
          } as CanvasNode;
        });
        setNodes([...nodesRef.current, ...duped]);
        setDirty(true);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setNodes, setDirty]); // intentionally minimal deps — use refs for nodes

  // ── Add sticky note ─────────────────────────────────────────────────────────

  const handleAddStickyNote = useCallback(() => {
    const rf = rfInstance.current;
    const position = rf
      ? rf.screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        })
      : { x: 100, y: 100 };

    const id = `sticky-${randomId()}`;
    const newNote: CanvasNode = {
      id,
      type: 'stickyNote',
      position,
      zIndex: -1,
      style: { width: 260, height: 200 },
      data: {
        label: 'Sticky Note',
        nodeType: 'sticky',
        config: {},
        isEntry: false,
        content: '',
        color: 'yellow',
      },
    };

    setNodes([...nodes, newNote]);
    setDirty(true);
  }, [nodes, setNodes, setDirty]);

  // ── Add node from picker ────────────────────────────────────────────────────

  const handlePickerSelect = useCallback(
    (type: NodeType, label: string) => {
      const rf = rfInstance.current;
      const position = rf
        ? rf.screenToFlowPosition({
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
          })
        : { x: 200 + nodes.length * 30, y: 200 + nodes.length * 30 };

      const id = `node-${randomId()}`;
      const isFirst = nodes.filter(n => n.type !== 'stickyNote').length === 0;
      const newNode: CanvasNode = {
        id,
        type: 'workflowNode',
        position,
        data: {
          label,
          nodeType: type,
          config: { ...(DEFAULT_CONFIGS[type] ?? {}) },
          isEntry: isFirst,
        },
      };

      setNodes([...nodes, newNode]);
      setSelectedNodeId(id);
      setConfigOpen(true);
      setDirty(true);
    },
    [nodes, setNodes, setSelectedNodeId, setConfigOpen, setDirty]
  );

  // ── Styled edges (execution overlay) ───────────────────────────────────────

  const styledEdges = useMemo<CanvasEdge[]>(() => {
    return edges.map((edge) => {
      const execStatus = resolveEdgeStatus(
        executionStatuses[edge.source],
        executionStatuses[edge.target],
        isExecuting
      );
      return {
        ...edge,
        type: 'execution',
        animated: false,
        data: { ...(edge.data ?? {}), executionStatus: execStatus, label: edge.label },
      };
    });
  }, [edges, executionStatuses, isExecuting]);

  // ── Loading / empty state ────────────────────────────────────────────────────

  if (!activeWorkflow && isWorkflowsLoading) {
    return <CanvasLoadingState />;
  }

  if (!activeWorkflow) {
    return (
      <div className="h-full flex items-center justify-center bg-[#E9EEF6] dark:bg-[#171717]">
        <div className="flex flex-col items-center gap-6 select-none">
          <div className="relative w-20 h-20">
            <div className="absolute inset-0 rounded-2xl bg-blue-100 dark:bg-blue-500/10 flex items-center justify-center shadow-lg">
              <Workflow className="w-9 h-9 text-blue-400 dark:text-blue-400" strokeWidth={1.5} />
            </div>
            <span className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 flex items-center justify-center shadow-md">
              <Plus className="w-3.5 h-3.5 text-slate-500 dark:text-slate-300" />
            </span>
          </div>

          <div className="text-center">
            <p className="text-base font-semibold text-slate-700 dark:text-slate-200 mb-1">
              No workflow selected
            </p>
            <p className="text-sm text-slate-400 dark:text-slate-500 max-w-xs">
              Create a new workflow or organise them into a project to get started.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={openNewWfModal}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-sm font-semibold shadow-lg shadow-blue-600/25 transition-all"
            >
              <Plus className="w-4 h-4" />
              New Workflow
            </button>
            <button
              onClick={openProjectModal}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 text-slate-700 dark:text-slate-200 text-sm font-semibold border border-slate-200 dark:border-slate-600 shadow transition-all"
            >
              <FolderPlus className="w-4 h-4 text-amber-500" />
              New Project
            </button>
          </div>
        </div>

        <NewProjectModal
          open={projectModalOpen}
          inputRef={projectNameInputRef}
          value={projectNameInput}
          onChange={setProjectNameInput}
          onSubmit={submitProjectModal}
          onClose={() => setProjectModalOpen(false)}
        />

        {/* ── New Workflow name modal ───────────────────────────────────────── */}
        {newWfModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-[1px]"
              onClick={() => setNewWfModalOpen(false)}
            />
            <div className="relative bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-1">
                New Workflow
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                Give your workflow a name to get started.
              </p>
              <input
                ref={newWfNameInputRef}
                type="text"
                value={newWfNameDraft}
                onChange={(e) => setNewWfNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleNewWfConfirm();
                  if (e.key === 'Escape') setNewWfModalOpen(false);
                }}
                placeholder="e.g. Send Daily Report"
                className="w-full px-3 py-2 rounded-lg text-sm border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setNewWfModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleNewWfConfirm}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition-all shadow shadow-blue-600/20"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const workflowNodeCount = nodes.filter((n) => n.type !== 'stickyNote').length;

  return (
    <div className="h-full w-full relative">
      {/* Force sticky notes behind regular nodes regardless of selection */}
      <style>{`
        .react-flow__node-stickyNote { z-index: -1 !important; }
        .react-flow__node-stickyNote.selected { z-index: -1 !important; }
      `}</style>

      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={isInteractive ? onConnect : undefined}
        onDrop={isInteractive ? onDrop : undefined}
        onDragOver={isInteractive ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        onNodeContextMenu={onNodeContextMenu}
        onPaneContextMenu={(e) => e.preventDefault()}
        onSelectionChange={onSelectionChange}
        onInit={(instance) => {
          rfInstance.current = instance;
          const vp = activeWorkflow?.viewport;
          requestAnimationFrame(() => {
            if (vp) {
              instance.setViewport(vp, { duration: 0 });
            } else {
              instance.fitView({ padding: 0.15, duration: 0 });
            }
          });
        }}
        onMoveEnd={onMoveEnd}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{ type: 'execution' }}
        nodesDraggable={isInteractive}
        nodesConnectable={isInteractive}
        elementsSelectable={isInteractive}
        deleteKeyCode={isInteractive ? 'Delete' : null}
        multiSelectionKeyCode={isInteractive ? ['Meta', 'Control'] : null}
        selectionKeyCode={isInteractive ? 'Shift' : null}
        className={isDark ? '!bg-[#171717]' : '!bg-[#E9EEF6]'}
      >
        <Background
          variant={BackgroundVariant.Dots}
          color={isDark ? '#4a4a4a' : '#94a3b8'}
          gap={20}
          size={1.5}
        />
        <Controls
          showInteractive={false}
          className={
            isDark
              ? '!bg-slate-900/55 !backdrop-blur-md !border-white/15 !text-slate-300'
              : '!bg-white/80 !backdrop-blur-md !border-slate-200 !text-slate-600'
          }
        >
          <ControlButton
            onClick={() => setIsInteractive(!isInteractive)}
            title={isInteractive ? 'Lock canvas (disable editing)' : 'Unlock canvas (enable editing)'}
          >
            {isInteractive
              ? <Unlock className="w-3.5 h-3.5" />
              : <Lock className="w-3.5 h-3.5" />
            }
          </ControlButton>
        </Controls>
        <MiniMap
          className={
            isDark
              ? '!bg-slate-900/60 !backdrop-blur-md !border-white/15'
              : '!bg-white/80 !backdrop-blur-md !border-slate-200'
          }
          nodeColor={(node) =>
            node.type === 'stickyNote'
              ? '#fef08a'
              : nodeAccentColor((node.data as CanvasNodeData).nodeType)
          }
          maskColor={isDark ? 'rgba(15,23,42,0.7)' : 'rgba(241,245,249,0.7)'}
        />
      </ReactFlow>

      {/* Node picker + sticky note button */}
      <NodePickerPopup
        onSelect={handlePickerSelect}
        onAddStickyNote={handleAddStickyNote}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
      />

      {/* Right-click context menu */}
      <ContextMenu
        menu={contextMenu}
        onDuplicate={handleDuplicate}
        onDelete={handleDelete}
        onClose={() => setContextMenu(null)}
      />

      {/* ── Delete confirmation modal ──────────────────────────────────────────── */}
      {(() => {
        const targetNode = pendingDeleteNodeId
          ? nodes.find((n) => n.id === pendingDeleteNodeId)
          : null;
        return (
          <ConfirmModal
            open={!!pendingDeleteNodeId}
            title="Delete node"
            message={
              targetNode
                ? `Are you sure you want to delete "${targetNode.data.label}"? This will also remove all connected edges and cannot be undone.`
                : 'Are you sure you want to delete this node? This will also remove all connected edges and cannot be undone.'
            }
            confirmLabel="Delete"
            danger
            onConfirm={() => {
              if (pendingDeleteNodeId) deleteNode(pendingDeleteNodeId);
            }}
            onCancel={() => setPendingDeleteNodeId(null)}
          />
        );
      })()}

      {/* ── Disable node warning modal (toolbar-triggered) ────────────────────── */}
      {nodeDisableModal.open && nodeDisableModal.nodeId && (() => {
        const targetNode = nodes.find((n) => n.id === nodeDisableModal.nodeId);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
              onClick={() => setNodeDisableModal({ open: false, nodeId: null, dependents: [] })}
            />
            <div className="relative bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5">
              <button
                onClick={() => setNodeDisableModal({ open: false, nodeId: null, dependents: [] })}
                className="absolute top-3 right-3 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-start gap-3 pr-5">
                <div className="w-8 h-8 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Node output is in use</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    <span className="font-medium text-gray-800 dark:text-slate-200">"{targetNode?.data.label ?? 'This node'}"</span> is referenced by{' '}
                    <span className="font-medium text-amber-600 dark:text-amber-300">
                      {nodeDisableModal.dependents.length} node{nodeDisableModal.dependents.length !== 1 ? 's' : ''}
                    </span>.
                    Disabling it will cause those nodes to fail with an error when the workflow runs.
                  </p>
                </div>
              </div>
              <div className="mt-3.5 space-y-1.5 max-h-44 overflow-y-auto">
                {nodeDisableModal.dependents.map((dep) => (
                  <div
                    key={dep.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900/70 rounded-md border border-slate-200 dark:border-slate-700/50"
                  >
                    <span className="shrink-0 opacity-70">
                      <NodeIcon type={dep.data.nodeType} size={12} />
                    </span>
                    <span className="text-xs font-medium text-gray-800 dark:text-slate-200 truncate flex-1">{dep.data.label}</span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0 uppercase tracking-wide">{dep.data.nodeType}</span>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setNodeDisableModal({ open: false, nodeId: null, dependents: [] })}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-gray-900 dark:hover:text-white bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    const id = nodeDisableModal.nodeId;
                    setNodeDisableModal({ open: false, nodeId: null, dependents: [] });
                    if (id) setNodeDisabled(id, true);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors"
                >
                  <Loader2 className="w-3 h-3 hidden" />
                  Disable anyway
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Empty workflow overlay */}
      {workflowNodeCount === 0 && !pickerOpen && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-4 pointer-events-auto select-none">
            <button
              onClick={() => setPickerOpen(true)}
              className="group flex flex-col items-center gap-3 p-8 rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-blue-400 dark:hover:border-blue-500 bg-white/60 dark:bg-slate-800/40 hover:bg-blue-50/60 dark:hover:bg-blue-500/10 transition-all active:scale-95 shadow-sm"
            >
              <span className="w-14 h-14 rounded-2xl bg-blue-100 dark:bg-blue-500/15 flex items-center justify-center shadow-inner group-hover:bg-blue-200 dark:group-hover:bg-blue-500/25 transition-colors">
                <Plus className="w-7 h-7 text-blue-500 dark:text-blue-400" strokeWidth={2} />
              </span>
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                  Add your first node
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                  Click to browse available nodes
                </p>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── New Project modal ─────────────────────────────────────────────────────────

export function NewProjectModal({
  open,
  inputRef,
  value,
  onChange,
  onSubmit,
  onClose,
}: {
  open: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm bg-white dark:bg-[#1E293B] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100 dark:border-slate-700/60">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-500/15 flex items-center justify-center">
              <FolderPlus className="w-4 h-4 text-amber-500" />
            </span>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-white">New Project</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
            Project name
          </label>
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit();
              if (e.key === 'Escape') onClose();
            }}
            placeholder="e.g. Marketing Automations"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-sm text-slate-800 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-400 transition"
          />
        </div>

        <div className="px-5 pb-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={!value.trim()}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors shadow-sm"
          >
            Create Project
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { useCallback, useEffect, useRef, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useWorkflowStore, type CanvasNode, type CanvasEdge, type CanvasNodeData } from '../../store/workflowStore';
import { ExecutionEdge, type EdgeExecutionStatus } from '../edges/ExecutionEdge';
import { NodePickerPopup } from './NodePickerPopup';
import { nodeAccentColor } from '../nodes/NodeIcons';
import { HttpNodeWidget } from '../nodes/HttpNodeWidget';
import { LLMNodeWidget } from '../nodes/LLMNodeWidget';
import { ConditionNodeWidget } from '../nodes/ConditionNodeWidget';
import { SwitchNodeWidget } from '../nodes/SwitchNodeWidget';
import { TransformNodeWidget } from '../nodes/TransformNodeWidget';
import { OutputNodeWidget } from '../nodes/OutputNodeWidget';
import { GmailNodeWidget } from '../nodes/GmailNodeWidget';
import { GDriveNodeWidget } from '../nodes/GDriveNodeWidget';
import { GDocsNodeWidget } from '../nodes/GDocsNodeWidget';
import { GSheetsNodeWidget } from '../nodes/GSheetsNodeWidget';
import { SlackNodeWidget } from '../nodes/SlackNodeWidget';
import { TeamsNodeWidget } from '../nodes/TeamsNodeWidget';
import { BasecampNodeWidget } from '../nodes/BasecampNodeWidget';
import { TriggerNodeWidget } from '../nodes/TriggerNodeWidget';
import type { NodeType } from '../../types/workflow';

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

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
    case 'output': return <OutputNodeWidget {...p} />;
    case 'gmail':   return <GmailNodeWidget   {...p} />;
    case 'gdrive':  return <GDriveNodeWidget  {...p} />;
    case 'gdocs':   return <GDocsNodeWidget   {...p} />;
    case 'gsheets': return <GSheetsNodeWidget {...p} />;
    case 'slack':   return <SlackNodeWidget   {...p} />;
    case 'teams':     return <TeamsNodeWidget    {...p} />;
    case 'basecamp':  return <BasecampNodeWidget {...p} />;
    default: return null;
  }
}

const nodeTypes: NodeTypes = { workflowNode: WorkflowNodeRenderer };
const edgeTypes: EdgeTypes = { execution: ExecutionEdge };

const DEFAULT_CONFIGS: Partial<Record<NodeType, Record<string, unknown>>> = {
  trigger: { triggerType: 'manual' },
  http: { method: 'GET', url: '' },
  llm: { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.7, maxTokens: 500, userPrompt: '' },
  condition: { condition: { type: 'leaf', left: '', operator: 'eq', right: '' }, trueNext: '', falseNext: '' },
  switch: { cases: [], defaultNext: '' },
  transform: { mappings: {} },
  output: { value: '' },
  gmail:   { action: 'send',   credentialId: '', to: '', subject: '', body: '' },
  gdrive:  { action: 'list',   credentialId: '', query: '' },
  gdocs:   { action: 'read',   credentialId: '', documentId: '' },
  gsheets: { action: 'read',   credentialId: '', spreadsheetId: '', range: 'Sheet1!A1:Z100' },
  slack:   { action: 'send_message', credentialId: '', channel: '', text: '' },
  teams:    { action: 'send_message', credentialId: '', teamId: '', channelId: '', text: '' },
  basecamp: { action: 'create_todo', credentialId: '', projectId: '', todolistId: '' },
};

function resolveEdgeStatus(
  srcStatus: string | undefined,
  tgtStatus: string | undefined,
  isExecuting: boolean
): EdgeExecutionStatus {
  // ── Pre-execution dim phase ───────────────────────────────────────
  if (srcStatus === 'waiting' || tgtStatus === 'waiting') return 'waiting';

  // ── No execution data yet ─────────────────────────────────────────
  if (!srcStatus) return 'idle';

  // ── Live execution ────────────────────────────────────────────────
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

export function WorkflowCanvas() {
  const {
    nodes,
    edges,
    setNodes,
    setEdges,
    setSelectedNodeId,
    setConfigOpen,
    activeWorkflow,
    setDirty,
    executionStatuses,
    isExecuting,
    theme,
    setCanvasViewport,
  } = useWorkflowStore();

  const rfInstance = useRef<ReactFlowInstance<CanvasNode> | null>(null);
  const isDark = theme === 'dark';

  // Restore the saved viewport (or fitView) whenever the active workflow changes.
  // requestAnimationFrame ensures React Flow has committed the new nodes before we act.
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

  // Capture the viewport after every pan/zoom so it's ready when Save is pressed.
  const onMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent, vp: Viewport) => {
      setCanvasViewport(vp);
    },
    [setCanvasViewport],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      setNodes(applyNodeChanges(changes, nodes) as CanvasNode[]);
    },
    [nodes, setNodes]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<CanvasEdge>[]) => {
      setEdges(applyEdgeChanges(changes, edges) as CanvasEdge[]);
    },
    [edges, setEdges]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges(addEdge(connection, edges));
    },
    [edges, setEdges]
  );

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
      const isFirst = nodes.length === 0;
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

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: CanvasNode) => {
      setSelectedNodeId(node.id);
      setConfigOpen(true);
    },
    [setSelectedNodeId, setConfigOpen]
  );

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: CanvasNode) => {
      setSelectedNodeId(node.id);
      setConfigOpen(true);
    },
    [setSelectedNodeId, setConfigOpen]
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setConfigOpen(false);
  }, [setSelectedNodeId, setConfigOpen]);

  // Add a node from the floating picker — placed in the visible center of the viewport
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
      const isFirst = nodes.length === 0;
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

  // Derive per-edge execution status and stamp it into edge.data
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

  if (!activeWorkflow) {
    return (
      <div className="h-full flex items-center justify-center bg-[#E9EEF6] dark:bg-[#171717]">
        <div className="text-center">
          <p className="text-slate-400 dark:text-slate-500 text-sm">Select a workflow or create a new one</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        onInit={(instance) => {
          rfInstance.current = instance;
          // Handle the very first render — rfInstance wasn't set when the effect ran
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
        deleteKeyCode="Delete"
        className={isDark ? '!bg-[#171717]' : '!bg-[#E9EEF6]'}
      >
        <Background
          variant={BackgroundVariant.Dots}
          color={isDark ? '#2e2e2e' : '#c5cfe0'}
          gap={20}
          size={1}
        />
        <Controls
          className={
            isDark
              ? '!bg-slate-900/55 !backdrop-blur-md !border-white/15 !text-slate-300'
              : '!bg-white/80 !backdrop-blur-md !border-slate-200 !text-slate-600'
          }
        />
        <MiniMap
          className={
            isDark
              ? '!bg-slate-900/60 !backdrop-blur-md !border-white/15'
              : '!bg-white/80 !backdrop-blur-md !border-slate-200'
          }
          nodeColor={(node) => nodeAccentColor((node.data as CanvasNodeData).nodeType)}
          maskColor={isDark ? 'rgba(15,23,42,0.7)' : 'rgba(241,245,249,0.7)'}
        />
      </ReactFlow>

      {/* Floating node picker — sits above the React Flow canvas */}
      <NodePickerPopup onSelect={handlePickerSelect} />
    </div>
  );
}

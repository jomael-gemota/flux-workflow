import { Handle, Position } from '@xyflow/react';
import type { ReactNode } from 'react';
import { useWorkflowStore } from '../../store/workflowStore';
import type { NodeExecutionStatus } from '../../store/workflowStore';
import { NodeIcon, nodeHeaderColor } from './NodeIcons';

const STATUS_RING: Record<NodeExecutionStatus, string> = {
  waiting:  'opacity-40',
  pending:  'opacity-60',
  running:  'ring-2 ring-blue-400 ring-offset-1 shadow-blue-400/40 shadow-lg',
  success:  'ring-2 ring-emerald-400 ring-offset-1 shadow-emerald-400/30 shadow-md',
  failure:  'ring-2 ring-red-400 ring-offset-1 shadow-red-400/40 shadow-md',
  skipped:  'opacity-40',
};

const STATUS_BADGE: Partial<Record<NodeExecutionStatus, { icon: string; cls: string }>> = {
  running:  { icon: '⏳', cls: 'bg-blue-500 text-white animate-pulse' },
  success:  { icon: '✓',  cls: 'bg-emerald-500 text-white' },
  failure:  { icon: '✕',  cls: 'bg-red-500 text-white' },
  skipped:  { icon: '⊘',  cls: 'bg-slate-400 text-white' },
};

interface BaseNodeProps {
  nodeId?: string;
  nodeType: string;
  label: string;
  isEntry?: boolean;
  isParallelEntry?: boolean;
  isSelected?: boolean;
  isDisabled?: boolean;
  children?: ReactNode;
  handles?: {
    inputs?: Array<{ id?: string; label?: string }>;
    outputs?: Array<{ id?: string; label?: string }>;
  };
}

export function BaseNode({
  nodeId,
  nodeType,
  label,
  isEntry,
  isParallelEntry,
  isSelected,
  isDisabled,
  children,
  handles,
}: BaseNodeProps) {
  const status = useWorkflowStore(
    (s) => (nodeId ? s.executionStatuses[nodeId] : undefined)
  );

  const headerBg = nodeHeaderColor(nodeType);
  const inputs   = handles?.inputs  ?? [{}];
  const outputs  = handles?.outputs ?? [{}];
  const badge    = status ? STATUS_BADGE[status] : undefined;
  const ringCls  = status ? STATUS_RING[status]  : '';

  return (
    <div
      className={`relative rounded-lg shadow-md bg-white border-2 min-w-[180px] transition-all duration-300 ${ringCls} ${
        isDisabled  ? 'border-dashed border-slate-300 opacity-50'
        : isSelected ? 'border-blue-500 shadow-blue-200 shadow-lg'
        : isEntry    ? 'border-amber-400'
        : 'border-slate-200'
      }`}
    >
      {/* Running pulse ring */}
      {status === 'running' && (
        <div className="absolute inset-0 rounded-lg border-2 border-blue-400 animate-ping opacity-40 pointer-events-none" />
      )}

      {/* Status badge (top-right corner) */}
      {badge && !isDisabled && (
        <span
          className={`absolute -top-2 -right-2 z-10 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shadow ${badge.cls}`}
        >
          {badge.icon}
        </span>
      )}

      {/* Disabled badge (top-right corner) — always visible when disabled */}
      {isDisabled && (
        <span className="absolute -top-2 -right-2 z-10 px-1.5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shadow bg-slate-400 text-white whitespace-nowrap">
          OFF
        </span>
      )}

      {/* Header */}
      <div className={`${headerBg} rounded-t-md px-2.5 py-1.5 flex items-center gap-2 ${isDisabled ? 'opacity-60' : ''}`}>
        {/* Icon */}
        <span className="shrink-0 w-4 h-4 flex items-center justify-center opacity-90">
          <NodeIcon type={nodeType} size={13} />
        </span>

        {/* Entry badges */}
        {isEntry && !isParallelEntry && (
          <span className="text-[9px] font-bold bg-white/25 text-white rounded px-1 leading-none py-0.5">
            START
          </span>
        )}
        {isEntry && isParallelEntry && (
          <span className="text-[9px] font-bold bg-white/25 text-white rounded px-1 leading-none py-0.5 flex items-center gap-0.5">
            ⚡ START
          </span>
        )}

        {/* Node type label */}
        <span className="text-[10px] uppercase tracking-wide text-white/80 font-semibold ml-auto">
          {nodeType}
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <p className={`text-sm font-medium truncate ${isDisabled ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
          {label}
        </p>
        {children && !isDisabled && <div className="mt-1">{children}</div>}
      </div>

      {/* Input handles */}
      {inputs.map((h, i) => (
        <Handle
          key={`in-${i}`}
          type="target"
          position={Position.Left}
          id={h.id}
          style={{ top: `${((i + 1) / (inputs.length + 1)) * 100}%` }}
          className="!w-3 !h-3 !bg-slate-300 !border-white !border-2"
        />
      ))}

      {/* Output handles */}
      {outputs.map((h, i) => (
        <div key={`out-${i}`}>
          {h.label && (
            <span
              className="absolute text-[9px] text-slate-400 font-medium"
              style={{
                right: 14,
                top: `calc(${((i + 1) / (outputs.length + 1)) * 100}% - 6px)`,
              }}
            >
              {h.label}
            </span>
          )}
          <Handle
            type="source"
            position={Position.Right}
            id={h.id}
            style={{ top: `${((i + 1) / (outputs.length + 1)) * 100}%` }}
            className="!w-3 !h-3 !bg-slate-300 !border-white !border-2"
          />
        </div>
      ))}
    </div>
  );
}

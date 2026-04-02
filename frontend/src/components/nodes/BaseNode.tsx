import { Fragment } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { ReactNode } from 'react';
import { useWorkflowStore } from '../../store/workflowStore';
import type { NodeExecutionStatus } from '../../store/workflowStore';
import { NodeIcon, nodeHeaderColor } from './NodeIcons';

// ── Status overlays ────────────────────────────────────────────────────────────

const STATUS_WRAPPER: Record<NodeExecutionStatus, string> = {
  waiting: 'opacity-40',
  pending: 'opacity-60',
  running: '',
  success: '',
  failure: '',
  skipped: 'opacity-40',
};

const STATUS_SQUARE: Record<NodeExecutionStatus, string> = {
  waiting: '',
  pending: '',
  running: 'ring-[4px] ring-blue-400 shadow-[0_0_0_8px_rgba(59,130,246,0.20)]',
  success: 'ring-[4px] ring-emerald-400 shadow-[0_0_0_8px_rgba(34,197,94,0.16)]',
  failure: 'ring-[4px] ring-red-400 shadow-[0_0_0_8px_rgba(239,68,68,0.20)]',
  skipped: '',
};

const STATUS_BADGE: Partial<Record<NodeExecutionStatus, { icon: string; cls: string }>> = {
  running: { icon: '⏳', cls: 'bg-blue-500 text-white animate-pulse' },
  success: { icon: '✓',  cls: 'bg-emerald-500 text-white' },
  failure: { icon: '✕',  cls: 'bg-red-500 text-white' },
  skipped: { icon: '⊘',  cls: 'bg-slate-400 text-white' },
};

// ── Props ──────────────────────────────────────────────────────────────────────

interface BaseNodeProps {
  nodeId?: string;
  nodeType: string;
  /** Overrides nodeType for icon resolution (e.g. "anthropic" on an LLM node) */
  nodeIconType?: string;
  label: string;
  isEntry?: boolean;
  isParallelEntry?: boolean;
  isSelected?: boolean;
  isDisabled?: boolean;
  /** Rendered as floating subtext directly below the node label */
  children?: ReactNode;
  handles?: {
    inputs?: Array<{ id?: string; label?: string }>;
    outputs?: Array<{ id?: string; label?: string }>;
  };
}

// Square side length in px — React Flow measures this for layout / edge routing
const SZ = 100;

// ── Component ──────────────────────────────────────────────────────────────────

export function BaseNode({
  nodeId,
  nodeType,
  nodeIconType,
  label,
  isEntry,
  isParallelEntry,
  isSelected,
  isDisabled,
  children,
  handles,
}: BaseNodeProps) {
  const status = useWorkflowStore(
    (s) => (nodeId ? s.executionStatuses[nodeId] : undefined),
  );

  const squareBg      = nodeHeaderColor(nodeType);
  const inputs        = handles?.inputs  ?? [{}];
  const outputs       = handles?.outputs ?? [{}];
  const badge         = status ? STATUS_BADGE[status]  : undefined;
  const wrapperCls    = status ? STATUS_WRAPPER[status] : '';
  const squareRingCls = status ? STATUS_SQUARE[status]  : '';

  return (
    /*
      Outer wrapper is exactly SZ×SZ so React Flow measures the correct bounding
      box for edge routing. `overflow-visible` lets the floating label/subtext
      below the square escape without clipping.
    */
    <div
      className={`relative overflow-visible transition-opacity duration-300 ${wrapperCls}`}
      style={{ width: SZ, height: SZ }}
    >
      {/* ── Square card ─────────────────────────────────────────────────────── */}
      <div
        className={[
          'w-full h-full rounded-2xl flex items-center justify-center transition-all duration-300',
          'border border-slate-200 dark:border-slate-600',
          squareBg,
          squareRingCls,
          isSelected
            ? 'shadow-2xl ring-[4px] ring-blue-500 dark:ring-white/80 ring-offset-[4px] ring-offset-transparent'
            : 'shadow-xl hover:shadow-2xl hover:scale-105',
          isDisabled ? 'opacity-50 saturate-50' : '',
        ].join(' ')}
      >
        {/* Running pulse ring */}
        {status === 'running' && (
          <div className="absolute inset-0 rounded-2xl border-2 border-blue-400 animate-ping opacity-30 pointer-events-none" />
        )}

        {/* Centred icon */}
        <span className="flex items-center justify-center">
          <NodeIcon type={nodeIconType ?? nodeType} size={42} />
        </span>
      </div>

      {/* ── Status badge — bottom-right of square ─────────────────────────── */}
      {badge && !isDisabled && (
        <span
          className={`absolute -bottom-2.5 -right-2.5 z-10 w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold shadow-lg ${badge.cls}`}
        >
          {badge.icon}
        </span>
      )}

      {/* ── Disabled badge — top-right of square ──────────────────────────── */}
      {isDisabled && (
        <span className="absolute -top-2.5 -right-2.5 z-10 px-2 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shadow bg-slate-500 text-white whitespace-nowrap">
          OFF
        </span>
      )}

      {/* ── Entry badge — above the square ────────────────────────────────── */}
      {isEntry && (
        <span
          className={`absolute -top-3.5 left-1/2 -translate-x-1/2 z-10 px-2.5 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap shadow-md leading-none ${
            isParallelEntry ? 'bg-amber-500 text-white' : 'bg-amber-400 text-white'
          }`}
        >
          {isParallelEntry ? '⚡ START' : 'START'}
        </span>
      )}

      {/* ── Floating label + subtext ───────────────────────────────────────── */}
      <div
        className="absolute left-1/2 -translate-x-1/2 pointer-events-none flex flex-col items-center gap-0.5"
        style={{ top: SZ + 10 }}
      >
        <p
          className={[
            'text-[16px] font-semibold whitespace-nowrap text-center leading-tight',
            isDisabled
              ? 'line-through text-slate-400 dark:text-slate-500'
              : 'text-slate-700 dark:text-slate-100',
          ].join(' ')}
        >
          {label}
        </p>

        {children && !isDisabled && (
          <div className="text-center [&_p]:m-0 [&_p]:text-[13px] [&_p]:whitespace-nowrap [&_span]:text-[13px]">
            {children}
          </div>
        )}
      </div>

      {/* ── Input handles (left edge) ─────────────────────────────────────── */}
      {inputs.map((h, i) => (
        <Handle
          key={`in-${i}`}
          type="target"
          position={Position.Left}
          id={h.id}
          style={{ top: `${((i + 1) / (inputs.length + 1)) * 100}%` }}
          className="!w-[16px] !h-[16px] !bg-white dark:!bg-slate-200 !border-[3px] !border-slate-400 dark:!border-slate-500 !rounded-full !shadow-md"
        />
      ))}

      {/* ── Output handles (right edge) ───────────────────────────────────── */}
      {outputs.map((h, i) => {
        const pct = ((i + 1) / (outputs.length + 1)) * 100;
        return (
          <Fragment key={`out-${i}`}>
            {h.label && (
              <span
                className="absolute whitespace-nowrap text-[11px] font-semibold
                  text-slate-600 dark:text-slate-300
                  bg-white/90 dark:bg-slate-800/90
                  px-2 py-0.5 rounded-full
                  border border-slate-200/80 dark:border-slate-600/60
                  shadow-sm pointer-events-none z-10"
                style={{
                  left: SZ + 22,
                  top: `calc(${pct}% - 11px)`,
                }}
              >
                {h.label}
              </span>
            )}
            <Handle
              type="source"
              position={Position.Right}
              id={h.id}
              style={{ top: `${pct}%` }}
              className="!w-[16px] !h-[16px] !bg-white dark:!bg-slate-200 !border-[3px] !border-slate-400 dark:!border-slate-500 !rounded-full !shadow-md"
            />
          </Fragment>
        );
      })}
    </div>
  );
}

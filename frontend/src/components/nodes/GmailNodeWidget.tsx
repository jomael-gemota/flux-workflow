import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type GmailNode = Node<CanvasNodeData, 'workflowNode'>;

export function GmailNodeWidget({ id, data, selected }: NodeProps<GmailNode>) {
  const cfg = data.config as { action?: string; to?: string; query?: string };
  return (
    <BaseNode
      nodeId={id}
      nodeType="gmail"
      label={data.label}
      isEntry={data.isEntry}
      isParallelEntry={data.isParallelEntry}
      isSelected={selected}
      isDisabled={data.disabled}
    >
      {cfg.action && (
        <p className="text-[10px] text-slate-400 truncate">
          <span className="font-semibold text-red-400">{cfg.action}</span>
          {cfg.action === 'send' && cfg.to && ` → ${cfg.to}`}
          {cfg.action === 'list' && cfg.query && ` "${cfg.query}"`}
        </p>
      )}
    </BaseNode>
  );
}

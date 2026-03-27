import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type GSheetsNode = Node<CanvasNodeData, 'workflowNode'>;

export function GSheetsNodeWidget({ id, data, selected }: NodeProps<GSheetsNode>) {
  const cfg = data.config as { action?: string; spreadsheetId?: string; range?: string };
  return (
    <BaseNode
      nodeId={id}
      nodeType="gsheets"
      label={data.label}
      isEntry={data.isEntry}
      isParallelEntry={data.isParallelEntry}
      isSelected={selected}
      isDisabled={data.disabled}
    >
      {cfg.action && (
        <p className="text-[10px] text-slate-400 truncate">
          <span className="font-semibold text-green-400">{cfg.action}</span>
          {cfg.range && ` ${cfg.range}`}
        </p>
      )}
    </BaseNode>
  );
}

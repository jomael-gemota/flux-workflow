import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type OutputNode = Node<CanvasNodeData, 'workflowNode'>;

export function OutputNodeWidget({ id, data, selected }: NodeProps<OutputNode>) {
  const cfg = data.config as { value?: string };
  return (
    <BaseNode
      nodeId={id}
      nodeType="output"
      label={data.label}
      isEntry={data.isEntry}
      isParallelEntry={data.isParallelEntry}
      isSelected={selected}
      isDisabled={data.disabled}
      handles={{ outputs: [] }}
    >
      {cfg.value && (
        <p className="text-[10px] text-slate-400 truncate">{cfg.value}</p>
      )}
    </BaseNode>
  );
}

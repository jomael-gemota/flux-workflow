import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type ConditionNode = Node<CanvasNodeData, 'workflowNode'>;

export function ConditionNodeWidget({ id, data, selected }: NodeProps<ConditionNode>) {
  return (
    <BaseNode
      nodeId={id}
      nodeType="condition"
      label={data.label}
      isEntry={data.isEntry}
      isParallelEntry={data.isParallelEntry}
      isSelected={selected}
      isDisabled={data.disabled}
      handles={{
        outputs: [
          { id: 'true', label: 'true' },
          { id: 'false', label: 'false' },
        ],
      }}
    >
      <p className="text-[10px] text-slate-500 dark:text-slate-400">if / else branch</p>
    </BaseNode>
  );
}

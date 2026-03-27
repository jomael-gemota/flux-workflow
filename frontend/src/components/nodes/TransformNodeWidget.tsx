import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type TransformNode = Node<CanvasNodeData, 'workflowNode'>;

export function TransformNodeWidget({ id, data, selected }: NodeProps<TransformNode>) {
  const cfg = data.config as { mappings?: Record<string, string> };
  const count = Object.keys(cfg.mappings ?? {}).length;
  return (
    <BaseNode
      nodeId={id}
      nodeType="transform"
      label={data.label}
      isEntry={data.isEntry}
      isParallelEntry={data.isParallelEntry}
      isSelected={selected}
      isDisabled={data.disabled}
    >
      <p className="text-[10px] text-slate-400">
        {count} mapping{count !== 1 ? 's' : ''}
      </p>
    </BaseNode>
  );
}

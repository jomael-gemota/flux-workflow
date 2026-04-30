import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type ExtractNode = Node<CanvasNodeData, 'workflowNode'>;

interface ExtractField {
  name?: string;
  strategy?: { kind?: string };
}

export function ExtractNodeWidget({ id, data, selected }: NodeProps<ExtractNode>) {
  const cfg = data.config as { fields?: ExtractField[] };
  const fields = Array.isArray(cfg.fields) ? cfg.fields : [];
  const count = fields.length;
  const named = fields
    .map((f) => f?.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0)
    .slice(0, 3);

  return (
    <BaseNode
      nodeId={id}
      nodeType="extract"
      label={data.label}
      isEntry={data.isEntry}
      isParallelEntry={data.isParallelEntry}
      isSelected={selected}
      isDisabled={data.disabled}
    >
      <p className="text-[10px] text-slate-500 dark:text-slate-400">
        {count === 0
          ? 'No fields'
          : `${count} field${count !== 1 ? 's' : ''}${named.length > 0 ? `: ${named.join(', ')}${count > named.length ? '…' : ''}` : ''}`}
      </p>
    </BaseNode>
  );
}

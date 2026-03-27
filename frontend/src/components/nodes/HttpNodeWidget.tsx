import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type HttpNode = Node<CanvasNodeData, 'workflowNode'>;

export function HttpNodeWidget({ id, data, selected }: NodeProps<HttpNode>) {
  const cfg = data.config as { method?: string; url?: string };
  return (
    <BaseNode
      nodeId={id}
      nodeType="http"
      label={data.label}
      isEntry={data.isEntry}
      isParallelEntry={data.isParallelEntry}
      isSelected={selected}
      isDisabled={data.disabled}
    >
      {cfg.url && (
        <p className="text-[10px] text-slate-400 truncate">
          <span className="font-semibold text-blue-500">{cfg.method ?? 'GET'}</span>{' '}
          {cfg.url}
        </p>
      )}
    </BaseNode>
  );
}

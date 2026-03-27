import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type LLMNode = Node<CanvasNodeData, 'workflowNode'>;

export function LLMNodeWidget({ id, data, selected }: NodeProps<LLMNode>) {
  const cfg = data.config as { provider?: string; model?: string };
  return (
    <BaseNode
      nodeId={id}
      nodeType="llm"
      label={data.label}
      isEntry={data.isEntry}
      isParallelEntry={data.isParallelEntry}
      isSelected={selected}
      isDisabled={data.disabled}
    >
      {cfg.model && (
        <p className="text-[10px] text-slate-400 truncate">
          <span className="font-semibold text-emerald-500">{cfg.provider ?? 'openai'}</span>{' '}
          · {cfg.model}
        </p>
      )}
    </BaseNode>
  );
}

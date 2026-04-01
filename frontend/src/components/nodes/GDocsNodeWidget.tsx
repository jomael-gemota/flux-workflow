import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type GDocsNode = Node<CanvasNodeData, 'workflowNode'>;

export function GDocsNodeWidget({ id, data, selected }: NodeProps<GDocsNode>) {
  const cfg = data.config as { action?: string; title?: string; documentId?: string };
  return (
    <BaseNode
      nodeId={id}
      nodeType="gdocs"
      label={data.label}
      isEntry={data.isEntry}
      isParallelEntry={data.isParallelEntry}
      isSelected={selected}
      isDisabled={data.disabled}
    >
      {cfg.action && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-indigo-600 dark:text-indigo-400">{cfg.action}</span>
          {cfg.action === 'create' && cfg.title && ` "${cfg.title}"`}
          {cfg.action !== 'create' && cfg.documentId && ` ${cfg.documentId}`}
        </p>
      )}
    </BaseNode>
  );
}

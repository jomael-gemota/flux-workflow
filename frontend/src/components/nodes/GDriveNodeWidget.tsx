import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type GDriveNode = Node<CanvasNodeData, 'workflowNode'>;

export function GDriveNodeWidget({ id, data, selected }: NodeProps<GDriveNode>) {
  const cfg = data.config as { action?: string; fileName?: string; fileId?: string };
  return (
    <BaseNode
      nodeId={id}
      nodeType="gdrive"
      label={data.label}
      isEntry={data.isEntry}
      isParallelEntry={data.isParallelEntry}
      isSelected={selected}
      isDisabled={data.disabled}
    >
      {cfg.action && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-blue-600 dark:text-blue-400">{cfg.action}</span>
          {cfg.action === 'upload' && cfg.fileName && ` ${cfg.fileName}`}
          {cfg.action === 'download' && cfg.fileId && ` ${cfg.fileId}`}
        </p>
      )}
    </BaseNode>
  );
}

import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type TeamsNode = Node<CanvasNodeData, 'workflowNode'>;

const ACTION_LABELS: Record<string, string> = {
  send_message:  'Send Channel Message',
  send_dm:       'Send Direct Message',
  read_messages: 'Read Messages',
};

export function TeamsNodeWidget({ id, data, selected }: NodeProps<TeamsNode>) {
  const cfg = data.config as { action?: string; teamId?: string; channelId?: string; userId?: string };
  const actionLabel = cfg.action ? (ACTION_LABELS[cfg.action] ?? cfg.action) : null;
  return (
    <BaseNode
      nodeId={id}
      nodeType="teams"
      label={data.label}
      isEntry={data.isEntry}
      isParallelEntry={data.isParallelEntry}
      isSelected={selected}
      isDisabled={data.disabled}
    >
      {actionLabel && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-blue-600 dark:text-blue-400">{actionLabel}</span>
          {(cfg.action === 'send_message' || cfg.action === 'read_messages') && cfg.channelId && (
            ` → channel`
          )}
          {cfg.action === 'send_dm' && cfg.userId && ` → user`}
        </p>
      )}
    </BaseNode>
  );
}

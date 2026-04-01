import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type SlackNode = Node<CanvasNodeData, 'workflowNode'>;

const ACTION_LABELS: Record<string, string> = {
  send_message: 'Send Message',
  send_dm:      'Send DM',
  upload_file:  'Upload File',
  read_messages:'Read Messages',
};

export function SlackNodeWidget({ id, data, selected }: NodeProps<SlackNode>) {
  const cfg = data.config as { action?: string; channel?: string; userId?: string };
  const actionLabel = cfg.action ? (ACTION_LABELS[cfg.action] ?? cfg.action) : null;
  return (
    <BaseNode
      nodeId={id}
      nodeType="slack"
      label={data.label}
      isEntry={data.isEntry}
      isParallelEntry={data.isParallelEntry}
      isSelected={selected}
      isDisabled={data.disabled}
    >
      {actionLabel && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-violet-600 dark:text-violet-400">{actionLabel}</span>
          {cfg.action === 'send_message' && cfg.channel && ` → #${cfg.channel}`}
          {cfg.action === 'send_dm'      && cfg.userId  && ` → @${cfg.userId}`}
          {cfg.action === 'read_messages' && cfg.channel && ` from #${cfg.channel}`}
        </p>
      )}
    </BaseNode>
  );
}

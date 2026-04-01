import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type BasecampNode = Node<CanvasNodeData, 'workflowNode'>;

const ACTION_LABELS: Record<string, string> = {
  create_todo:     'Create To-Do',
  complete_todo:   'Complete To-Do',
  uncomplete_todo: 'Re-Open To-Do',
  post_message:    'Post Message',
  post_comment:    'Post Comment',
  send_campfire:   'Campfire Message',
  list_todos:      'List To-Dos',
};

export function BasecampNodeWidget({ id, data, selected }: NodeProps<BasecampNode>) {
  const cfg = data.config as { action?: string; projectId?: string };
  const actionLabel = cfg.action ? (ACTION_LABELS[cfg.action] ?? cfg.action) : null;
  return (
    <BaseNode
      nodeId={id}
      nodeType="basecamp"
      label={data.label}
      isEntry={data.isEntry}
      isParallelEntry={data.isParallelEntry}
      isSelected={selected}
      isDisabled={data.disabled}
    >
      {actionLabel && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-green-600 dark:text-green-400">{actionLabel}</span>
          {cfg.projectId && ` → project`}
        </p>
      )}
    </BaseNode>
  );
}

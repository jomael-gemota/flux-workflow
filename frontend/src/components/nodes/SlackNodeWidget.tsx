import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type SlackNode = Node<CanvasNodeData, 'workflowNode'>;

const ACTION_LABELS: Record<string, string> = {
  send_message:  'Send Message',
  send_dm:       'Send DM',
  upload_file:   'Upload File',
  read_messages: 'Read Messages',
  read_thread:   'Read Thread',
  list_users:    'List Users',
  list_channels: 'List Channels',
};

/** Safely coerce a config value that may be a string, string array, or anything else. */
function coerceStr(v: unknown): string {
  if (!v) return '';
  if (Array.isArray(v)) return v.map(String).join(',');
  return String(v);
}

export function SlackNodeWidget({ id, data, selected }: NodeProps<SlackNode>) {
  const cfg = data.config as {
    action?: string;
    channel?: unknown;
    channels?: unknown;
    userId?: unknown;
    userIds?: unknown;
    readSource?: string;
    channelFilter?: string;
    threadTs?: string;
  };

  const actionLabel = cfg.action ? (ACTION_LABELS[cfg.action] ?? cfg.action) : null;

  const channelTarget = coerceStr(cfg.channels || cfg.channel);
  const userTarget    = coerceStr(cfg.userIds  || cfg.userId);

  const subtitle = (() => {
    if (!cfg.action) return null;
    if (cfg.action === 'send_message' && channelTarget)
      return ` → #${channelTarget.split(',')[0].trim()}${channelTarget.includes(',') ? ' +more' : ''}`;
    if (cfg.action === 'send_dm' && userTarget)
      return ` → @${userTarget.split(',')[0].trim()}${userTarget.includes(',') ? ' +more' : ''}`;
    if (cfg.action === 'read_messages') {
      if (cfg.readSource === 'dm' && userTarget) return ` DM @${userTarget}`;
      if (channelTarget) return ` from #${channelTarget}`;
    }
    if (cfg.action === 'read_thread') {
      if (channelTarget) return ` in #${channelTarget.split(',')[0].trim()}`;
      return null;
    }
    if (cfg.action === 'list_channels' && cfg.channelFilter && cfg.channelFilter !== 'all')
      return ` (${cfg.channelFilter})`;
    return null;
  })();

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
          {subtitle && <span>{subtitle}</span>}
        </p>
      )}
    </BaseNode>
  );
}

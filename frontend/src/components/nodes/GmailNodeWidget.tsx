import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type GmailNode = Node<CanvasNodeData, 'workflowNode'>;

export function GmailNodeWidget({ id, data, selected }: NodeProps<GmailNode>) {
  const cfg = data.config as {
    action?: string;
    to?: string | string[];
    fromFilter?: string;
    subjectFilter?: string;
    readStatus?: string;
  };

  function firstRecipient(to: string | string[] | undefined): string | undefined {
    if (!to) return undefined;
    const first = Array.isArray(to) ? to[0] : to.split(',')[0];
    return first?.trim() || undefined;
  }

  const recipient = firstRecipient(cfg.to);
  const toCount   = Array.isArray(cfg.to) ? cfg.to.length : (cfg.to ? cfg.to.split(',').filter(Boolean).length : 0);

  return (
    <BaseNode
      nodeId={id}
      nodeType="gmail"
      label={data.label}
      isEntry={data.isEntry}
      isParallelEntry={data.isParallelEntry}
      isSelected={selected}
      isDisabled={data.disabled}
    >
      {cfg.action && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          <span className={`font-semibold ${cfg.action === 'send_flux' || cfg.action === 'reply_flux' ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`}>
            {cfg.action === 'send'       ? 'Send'
            : cfg.action === 'send_flux'  ? '⚡ Flux Send'
            : cfg.action === 'reply_flux' ? '⚡ Flux Reply'
            : cfg.action === 'list'      ? 'List'
            : 'Read'}
          </span>
          {(cfg.action === 'send' || cfg.action === 'send_flux') && recipient && (
            <span> → {recipient}{toCount > 1 ? ` +${toCount - 1}` : ''}</span>
          )}
          {cfg.action === 'list' && cfg.fromFilter && ` from:${cfg.fromFilter}`}
          {cfg.action === 'list' && cfg.subjectFilter && ` subj:${cfg.subjectFilter}`}
          {cfg.action === 'list' && cfg.readStatus && cfg.readStatus !== 'all' && (
            <span className="ml-1 italic">{cfg.readStatus}</span>
          )}
        </p>
      )}
    </BaseNode>
  );
}

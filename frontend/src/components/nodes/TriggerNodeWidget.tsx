import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type TriggerNode = Node<CanvasNodeData, 'workflowNode'>;

const TYPE_LABELS: Record<string, string> = {
  manual:    'Manual',
  webhook:   'Webhook',
  cron:      'Schedule',
  app_event: 'App Event',
  email:     'Email',
};

export function TriggerNodeWidget({ id, data, selected }: NodeProps<TriggerNode>) {
  const cfg = data.config as {
    triggerType?: string;
    cronExpression?: string;
    webhookMethod?: string;
    appType?: string;
    eventType?: string;
  };
  const typeLabel = cfg.triggerType ? (TYPE_LABELS[cfg.triggerType] ?? cfg.triggerType) : 'Manual';

  let detail = '';
  if (cfg.triggerType === 'webhook' && cfg.webhookMethod) detail = cfg.webhookMethod;
  if (cfg.triggerType === 'cron' && cfg.cronExpression) detail = cfg.cronExpression;
  if (cfg.triggerType === 'app_event' && cfg.appType) detail = `${cfg.appType} → ${cfg.eventType ?? 'event'}`;
  if (cfg.triggerType === 'email') detail = 'Gmail';

  return (
    <BaseNode
      nodeId={id}
      nodeType="trigger"
      label={data.label}
      isEntry={data.isEntry}
      isParallelEntry={data.isParallelEntry}
      isSelected={selected}
      isDisabled={data.disabled}
    >
      <p className="text-[10px] text-slate-500 dark:text-slate-400">
        <span className="font-semibold text-purple-500 dark:text-purple-400">{typeLabel}</span>
        {detail && <span className="ml-1">({detail})</span>}
      </p>
    </BaseNode>
  );
}

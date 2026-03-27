import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type SwitchNode = Node<CanvasNodeData, 'workflowNode'>;

export function SwitchNodeWidget({ id, data, selected }: NodeProps<SwitchNode>) {
  const cfg = data.config as {
    cases?: Array<{ label?: string }>;
  };
  const caseOutputs = (cfg.cases ?? []).map((c, i) => ({
    id: String(i),
    label: c.label ?? `case ${i}`,
  }));
  const outputs = [...caseOutputs, { id: 'default', label: 'default' }];

  return (
    <BaseNode
      nodeId={id}
      nodeType="switch"
      label={data.label}
      isEntry={data.isEntry}
      isParallelEntry={data.isParallelEntry}
      isSelected={selected}
      isDisabled={data.disabled}
      handles={{ outputs }}
    >
      <p className="text-[10px] text-slate-400">
        {caseOutputs.length} case{caseOutputs.length !== 1 ? 's' : ''} + default
      </p>
    </BaseNode>
  );
}

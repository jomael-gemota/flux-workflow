import type { NodeProps, Node } from '@xyflow/react';
import { BaseNode } from './BaseNode';
import type { CanvasNodeData } from '../../store/workflowStore';

type GDriveNode = Node<CanvasNodeData, 'workflowNode'>;

const ACTION_LABELS: Record<string, string> = {
  list:          'List Files / Folders',
  upload:        'Upload File',
  download:      'Download File',
  create_file:   'Create File',
  copy_file:     'Copy File',
  move_file:     'Move File',
  rename_file:   'Rename File',
  update_file:   'Update File Content',
  share_file:    'Share File',
  delete_file:   'Delete File',
  create_folder: 'Create Folder',
  share_folder:  'Share Folder',
  delete_folder: 'Delete Folder',
};

export function GDriveNodeWidget({ id, data, selected }: NodeProps<GDriveNode>) {
  const cfg    = data.config as { action?: string; uploadFileName?: string; downloadFileName?: string; folderName?: string };
  const action = cfg.action ?? '';
  const label  = ACTION_LABELS[action] ?? action;

  const sub =
    action === 'upload'        ? cfg.uploadFileName :
    action === 'download'      ? cfg.downloadFileName :
    action === 'create_folder' ? cfg.folderName :
    undefined;

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
      {action && (
        <p className="text-[10px] text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-blue-600 dark:text-blue-400">{label}</span>
          {sub && <span className="ml-1 text-slate-400 dark:text-slate-500 truncate">{sub}</span>}
        </p>
      )}
    </BaseNode>
  );
}

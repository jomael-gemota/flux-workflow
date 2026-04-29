import { CloudUpload, Zap, BellRing, GitBranch, Loader2, Check } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWorkflowStore } from '../../store/workflowStore';
import { useTriggerWorkflow } from '../../hooks/useWorkflows';
import { useSaveWorkflow } from '../../hooks/useSaveWorkflow';
import { VersionHistoryModal } from '../ui/VersionHistoryModal';
import { NotificationSettingsModal } from '../ui/NotificationSettingsModal';
import { ConfirmModal } from '../ui/ConfirmModal';
import { getNotificationSettingsForWorkflow } from '../../api/client';

// ── Tooltip ────────────────────────────────────────────────────────────────────
function Tooltip({ label }: { label: string }) {
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 pointer-events-none z-50 flex flex-col items-center opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100 transition-all duration-150">
      <span className="block px-2.5 py-1 rounded-md bg-slate-900/90 dark:bg-slate-700/95 backdrop-blur-sm text-white text-[11px] font-medium whitespace-nowrap shadow-lg">
        {label}
      </span>
      {/* Arrow — part of the same opacity group so it's never visible on its own */}
      <span className="block w-2 h-2 bg-slate-900/90 dark:bg-slate-700/95 rotate-45 -mt-1 shrink-0" />
    </div>
  );
}

// ── DockButton ─────────────────────────────────────────────────────────────────
interface DockButtonProps {
  id?: string;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
  active?: boolean;
  /** Small indicator dot */
  dot?: boolean;
}

function DockButton({ id, onClick, disabled, label, children, active, dot }: DockButtonProps) {
  return (
    <div className="group relative">
      <button
        id={id}
        onClick={onClick}
        disabled={disabled}
        className={`relative flex items-center justify-center w-10 h-10 rounded-md transition-all duration-150 ${
          disabled
            ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
            : active
            ? 'bg-blue-500 text-white shadow-md shadow-blue-500/30 hover:bg-blue-600'
            : 'text-slate-600 dark:text-slate-300 hover:bg-black/8 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white'
        }`}
      >
        {children}
        {dot && !disabled && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-500 ring-2 ring-white dark:ring-slate-800" />
        )}
      </button>
      <Tooltip label={label} />
    </div>
  );
}

// ── CanvasActionDock ───────────────────────────────────────────────────────────
export function CanvasActionDock() {
  const {
    activeWorkflow,
    nodes,
    isDirty,
    setLogOpen,
    setLastExecutionId,
    beginExecution,
  } = useWorkflowStore();

  const { save, isSaving } = useSaveWorkflow();
  const trigger = useTriggerWorkflow();

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [alertModal, setAlertModal] = useState<{ open: boolean; title: string; message: string }>({
    open: false, title: '', message: '',
  });
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSaveRef = useRef<() => void>(() => {});

  // Notification settings — for the dot indicator on Alert List
  const activeWorkflowId = activeWorkflow?.id && !activeWorkflow.id.startsWith('__new__')
    ? activeWorkflow.id
    : undefined;
  const { data: notificationSettings } = useQuery({
    queryKey: ['notification-settings', activeWorkflowId],
    queryFn: () => getNotificationSettingsForWorkflow(activeWorkflowId!),
    enabled: Boolean(activeWorkflowId),
    staleTime: 60_000,
  });

  function showAlert(title: string, message: string) {
    setAlertModal({ open: true, title, message });
  }

  async function handleSave() {
    if (!activeWorkflow) return;
    if (nodes.length === 0) {
      showAlert('Cannot save', 'Add at least one node to the canvas before saving.');
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    try {
      await save();
      setSaveStatus('saved');
      saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      setSaveStatus('idle');
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showAlert('Save failed', msg);
    }
  }

  handleSaveRef.current = handleSave;

  // Ctrl+S / Cmd+S shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveRef.current();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  async function handleTrigger() {
    if (!activeWorkflow || !activeWorkflow.id || activeWorkflow.id.startsWith('__new__')) return;
    try {
      const preStatuses: Record<string, import('../../store/workflowStore').NodeExecutionStatus> = {};
      for (const n of nodes) preStatuses[n.id] = 'waiting';
      beginExecution(preStatuses);

      const summary = await trigger.mutateAsync({ workflowId: activeWorkflow.id });
      setLastExecutionId(summary.executionId);
      setLogOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showAlert('Trigger failed', msg);
    }
  }

  const isNew = activeWorkflow?.id?.startsWith('__new__') ?? false;
  const notifEnabled = notificationSettings?.workflowOverride?.enabled ?? false;

  return (
    <>
      {/* ── Modals ── */}
      <ConfirmModal
        alertOnly
        open={alertModal.open}
        title={alertModal.title}
        message={alertModal.message}
        onConfirm={() => setAlertModal(a => ({ ...a, open: false }))}
        onCancel={() => setAlertModal(a => ({ ...a, open: false }))}
      />
      <VersionHistoryModal open={versionHistoryOpen} onClose={() => setVersionHistoryOpen(false)} />
      <NotificationSettingsModal
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        workflowId={activeWorkflowId}
        workflowName={activeWorkflow?.name}
      />

      {/* ── Save feedback toast ── */}
      <div
        className={`absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-4 py-1.5 rounded-full shadow-xl text-xs font-semibold pointer-events-none select-none transition-all duration-300 ${
          saveStatus === 'idle'
            ? 'opacity-0 -translate-y-1.5 scale-95'
            : 'opacity-100 translate-y-0 scale-100'
        } ${
          saveStatus === 'saving'
            ? 'bg-slate-700 dark:bg-slate-600 text-white'
            : 'bg-emerald-500 text-white'
        }`}
      >
        {saveStatus === 'saving' ? (
          <><Loader2 className="w-3 h-3 animate-spin" /><span>Saving…</span></>
        ) : (
          <><Check className="w-3 h-3" /><span>Saved</span></>
        )}
      </div>

      {/* ── Floating action dock ── */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-2 py-2 bg-white/90 dark:bg-slate-900/60 backdrop-blur-md rounded-md shadow-lg border border-slate-200 dark:border-white/15">

        {/* Save Workflow */}
        <DockButton
          id="tour-save-btn"
          label="Save Workflow"
          onClick={handleSave}
          disabled={!activeWorkflow || !isDirty || isSaving}
        >
          {isSaving
            ? <Loader2 className="w-4.5 h-4.5 animate-spin" />
            : <CloudUpload className="w-[18px] h-[18px]" />
          }
        </DockButton>

        {/* Divider */}
        <span className="w-px h-5 bg-black/[0.07] dark:bg-white/[0.07] mx-0.5" />

        {/* Run Workflow */}
        <DockButton
          id="tour-trigger-btn"
          label="Run Workflow"
          onClick={handleTrigger}
          disabled={!activeWorkflow || isNew || trigger.isPending}
        >
          {trigger.isPending
            ? <Loader2 className="w-[18px] h-[18px] animate-spin" />
            : <Zap className="w-[18px] h-[18px]" />
          }
        </DockButton>

        {/* Divider */}
        <span className="w-px h-5 bg-black/[0.07] dark:bg-white/[0.07] mx-0.5" />

        {/* Alert List (Notifications) */}
        <DockButton
          label="Alert List"
          onClick={() => setNotificationsOpen(true)}
          disabled={!activeWorkflow}
          active={notifEnabled}
          dot={notifEnabled}
        >
          <BellRing className="w-[18px] h-[18px]" />
        </DockButton>

        {/* Divider */}
        <span className="w-px h-5 bg-black/[0.07] dark:bg-white/[0.07] mx-0.5" />

        {/* Version Logs (History) */}
        <DockButton
          label="Version Logs"
          onClick={() => setVersionHistoryOpen(true)}
          disabled={!activeWorkflow || isNew}
        >
          <GitBranch className="w-[18px] h-[18px]" />
        </DockButton>

      </div>
    </>
  );
}

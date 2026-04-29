import { useState, useEffect, useRef } from 'react';
import {
  X, Bell, BellOff, Plus, Trash2, Loader2, CheckCircle2,
  AlertCircle, Mail, Send, Info, ShieldAlert, CircleCheck, Lock,
  Workflow,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getNotificationSettingsForWorkflow,
  updateWorkflowNotifSettings,
  sendTestEmail,
  type NotificationSettings,
  type WorkflowNotifOverride,
} from '../../api/client';

interface Props {
  open: boolean;
  onClose: () => void;
  workflowId?: string;
  workflowName?: string;
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

const DEFAULT_OVERRIDE: WorkflowNotifOverride = {
  enabled:         false,
  notifyOnFailure: true,
  notifyOnPartial: true,
  notifyOnSuccess: false,
  recipients:      [],
};

export function NotificationSettingsModal({ open, onClose, workflowId, workflowName }: Props) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notification-settings', workflowId],
    queryFn: () => getNotificationSettingsForWorkflow(workflowId!),
    enabled: open && Boolean(workflowId),
    staleTime: 10_000,
  });

  const [local, setLocal] = useState<WorkflowNotifOverride>(DEFAULT_OVERRIDE);
  const [ownerEmail, setOwnerEmail] = useState('');
  const [smtpConfigured, setSmtpConfigured] = useState(false);

  const [newEmail, setNewEmail] = useState('');
  const [newEmailError, setNewEmailError] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [testEmail, setTestEmail] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  useEffect(() => {
    if (!data) return;
    setLocal({ ...DEFAULT_OVERRIDE, ...data.workflowOverride });
    setOwnerEmail(data.ownerEmail ?? '');
    setSmtpConfigured(data.smtpConfigured ?? false);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (override: WorkflowNotifOverride) =>
      updateWorkflowNotifSettings(workflowId!, override),
    onSuccess: (updated: NotificationSettings) => {
      queryClient.setQueryData(['notification-settings', workflowId], updated);
      setLocal({ ...DEFAULT_OVERRIDE, ...updated.workflowOverride });
      setSaveStatus('saved');
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2500);
    },
    onError: () => setSaveStatus('idle'),
  });

  function handleSave() {
    setSaveStatus('saving');
    saveMutation.mutate(local);
  }

  function addRecipient() {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    if (!email.includes('@') || !email.includes('.')) {
      setNewEmailError('Please enter a valid email address.');
      return;
    }
    if (local.recipients.includes(email)) {
      setNewEmailError('This address is already in the list.');
      return;
    }
    setNewEmailError('');
    setLocal((prev) => ({ ...prev, recipients: [...prev.recipients, email] }));
    setNewEmail('');
  }

  function removeRecipient(email: string) {
    if (email === ownerEmail) return;
    setLocal((prev) => ({ ...prev, recipients: prev.recipients.filter((e) => e !== email) }));
  }

  async function handleSendTest() {
    const target = testEmail.trim() || ownerEmail;
    if (!target || !target.includes('@')) {
      setTestMessage('Enter a valid email address to test.');
      setTestStatus('error');
      return;
    }
    setTestStatus('sending');
    try {
      await sendTestEmail(target);
      setTestStatus('sent');
      setTestMessage(`Test email sent to ${target}`);
    } catch (err) {
      setTestStatus('error');
      setTestMessage(err instanceof Error ? err.message : 'Failed to send test email.');
    }
    setTimeout(() => { setTestStatus('idle'); setTestMessage(''); }, 5000);
  }

  if (!open) return null;

  const additionalRecipients = local.recipients.filter((e) => e !== ownerEmail);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-white dark:bg-[#1a2236] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col max-h-[90vh] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >

        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-slate-700/60 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-500/15 flex items-center justify-center">
            <Bell className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white leading-tight">
              Email Notifications
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {workflowName
                ? <span className="flex items-center gap-1"><Workflow className="w-3 h-3" />{workflowName}</span>
                : 'Configure notifications for this workflow'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* No workflow open */}
          {!workflowId ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
              <Workflow className="w-8 h-8 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Open a workflow to configure its notifications.
              </p>
            </div>

          ) : isLoading || !data ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>

          ) : (
            <>
              {/* SMTP status */}
              {!smtpConfigured ? (
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">SMTP not configured</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 leading-relaxed">
                      Set{' '}
                      {['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM_ADDRESS'].map((v) => (
                        <code key={v} className="bg-amber-100 dark:bg-amber-500/20 px-1 py-0.5 rounded text-[11px] mx-0.5">{v}</code>
                      ))}{' '}
                      in your <code className="bg-amber-100 dark:bg-amber-500/20 px-1 py-0.5 rounded text-[11px]">.env</code>.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <p className="text-sm text-emerald-800 dark:text-emerald-300 font-medium">
                    SMTP service account configured and ready
                  </p>
                </div>
              )}

              {/* Master toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                <div className="flex items-center gap-3">
                  {local.enabled
                    ? <Bell className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    : <BellOff className="w-4 h-4 text-slate-400" />
                  }
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-white">
                      {local.enabled ? 'Notifications enabled' : 'Notifications disabled'}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Master switch for this workflow's email alerts
                    </p>
                  </div>
                </div>
                <Toggle
                  checked={local.enabled}
                  onChange={(v) => setLocal((p) => ({ ...p, enabled: v }))}
                />
              </div>

              {/* Alert conditions */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Alert conditions
                </p>

                <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                  <div className="flex items-center gap-2.5">
                    <ShieldAlert className="w-4 h-4 text-red-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-800 dark:text-white">Full failure</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">All nodes or the runner crashed</p>
                    </div>
                  </div>
                  <Toggle
                    checked={local.notifyOnFailure}
                    onChange={(v) => setLocal((p) => ({ ...p, notifyOnFailure: v }))}
                    disabled={!local.enabled}
                  />
                </div>

                <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                  <div className="flex items-center gap-2.5">
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-800 dark:text-white">Partial failure</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Some nodes failed, others succeeded</p>
                    </div>
                  </div>
                  <Toggle
                    checked={local.notifyOnPartial}
                    onChange={(v) => setLocal((p) => ({ ...p, notifyOnPartial: v }))}
                    disabled={!local.enabled}
                  />
                </div>

                <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10">
                  <div className="flex items-center gap-2.5">
                    <CircleCheck className="w-4 h-4 text-emerald-500" />
                    <div>
                      <p className="text-sm font-medium text-slate-800 dark:text-white">Successful run</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Every node completed without errors</p>
                    </div>
                  </div>
                  <Toggle
                    checked={local.notifyOnSuccess}
                    onChange={(v) => setLocal((p) => ({ ...p, notifyOnSuccess: v }))}
                    disabled={!local.enabled}
                  />
                </div>
              </div>

              {/* Recipients */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Recipients
                  </p>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    {local.recipients.length} address{local.recipients.length !== 1 ? 'es' : ''}
                  </span>
                </div>

                <ul className="space-y-1.5">
                  {/* Owner — always pinned */}
                  {ownerEmail && (
                    <li className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/25">
                      <Mail className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className="flex-1 text-sm text-slate-700 dark:text-slate-200 truncate">{ownerEmail}</span>
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 text-[10px] font-semibold uppercase tracking-wide shrink-0">
                        <Lock className="w-2.5 h-2.5" />
                        You
                      </span>
                    </li>
                  )}

                  {additionalRecipients.length === 0 && (
                    <li className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-50 dark:bg-white/5 border border-dashed border-slate-300 dark:border-white/15 text-slate-400 dark:text-slate-500 text-sm">
                      <Info className="w-4 h-4 shrink-0" />
                      Add teammates, managers, or on-call addresses below.
                    </li>
                  )}

                  {additionalRecipients.map((email) => (
                    <li
                      key={email}
                      className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 group"
                    >
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="flex-1 text-sm text-slate-700 dark:text-slate-200 truncate">{email}</span>
                      <button
                        onClick={() => removeRecipient(email)}
                        className="p-1 rounded text-slate-300 dark:text-slate-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                        title="Remove recipient"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => { setNewEmail(e.target.value); setNewEmailError(''); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRecipient(); } }}
                      placeholder="colleague@company.com"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/15 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    {newEmailError && (
                      <p className="text-xs text-red-500 mt-1">{newEmailError}</p>
                    )}
                  </div>
                  <button
                    onClick={addRecipient}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </button>
                </div>
              </div>

              {/* Test delivery */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Test delivery
                </p>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Send a test email to verify your SMTP settings. Leave blank to use your address.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      placeholder={ownerEmail || 'test@example.com'}
                      className="flex-1 px-3 py-2 text-sm rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/15 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <button
                      onClick={handleSendTest}
                      disabled={!smtpConfigured || testStatus === 'sending'}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-700 dark:bg-slate-600 hover:bg-slate-800 dark:hover:bg-slate-500 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {testStatus === 'sending'
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Send className="w-3.5 h-3.5" />
                      }
                      Test
                    </button>
                  </div>
                  {testMessage && (
                    <div className={`flex items-center gap-2 text-xs ${
                      testStatus === 'sent'
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-500 dark:text-red-400'
                    }`}>
                      {testStatus === 'sent'
                        ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        : <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      }
                      {testMessage}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-slate-700/60 shrink-0 bg-slate-50/50 dark:bg-white/[0.02]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!workflowId || !data || saveStatus === 'saving'}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
          >
            {saveStatus === 'saving' ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />Saving…</>
            ) : saveStatus === 'saved' ? (
              <><CheckCircle2 className="w-3.5 h-3.5" />Saved</>
            ) : (
              'Save settings'
            )}
          </button>
        </div>

      </div>
    </div>
  );
}

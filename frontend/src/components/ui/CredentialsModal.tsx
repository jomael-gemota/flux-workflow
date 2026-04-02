import { useEffect, useState } from 'react';
import { X, Plus, Trash2, Loader2, CheckCircle2, AlertCircle, ExternalLink, Settings, MessageSquare } from 'lucide-react';
import { useCredentialList, useDeleteCredential } from '../../hooks/useCredentials';
import { startGoogleOAuth, checkGoogleConfig, startSlackOAuth, checkSlackConfig, startTeamsOAuth, checkTeamsConfig, startBasecampOAuth, checkBasecampConfig } from '../../api/client';
import { ConfirmModal } from './ConfirmModal';
import type { CredentialSummary } from '../../types/workflow';
import { useQuery } from '@tanstack/react-query';

interface CredentialsModalProps {
  open: boolean;
  onClose: () => void;
}

const GOOGLE_SERVICE_LABELS: Record<string, string> = {
  'https://www.googleapis.com/auth/gmail.send':     'Gmail (send)',
  'https://www.googleapis.com/auth/gmail.readonly': 'Gmail (read)',
  'https://www.googleapis.com/auth/drive':          'Google Drive',
  'https://www.googleapis.com/auth/documents':      'Google Docs',
  'https://www.googleapis.com/auth/spreadsheets':   'Google Sheets',
};

export function CredentialsModal({ open, onClose }: CredentialsModalProps) {
  const { data: credentials = [], isLoading, refetch } = useCredentialList();
  const deleteCredential = useDeleteCredential();
  const { data: googleConfig } = useQuery({
    queryKey: ['google-config'],
    queryFn: checkGoogleConfig,
    enabled: open,
    staleTime: 30_000,
  });
  const { data: slackConfig } = useQuery({
    queryKey: ['slack-config'],
    queryFn: checkSlackConfig,
    enabled: open,
    staleTime: 30_000,
  });
  const { data: teamsConfig } = useQuery({
    queryKey: ['teams-config'],
    queryFn: checkTeamsConfig,
    enabled: open,
    staleTime: 30_000,
  });
  const { data: basecampConfig } = useQuery({
    queryKey: ['basecamp-config'],
    queryFn: checkBasecampConfig,
    enabled: open,
    staleTime: 30_000,
  });

  const isGoogleConfigured   = googleConfig?.configured   ?? true;
  const isSlackConfigured    = slackConfig?.configured    ?? true;
  const isTeamsConfigured    = teamsConfig?.configured    ?? true;
  const isBasecampConfigured = basecampConfig?.configured ?? true;

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [oauthStatus, setOAuthStatus] = useState<'success' | 'error' | null>(null);
  const [oauthMessage, setOauthMessage] = useState('');

  // Detect OAuth redirect result in URL params
  useEffect(() => {
    if (!open) return;
    const params = new URLSearchParams(window.location.search);
    if (params.has('oauth_success')) {
      const provider = params.get('oauth_success');
      setOAuthStatus('success');
      setOauthMessage(
        provider === 'slack'
          ? 'Slack workspace connected successfully!'
          : provider === 'teams'
          ? 'Microsoft Teams account connected successfully!'
          : provider === 'basecamp'
          ? 'Basecamp account connected successfully!'
          : 'Google account connected successfully!'
      );
      const clean = window.location.pathname;
      window.history.replaceState({}, '', clean);
      refetch();
    } else if (params.has('oauth_error')) {
      setOAuthStatus('error');
      setOauthMessage(decodeURIComponent(params.get('oauth_error') ?? 'Unknown error'));
      const clean = window.location.pathname;
      window.history.replaceState({}, '', clean);
    }
  }, [open, refetch]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const pendingCred = credentials.find((c) => c.id === pendingDeleteId);
  const googleCreds   = credentials.filter((c) => c.provider === 'google');
  const slackCreds    = credentials.filter((c) => c.provider === 'slack');
  const teamsCreds    = credentials.filter((c) => c.provider === 'teams');
  const basecampCreds = credentials.filter((c) => c.provider === 'basecamp');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-[1px]" onClick={onClose} />

      <div className="relative bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Connected Accounts</h2>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
              Manage credentials for Google Workspace, Slack, Microsoft Teams, and Basecamp integrations.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-gray-900 dark:hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* OAuth status banner */}
        {oauthStatus && (
          <div
            className={`flex items-center gap-2 px-5 py-2.5 text-xs shrink-0 ${
              oauthStatus === 'success'
                ? 'bg-emerald-500/15 border-b border-emerald-500/30 text-emerald-600 dark:text-emerald-300'
                : 'bg-red-500/15 border-b border-red-500/30 text-red-600 dark:text-red-300'
            }`}
          >
            {oauthStatus === 'success'
              ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              : <AlertCircle  className="w-3.5 h-3.5 shrink-0" />
            }
            <span>{oauthMessage}</span>
            <button
              onClick={() => setOAuthStatus(null)}
              className="ml-auto text-current opacity-60 hover:opacity-100"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Credential list */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
          {isLoading && (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 text-slate-400 dark:text-slate-500 animate-spin" />
            </div>
          )}

          {/* ── Google section ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GoogleIcon className="w-4 h-4" />
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Google Workspace</span>
              </div>
              {isGoogleConfigured ? (
                <button
                  onClick={startGoogleOAuth}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium rounded-lg transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Connect Account
                </button>
              ) : (
                <span className="text-[10px] text-amber-500 dark:text-amber-400 flex items-center gap-1">
                  <Settings className="w-3 h-3" />
                  Not configured
                </span>
              )}
            </div>

            {!isGoogleConfigured && (
              <div className="flex items-start gap-2.5 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg">
                <Settings className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <p className="text-[11px] text-amber-600 dark:text-amber-400/80 leading-relaxed">
                    Add these to your <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">.env</code> file and restart the backend:
                  </p>
                  <pre className="text-[10px] text-amber-700 dark:text-amber-300/90 bg-slate-100 dark:bg-slate-900 rounded p-2 mt-1.5 leading-relaxed overflow-x-auto">
{`GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth/google/callback`}
                  </pre>
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Get credentials from Google Cloud Console
                  </a>
                </div>
              </div>
            )}

            {!isLoading && googleCreds.length === 0 && isGoogleConfigured && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 pl-1">No Google accounts connected yet.</p>
            )}
            {googleCreds.map((cred) => (
              <CredentialRow key={cred.id} cred={cred} onDelete={() => setPendingDeleteId(cred.id)} />
            ))}
          </div>

          {/* ── Divider ── */}
          <div className="border-t border-slate-200 dark:border-slate-700" />

          {/* ── Slack section ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-violet-500 dark:text-violet-400" />
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Slack</span>
              </div>
              {isSlackConfigured ? (
                <button
                  onClick={startSlackOAuth}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-medium rounded-lg transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Connect Workspace
                </button>
              ) : (
                <span className="text-[10px] text-amber-500 dark:text-amber-400 flex items-center gap-1">
                  <Settings className="w-3 h-3" />
                  Not configured
                </span>
              )}
            </div>

            {!isSlackConfigured && (
              <div className="flex items-start gap-2.5 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg">
                <Settings className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <p className="text-[11px] text-amber-600 dark:text-amber-400/80 leading-relaxed">
                    Add these to your <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">.env</code> file and restart the backend:
                  </p>
                  <pre className="text-[10px] text-amber-700 dark:text-amber-300/90 bg-slate-100 dark:bg-slate-900 rounded p-2 mt-1.5 leading-relaxed overflow-x-auto">
{`SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-secret
SLACK_REDIRECT_URI=http://localhost:3000/oauth/slack/callback`}
                  </pre>
                  <a
                    href="https://api.slack.com/apps"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Create a Slack app at api.slack.com/apps
                  </a>
                </div>
              </div>
            )}

            {!isLoading && slackCreds.length === 0 && isSlackConfigured && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 pl-1">No Slack workspaces connected yet.</p>
            )}
            {slackCreds.map((cred) => (
              <CredentialRow key={cred.id} cred={cred} onDelete={() => setPendingDeleteId(cred.id)} />
            ))}
          </div>

          {/* ── Divider ── */}
          <div className="border-t border-slate-200 dark:border-slate-700" />

          {/* ── Microsoft Teams section ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img src="/logos/ms-teams.png" alt="Microsoft Teams" className="w-4 h-4 object-contain" />
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Microsoft Teams</span>
              </div>
              {isTeamsConfigured ? (
                <button
                  onClick={startTeamsOAuth}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 text-white text-[11px] font-medium rounded-lg transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Connect Account
                </button>
              ) : (
                <span className="text-[10px] text-amber-500 dark:text-amber-400 flex items-center gap-1">
                  <Settings className="w-3 h-3" />
                  Not configured
                </span>
              )}
            </div>

            {!isTeamsConfigured && (
              <div className="flex items-start gap-2.5 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg">
                <Settings className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <p className="text-[11px] text-amber-600 dark:text-amber-400/80 leading-relaxed">
                    Add these to your <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">.env</code> file and restart the backend:
                  </p>
                  <pre className="text-[10px] text-amber-700 dark:text-amber-300/90 bg-slate-100 dark:bg-slate-900 rounded p-2 mt-1.5 leading-relaxed overflow-x-auto">
{`TEAMS_CLIENT_ID=your-client-id
TEAMS_CLIENT_SECRET=your-secret
TEAMS_TENANT_ID=common
TEAMS_REDIRECT_URI=http://localhost:3000/api/oauth/teams/callback`}
                  </pre>
                  <a
                    href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Register an app in Azure portal
                  </a>
                </div>
              </div>
            )}

            {!isLoading && teamsCreds.length === 0 && isTeamsConfigured && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 pl-1">No Microsoft accounts connected yet.</p>
            )}
            {teamsCreds.map((cred) => (
              <CredentialRow key={cred.id} cred={cred} onDelete={() => setPendingDeleteId(cred.id)} />
            ))}
          </div>

          {/* ── Divider ── */}
          <div className="border-t border-slate-200 dark:border-slate-700" />

          {/* ── Basecamp section ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <img src="/logos/basecamp.png" alt="Basecamp" className="w-4 h-4 object-contain" />
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Basecamp</span>
              </div>
              {isBasecampConfigured ? (
                <button
                  onClick={startBasecampOAuth}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-700 hover:bg-green-600 text-white text-[11px] font-medium rounded-lg transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  Connect Account
                </button>
              ) : (
                <span className="text-[10px] text-amber-500 dark:text-amber-400 flex items-center gap-1">
                  <Settings className="w-3 h-3" />
                  Not configured
                </span>
              )}
            </div>

            {!isBasecampConfigured && (
              <div className="flex items-start gap-2.5 p-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg">
                <Settings className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <p className="text-[11px] text-amber-600 dark:text-amber-400/80 leading-relaxed">
                    Add these to your <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded">.env</code> file and restart the backend:
                  </p>
                  <pre className="text-[10px] text-amber-700 dark:text-amber-300/90 bg-slate-100 dark:bg-slate-900 rounded p-2 mt-1.5 leading-relaxed overflow-x-auto">
{`BASECAMP_CLIENT_ID=your-client-id
BASECAMP_CLIENT_SECRET=your-secret`}
                  </pre>
                  <a
                    href="https://launchpad.37signals.com/integrations"
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Register your app at launchpad.37signals.com
                  </a>
                </div>
              </div>
            )}

            {!isLoading && basecampCreds.length === 0 && isBasecampConfigured && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 pl-1">No Basecamp accounts connected yet.</p>
            )}
            {basecampCreds.map((cred) => (
              <CredentialRow key={cred.id} cred={cred} onDelete={() => setPendingDeleteId(cred.id)} />
            ))}
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      <ConfirmModal
        open={pendingDeleteId !== null}
        title="Disconnect account?"
        message={`Remove "${pendingCred?.label ?? pendingCred?.email ?? ''}" from connected accounts? Any workflow nodes using this credential will stop working.`}
        confirmLabel="Disconnect"
        danger
        isLoading={deleteCredential.isPending}
        onConfirm={async () => {
          if (!pendingDeleteId) return;
          await deleteCredential.mutateAsync(pendingDeleteId);
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}

function CredentialRow({ cred, onDelete }: { cred: CredentialSummary; onDelete: () => void }) {
  const isSlack    = cred.provider === 'slack';
  const isTeams    = cred.provider === 'teams';
  const isGoogle   = cred.provider === 'google';
  const isBasecamp = cred.provider === 'basecamp';
  const serviceLabels = isGoogle
    ? cred.scopes.map((s) => GOOGLE_SERVICE_LABELS[s]).filter(Boolean)
    : [];
  const displayName = isGoogle ? cred.email : cred.label;

  return (
    <div className="flex items-start gap-3 bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600/40 rounded-lg px-3.5 py-3">
      {isSlack
        ? <MessageSquare className="w-5 h-5 text-violet-500 dark:text-violet-400 shrink-0 mt-0.5" />
        : isTeams
        ? <img src="/logos/ms-teams.png" alt="Microsoft Teams" className="w-5 h-5 object-contain shrink-0 mt-0.5" />
        : isBasecamp
        ? <img src="/logos/basecamp.png" alt="Basecamp" className="w-5 h-5 object-contain shrink-0 mt-0.5" />
        : <GoogleIcon className="w-5 h-5 shrink-0 mt-0.5" />
      }
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{displayName}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
          {isGoogle && cred.label !== cred.email ? `Label: ${cred.label} · ` : ''}
          Connected {new Date(cred.createdAt).toLocaleDateString()}
        </p>
        {serviceLabels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {serviceLabels.map((label) => (
              <span key={label} className="text-[10px] px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded">
                {label}
              </span>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={onDelete}
        className="text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 transition-colors shrink-0 p-0.5"
        title="Disconnect"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// Simple inline Google "G" icon
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, CheckCircle2, AlertCircle, Loader2, Trash2, Info, ChevronDown, ChevronRight } from 'lucide-react';
import { useBasecampHelperExtension } from '../../hooks/useBasecampHelperExtension';
import { downloadBasecampExtensionZip, syncBasecampSession, clearBasecampSession } from '../../api/client';
import type { CredentialSummary } from '../../types/workflow';

interface BasecampSessionSyncProps {
    cred: CredentialSummary;
}

/**
 * Three-step Adminland-purge enabler attached to each Basecamp credential.
 *
 *   1. Download the helper extension (a ZIP, manifest pre-tied to this origin).
 *   2. User unpacks it and loads it into chrome://extensions.
 *   3. Click "Sync Basecamp Session" — page asks the extension for cookies,
 *      relays them to the backend, which validates against Launchpad and
 *      stores them encrypted on the credential.
 *
 * Rendered inside `<CredentialRow>` for `provider === 'basecamp'` rows.
 * Self-contained: no callbacks back into the parent — query invalidation
 * happens via the React Query cache.
 */
export function BasecampSessionSync({ cred }: BasecampSessionSyncProps) {
    const qc = useQueryClient();
    const helper = useBasecampHelperExtension();

    const [isExpanded,    setExpanded]     = useState(false);
    const [isDownloading, setDownloading]  = useState(false);
    const [isSyncing,     setSyncing]      = useState(false);
    const [isClearing,    setClearing]     = useState(false);
    const [syncError,     setSyncError]    = useState<string | null>(null);
    const [syncOk,        setSyncOk]       = useState<string | null>(null);

    const session = cred.basecampWebSession;
    const sessionExpired = session ? session.expiresAt < Date.now() : false;
    const sessionDaysLeft = session
        ? Math.max(0, Math.round((session.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
        : null;

    const handleDownload = async () => {
        setDownloading(true);
        try {
            const blob = await downloadBasecampExtensionZip();
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = 'wfp-basecamp-helper.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            setSyncError((err as Error).message);
        } finally {
            setDownloading(false);
        }
    };

    const handleSync = async () => {
        setSyncing(true);
        setSyncError(null);
        setSyncOk(null);
        try {
            const cookies = await helper.fetchCookies();
            const result  = await syncBasecampSession(cred.id, cookies);
            setSyncOk(`Synced as ${result.identity}.`);
            qc.invalidateQueries({ queryKey: ['credentials'] });
        } catch (err) {
            setSyncError((err as Error).message);
        } finally {
            setSyncing(false);
        }
    };

    const handleClear = async () => {
        setClearing(true);
        try {
            await clearBasecampSession(cred.id);
            setSyncOk(null);
            qc.invalidateQueries({ queryKey: ['credentials'] });
        } catch (err) {
            setSyncError((err as Error).message);
        } finally {
            setClearing(false);
        }
    };

    // Compact one-line status row. Expand for the full 3-step flow.
    const statusBadge = (() => {
        if (session && !sessionExpired) {
            return (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                    <CheckCircle2 className="w-3 h-3" />
                    Adminland enabled · {sessionDaysLeft}d left
                </span>
            );
        }
        if (session && sessionExpired) {
            return (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                    <AlertCircle className="w-3 h-3" />
                    Session expired
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-300/30 text-slate-600 dark:text-slate-400 border border-slate-400/30">
                <Info className="w-3 h-3" />
                Adminland purge not enabled
            </span>
        );
    })();

    return (
        <div className="mt-2 border-t border-slate-200 dark:border-slate-600/40 pt-2">
            <button
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center justify-between gap-2 w-full text-left text-[11px] text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                aria-expanded={isExpanded}
            >
                <span className="flex items-center gap-2 font-medium">
                    {isExpanded
                        ? <ChevronDown  className="w-3 h-3" />
                        : <ChevronRight className="w-3 h-3" />
                    }
                    Adminland purge (browser-extension session)
                </span>
                {statusBadge}
            </button>

            {isExpanded && (
                <div className="mt-2 space-y-3">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        Basecamp's public API can revoke a user's project access but cannot remove
                        them from <strong>Adminland → People</strong>. To enable full removal, sync
                        a browser session via the companion extension. Cookies are stored encrypted
                        and used only for the Adminland purge step.
                    </p>

                    {session && !sessionExpired && (
                        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-[11px] text-emerald-800 dark:text-emerald-200">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                                <p>Synced as <strong>{session.identity}</strong></p>
                                <p className="text-emerald-700/80 dark:text-emerald-300/80 mt-0.5">
                                    {session.cookieCount} cookies · valid through {new Date(session.expiresAt).toLocaleString()}
                                </p>
                            </div>
                            <button
                                onClick={handleClear}
                                disabled={isClearing}
                                title="Clear stored session"
                                className="text-emerald-700/70 dark:text-emerald-300/70 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                            >
                                {isClearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                        </div>
                    )}

                    {/* Step 1: Download */}
                    <Step
                        n={1}
                        title="Download the browser extension"
                        body={
                            <button
                                onClick={handleDownload}
                                disabled={isDownloading}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md bg-slate-700 hover:bg-slate-600 text-white transition-colors disabled:opacity-50"
                            >
                                {isDownloading
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : <Download className="w-3 h-3" />
                                }
                                Download wfp-basecamp-helper.zip
                            </button>
                        }
                    />

                    {/* Step 2: Install */}
                    <Step
                        n={2}
                        title="Unpack and load into Chrome / Edge / Brave"
                        body={
                            <ol className="text-[11px] text-slate-600 dark:text-slate-400 list-decimal pl-4 space-y-0.5">
                                <li>Unzip <code className="bg-slate-200/60 dark:bg-slate-700 px-1 rounded">wfp-basecamp-helper.zip</code> to a stable folder.</li>
                                <li>Open <code className="bg-slate-200/60 dark:bg-slate-700 px-1 rounded">chrome://extensions</code> and enable <strong>Developer mode</strong>.</li>
                                <li>Click <strong>Load unpacked</strong> and select the unzipped folder.</li>
                                <li>Make sure you are signed into Basecamp in the same browser profile.</li>
                            </ol>
                        }
                    />

                    {/* Step 3: Sync */}
                    <Step
                        n={3}
                        title="Sync your Basecamp session"
                        body={
                            <div className="space-y-1.5">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={handleSync}
                                        disabled={helper.status !== 'detected' || isSyncing}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50 disabled:bg-slate-400 disabled:hover:bg-slate-400"
                                    >
                                        {isSyncing
                                            ? <Loader2 className="w-3 h-3 animate-spin" />
                                            : <RefreshCw className="w-3 h-3" />
                                        }
                                        {session ? 'Re-sync session' : 'Sync Basecamp session'}
                                    </button>
                                    <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                        Extension:{' '}
                                        {helper.status === 'detected' && (
                                            <span className="text-emerald-600 dark:text-emerald-400">
                                                detected{helper.extensionVersion ? ` (v${helper.extensionVersion})` : ''}
                                            </span>
                                        )}
                                        {helper.status === 'not_detected' && (
                                            <span className="text-amber-600 dark:text-amber-400">
                                                not detected.{' '}
                                                <button onClick={helper.recheck} className="underline hover:no-underline">
                                                    Re-check
                                                </button>
                                            </span>
                                        )}
                                        {helper.status === 'unknown' && (
                                            <span className="text-slate-400 dark:text-slate-500">checking…</span>
                                        )}
                                    </span>
                                </div>

                                {syncError && (
                                    <div className="flex items-start gap-1.5 p-2 rounded bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-[11px] text-red-700 dark:text-red-300">
                                        <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                                        <span>{syncError}</span>
                                    </div>
                                )}
                                {syncOk && !syncError && (
                                    <div className="flex items-start gap-1.5 p-2 rounded bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-[11px] text-emerald-700 dark:text-emerald-300">
                                        <CheckCircle2 className="w-3 h-3 shrink-0 mt-0.5" />
                                        <span>{syncOk}</span>
                                    </div>
                                )}
                            </div>
                        }
                    />
                </div>
            )}
        </div>
    );
}

function Step({ n, title, body }: { n: number; title: string; body: React.ReactNode }) {
    return (
        <div className="flex gap-2.5">
            <div className="shrink-0 w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-semibold flex items-center justify-center">
                {n}
            </div>
            <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-[11px] font-medium text-slate-700 dark:text-slate-200">{title}</p>
                {body}
            </div>
        </div>
    );
}

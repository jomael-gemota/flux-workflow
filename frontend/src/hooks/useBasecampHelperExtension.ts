import { useCallback, useEffect, useRef, useState } from 'react';
import type { BasecampWebCookie } from '../api/client';

/**
 * Page-side counterpart of the companion browser extension's content script.
 *
 * The credentials page (which lives on this app's origin) cannot read
 * Basecamp's cookies directly — they belong to a different origin. The
 * extension's content script bridges the gap by relaying `window.postMessage`
 * requests from this page to its own service worker, which has the
 * `cookies` permission.
 *
 * Wire protocol (must stay in lock-step with `extension/content_script.js`):
 *
 *   page  → script:  { source: 'wfp-bc-page',   requestId, action }
 *   script → page:   { source: 'wfp-bc-helper', requestId, ok, ...payload }
 *
 * The script also fires an unsolicited
 *   { source: 'wfp-bc-helper', action: 'ready' }
 * once on every page load. We use that — plus a short proactive `ping` when
 * the hook mounts — as the install-detection signal.
 */

const PAGE_SOURCE   = 'wfp-bc-page';
const HELPER_SOURCE = 'wfp-bc-helper';
const REQUEST_TIMEOUT_MS = 4000;

interface PendingRequest {
    resolve: (data: Record<string, unknown>) => void;
    reject:  (err: Error) => void;
    timer:   ReturnType<typeof setTimeout>;
}

type DetectionState = 'unknown' | 'detected' | 'not_detected';

function newRequestId(): string {
    // Cryptographically-random IDs are unnecessary here — collisions would
    // only delay one request by REQUEST_TIMEOUT_MS — so a timestamp-prefixed
    // monotonic counter is fine and keeps this hook dependency-free.
    return `wfp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface UseBasecampHelperExtension {
    /**
     * 'unknown' on mount, then either 'detected' (extension answered ping
     * or fired 'ready') or 'not_detected' (no signal within the detection
     * window).
     */
    status: DetectionState;
    /** Extension version string when known. Useful for support / bug reports. */
    extensionVersion: string | null;
    /** Force a fresh ping — call this from a "Re-check" button. */
    recheck: () => void;
    /**
     * Ask the extension for the current Basecamp cookie bag. Resolves with
     * an array of cookies, or rejects when the extension is missing /
     * unresponsive.
     */
    fetchCookies: () => Promise<BasecampWebCookie[]>;
}

export function useBasecampHelperExtension(): UseBasecampHelperExtension {
    const [status,           setStatus]           = useState<DetectionState>('unknown');
    const [extensionVersion, setExtensionVersion] = useState<string | null>(null);

    // Map of requestId → pending promise. Ref so listener changes don't
    // re-create it on every render.
    const pending = useRef<Map<string, PendingRequest>>(new Map());

    // Counter to ignore stale ping replies after a re-check.
    const pingNonce = useRef(0);

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            // Only accept same-origin, same-window messages.
            if (event.source !== window) return;
            const data = event.data as Record<string, unknown> | null;
            if (!data || typeof data !== 'object')   return;
            if (data.source !== HELPER_SOURCE)        return;

            // Unsolicited 'ready' broadcast on extension load.
            if (data.action === 'ready') {
                setStatus('detected');
                if (typeof data.version === 'string') setExtensionVersion(data.version);
                return;
            }

            // Correlated reply to an outgoing request.
            const requestId = typeof data.requestId === 'string' ? data.requestId : null;
            if (!requestId) return;
            const entry = pending.current.get(requestId);
            if (!entry) return;
            pending.current.delete(requestId);
            clearTimeout(entry.timer);
            entry.resolve(data);
        };

        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);

    const sendRequest = useCallback(<T extends Record<string, unknown>>(action: 'ping' | 'getBasecampCookies'): Promise<T> => {
        return new Promise<T>((resolve, reject) => {
            const requestId = newRequestId();
            const timer = setTimeout(() => {
                if (pending.current.has(requestId)) {
                    pending.current.delete(requestId);
                    reject(new Error('Extension did not respond. Make sure it is installed and enabled in chrome://extensions.'));
                }
            }, REQUEST_TIMEOUT_MS);

            pending.current.set(requestId, {
                resolve: (data) => resolve(data as T),
                reject,
                timer,
            });

            try {
                window.postMessage({ source: PAGE_SOURCE, requestId, action }, window.location.origin);
            } catch (err) {
                clearTimeout(timer);
                pending.current.delete(requestId);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }, []);

    /**
     * Probe the extension once on mount. We don't trust the absence of a
     * 'ready' broadcast alone (it might fire before our listener attaches),
     * so we always proactively ping and use the timeout to flip status to
     * 'not_detected' when no answer arrives.
     */
    useEffect(() => {
        const myNonce = ++pingNonce.current;
        sendRequest<{ ok: boolean; version?: string }>('ping')
            .then((res) => {
                if (myNonce !== pingNonce.current) return; // stale
                if (res.ok) {
                    setStatus('detected');
                    if (typeof res.version === 'string') setExtensionVersion(res.version);
                }
            })
            .catch(() => {
                if (myNonce !== pingNonce.current) return;
                // Don't stomp on a 'detected' state set by an earlier 'ready' broadcast.
                setStatus((prev) => (prev === 'detected' ? prev : 'not_detected'));
            });
    }, [sendRequest]);

    const recheck = useCallback(() => {
        setStatus('unknown');
        const myNonce = ++pingNonce.current;
        sendRequest<{ ok: boolean; version?: string }>('ping')
            .then((res) => {
                if (myNonce !== pingNonce.current) return;
                if (res.ok) {
                    setStatus('detected');
                    if (typeof res.version === 'string') setExtensionVersion(res.version);
                } else {
                    setStatus('not_detected');
                }
            })
            .catch(() => {
                if (myNonce !== pingNonce.current) return;
                setStatus('not_detected');
            });
    }, [sendRequest]);

    const fetchCookies = useCallback(async () => {
        const res = await sendRequest<{ ok: boolean; cookies?: BasecampWebCookie[]; error?: string }>('getBasecampCookies');
        if (!res.ok) {
            throw new Error(res.error ?? 'Extension refused to read cookies.');
        }
        if (!Array.isArray(res.cookies)) {
            throw new Error('Extension returned an invalid cookie payload.');
        }
        return res.cookies;
    }, [sendRequest]);

    return { status, extensionVersion, recheck, fetchCookies };
}

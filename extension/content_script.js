/* eslint-disable no-undef */
/**
 * Workflow Platform — Basecamp Helper · content script
 *
 * Runs on the host platform's credentials page and acts as the only bridge
 * between page-context JavaScript (which cannot read cookies for other
 * origins) and the extension's privileged service worker (which can).
 *
 * Protocol (window.postMessage):
 *
 *   page  → script:  { source: 'wfp-bc-page', requestId, action: 'ping' | 'getBasecampCookies' }
 *   script → page:   { source: 'wfp-bc-helper', requestId, ok: boolean, ...payload }
 *
 * The script also fires an unsolicited
 *   { source: 'wfp-bc-helper', action: 'ready', version }
 * once on load, so the page can flip its UI from "Extension not detected" to
 * "Extension installed" without polling.
 *
 * `requestId` is echoed verbatim so the page can correlate concurrent
 * requests; treat any message without a matching id as unrelated noise.
 */

const PAGE_SOURCE      = 'wfp-bc-page';
const HELPER_SOURCE    = 'wfp-bc-helper';
const ALLOWED_ACTIONS  = new Set(['ping', 'getBasecampCookies']);

function announceReady() {
    try {
        window.postMessage({
            source:  HELPER_SOURCE,
            action:  'ready',
            version: chrome.runtime.getManifest().version,
        }, window.location.origin);
    } catch {
        // Page closed mid-load; nothing to do.
    }
}

window.addEventListener('message', (event) => {
    // Same-frame, same-origin messages only. postMessage is broadcast by
    // default; ignore anything we didn't originate from the page itself.
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== 'object')  return;
    if (data.source  !== PAGE_SOURCE)        return;
    if (!ALLOWED_ACTIONS.has(data.action))   return;

    const { requestId, action } = data;

    chrome.runtime.sendMessage({ action }, (response) => {
        const err = chrome.runtime.lastError;
        const reply = err
            ? { ok: false, error: err.message ?? String(err) }
            : (response ?? { ok: false, error: 'no response' });

        window.postMessage(
            { source: HELPER_SOURCE, requestId, ...reply },
            window.location.origin,
        );
    });
});

// Announce on load (and again on every navigation in SPA host pages —
// load fires once, but document_idle scripts re-inject on hard nav).
announceReady();

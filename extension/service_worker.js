/* eslint-disable no-undef */
/**
 * Workflow Platform — Basecamp Helper
 * MV3 service worker.
 *
 * Reads Basecamp web-session cookies from the browser cookie jar and forwards
 * them to the host platform's credentials page on demand. The host page never
 * has direct cookie access (cross-origin), so this extension is the bridge.
 *
 * Two communication paths are supported:
 *   1. Direct  — chrome.runtime.sendMessage(extensionId, {...})
 *      Used when the page knows the extension ID. Faster, single hop.
 *   2. Forwarded — content script relays via window.postMessage
 *      Used when the page doesn't know the extension ID. The content script
 *      injected on the host origin is the only thing both sides can address.
 *
 * Cookies returned cover both `*.basecamp.com` (the web app session) and
 * `*.37signals.com` (Launchpad SSO). The platform stores them encrypted and
 * uses them only for the Basecamp Adminland-removal step that has no
 * REST-API equivalent.
 */

const COOKIE_DOMAINS = ['basecamp.com', '37signals.com'];

async function readBasecampCookies() {
    const buckets = await Promise.all(
        COOKIE_DOMAINS.map((d) => chrome.cookies.getAll({ domain: d }))
    );
    const cookies = buckets.flat().map((c) => ({
        name:           c.name,
        value:          c.value,
        domain:         c.domain,
        path:           c.path,
        secure:         c.secure,
        httpOnly:       c.httpOnly,
        sameSite:       c.sameSite,
        expirationDate: c.expirationDate ?? null,
    }));
    return cookies;
}

function handleMessage(message, _sender, sendResponse) {
    if (!message || typeof message !== 'object') {
        sendResponse({ ok: false, error: 'invalid message' });
        return false;
    }
    if (message.action === 'ping') {
        sendResponse({
            ok:        true,
            version:   chrome.runtime.getManifest().version,
            extension: chrome.runtime.getManifest().name,
        });
        return false;
    }
    if (message.action === 'getBasecampCookies') {
        readBasecampCookies()
            .then((cookies) => sendResponse({ ok: true, cookies }))
            .catch((err)    => sendResponse({ ok: false, error: String(err?.message ?? err) }));
        return true; // keep the message channel open for the async response
    }
    sendResponse({ ok: false, error: `unknown action: ${message.action}` });
    return false;
}

// External: from the host platform via runtime.sendMessage(extensionId, ...)
chrome.runtime.onMessageExternal.addListener(handleMessage);

// Internal: from our content script (which relays window.postMessage)
chrome.runtime.onMessage.addListener(handleMessage);

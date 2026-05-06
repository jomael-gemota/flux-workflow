# Workflow Platform — Basecamp Helper

A tiny browser extension that lets the Workflow Automation Platform read your
Basecamp web-session cookies on demand. The platform uses these cookies for one
specific job: **completing admin actions like "Remove user from Adminland" that
have no equivalent in the public Basecamp REST API.**

The extension does **not**:

- Read or transmit any cookies that aren't for `*.basecamp.com` or `*.37signals.com`.
- Talk to any server other than the Workflow Platform that issued this download.
- Run on any page other than the platform's own credentials page (`__HOST_DISPLAY__`).
- Make outbound network requests on its own — it only responds when the
  credentials page asks for cookies.

## Install (Chrome / Edge / Brave / Arc / Opera)

1. **Unpack the ZIP** to a folder somewhere stable on your computer
   (e.g. `~/wfp-basecamp-helper`). Don't delete the folder later — Chrome reads
   from this location every time it loads the extension.
2. Open `chrome://extensions` in your browser (or `edge://extensions`, etc.).
3. Toggle **Developer mode** on (top-right corner).
4. Click **Load unpacked** and select the folder you unzipped.
5. The extension appears in the list. You're done.

## Install (Firefox)

Manifest v3 in Firefox is still gated; this extension targets Chromium browsers.
If you need Firefox support, ask the platform admin.

## Use

1. Sign into Basecamp normally in the same browser profile, at least once.
   (You can close the tab afterwards.)
2. Open the Workflow Automation Platform → **Connected Accounts** → your
   Basecamp credential.
3. Click **Sync Basecamp Session**. The page reads cookies via this extension
   and stores them encrypted on the server. Status flips to ✅ Synced.

## What it does under the hood

- **`service_worker.js`** — listens for `getBasecampCookies` and `ping`
  messages. On `getBasecampCookies` it calls `chrome.cookies.getAll` for the
  two whitelisted domains and returns the result.
- **`content_script.js`** — runs only on the credentials page. Forwards
  `window.postMessage` requests from the page to the service worker, then
  forwards the response back. This is the only way page-context JS (which can't
  read other-origin cookies) and the privileged service worker can talk.

The extension never writes cookies, never modifies pages, never reads page
content. It exists purely so a button on a webpage can read cookies that the
browser's same-origin policy otherwise locks the page out of.

## Updating

Re-download the ZIP from the credentials page, replace the folder contents,
then click the **↻ refresh** icon on the extension's row in `chrome://extensions`.

## Removing

Click **Remove** on the extension's row in `chrome://extensions`. Any
already-synced cookies remain stored on the platform until you click
**Disconnect** on that credential or expressly clear the session there.

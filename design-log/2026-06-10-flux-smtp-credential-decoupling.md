# Decouple Flux SMTP Gmail actions from Google OAuth

**Date:** 2026-06-10
**Status:** accepted
**Author:** collaborative

## Context

The Gmail node exposes two "Flux" actions that send mail through the platform's
shared SMTP service account (`SMTP_*` env vars) rather than a user's connected
Google account:

- `send_flux` — Send via Flux (SMTP)
- `reply_flux` — Reply via Flux (SMTP)

A Pricing Requests workflow using `send_flux` failed with:

> Credential "69d69c926ed986fe4f14bce2" not found. Connect your Google account first.

Root cause: `GmailNode.execute()` resolved a Google OAuth credential
(`getAuthenticatedClient`) at the top of the method for **every** action,
before any action branch ran. So `send_flux` — which never touches the Gmail
API — still failed when the stored `credentialId` was stale/deleted. The config
panel hid the credential picker for `send_flux` but never cleared the
`credentialId` left over from a prior action, so an invalid ID kept being sent
to the backend.

`reply_flux` additionally called `gmail.users.messages.get` to look up the
original message metadata (recipient, subject, threading headers), so it
genuinely required a valid Google credential.

The user wants both Flux actions usable **without** connecting a Google account.

## Decision

1. **Lazy credential resolution.** `execute()` no longer resolves a Google
   credential up front. `send_flux` and `reply_flux` are handled before the
   credential block and never require Google by default. All other actions
   (which use the Gmail API) still require `credentialId` exactly as before.

2. **`send_flux` — fully Google-free.** Uses SMTP only; no credential needed.

3. **`reply_flux` — Google-free by default, with optional Gmail auto-lookup.**
   - Default (no Google): the reply recipient (`to`), optional `cc`, `subject`,
     and an optional original `inReplyToMessageId` (RFC `Message-ID` for
     threading) are supplied directly via config/expressions, then delivered
     via SMTP.
   - Optional convenience: if a Google account **is** connected (`credentialId`
     set) **and** a Gmail `replyToMessageId` is provided, Flux looks up the
     original message via the Gmail API to auto-fill recipient/subject/threading
     and support Reply-All — preserving the previous behavior.

4. **Frontend.** Clear `credentialId` when switching to `send_flux`. For
   `reply_flux`, the Google account picker is optional; manual reply fields are
   shown when no account is connected, and the Gmail message-ID auto-lookup
   fields are shown when one is.

## Alternatives Considered

- **Keep `reply_flux` requiring Google.** Rejected — the user explicitly wants
  reply-via-Flux without a connected account.
- **Remove the Gmail auto-lookup entirely.** Rejected — it would break existing
  `reply_flux` workflows that rely on `replyToMessageId` + Reply-All, and the
  auto-lookup is a genuine convenience when Google is connected. Keeping it as
  an optional path is backward compatible.
- **Pre-validate credentials in `WorkflowRunner`.** Rejected as out of scope;
  the per-action requirement belongs in the node executor.

## Consequences

- `send_flux` works with zero Google setup (SMTP env vars only).
- `reply_flux` works with zero Google setup when reply fields are provided;
  threading (`In-Reply-To`/`References`) is best-effort and depends on the user
  supplying the original `Message-ID`.
- Existing `reply_flux` workflows that connected Google + used `replyToMessageId`
  keep working unchanged.
- Shared SMTP/transport logic is extracted into private helpers on `GmailNode`.

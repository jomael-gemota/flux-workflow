# Credential Connect / Disconnect Email Notifications

**Date:** 2026-06-10
**Status:** accepted
**Author:** collaborative

## Context

Users connect, reconnect, or disconnect integration credentials (Google, Slack,
Microsoft Teams, Basecamp) through the OAuth flow and the Credentials UI. Until
now these lifecycle events were silent — there was no confirmation or audit
trail sent to the account owner.

Related prior work:
- `2026-06-10-google-credential-health-monitoring.md` — established the pattern
  of emailing the credential owner (resolved from `cred.userId` → `UserModel`)
  via platform SMTP using `buildFluxMessageHtml`.
- `2026-06-10-flux-smtp-credential-decoupling.md` — Flux SMTP is independent of
  Google OAuth, so these alerts send even when the affected credential is dead.

## Decision

Add a dedicated `CredentialNotificationService` that sends a Flux-branded email
whenever a credential is **connected**, **reconnected**, or **disconnected**.

Key rules:
- **Owner-only delivery.** The email is sent solely to the workflow/credential
  owner — the platform user resolved from the credential's `userId` via
  `UserModel`. No CC to the provider account, no BCC to other users. If the
  credential has no `userId` (legacy / API-key-created) the notification is
  skipped silently.
- **Three event types:**
  - `connected` — a brand-new credential document is created during an OAuth
    callback.
  - `reconnected` — an existing credential's tokens are refreshed via the OAuth
    callback (re-auth of an already-connected account).
  - `disconnected` — a credential is deleted via `DELETE /api/credentials/:id`.
- **Fire-and-forget.** Sending is wrapped in `.catch()` so a mail failure never
  blocks the OAuth callback redirect or the delete response.
- **Reuses existing infrastructure:** nodemailer + SMTP env vars and
  `buildFluxMessageHtml`, mirroring `CredentialHealthService`.

### Wiring (where each event fires)

| Event | Provider | Fired from |
|-------|----------|------------|
| connected / reconnected | Google | `oauthRoutes` Google callback (create/updateTokens live there) |
| connected / reconnected | Slack / Teams / Basecamp | inside each `*AuthService.handleCallback` (where create/updateTokens live) |
| disconnected | all | `credentialRoutes` `DELETE /credentials/:id` |

The delete route is changed to look up the credential first (owner-scoped),
capture its details, delete it, then notify — so the email can include the
provider/label of the now-removed credential.

## Alternatives Considered

- **Return event metadata from each `handleCallback` and notify centrally in
  `oauthRoutes`.** Cleaner single call site, but Basecamp can create multiple
  credentials in one callback (one per BC3 account) and the auth services
  already hold all the data, so injecting the notifier into the services is
  simpler and handles the multi-credential case naturally.
- **Reuse `EmailNotificationService`.** That service is tightly coupled to
  execution payloads and per-workflow notification settings (which gate
  delivery). Credential events must always notify the owner, so a small
  dedicated service is a better fit.
- **Emit on an event bus.** `ExecutionEventBus` is execution-scoped (SSE);
  introducing a broader event bus is out of scope for this change.

## Consequences

- Owners get a confirmation/audit email on every connect, reconnect, and
  disconnect. This may be chatty for users who reconnect frequently; reconnect
  vs connect is differentiated in the subject/body so it can be filtered.
- Requires SMTP to be configured; when it is not, the service no-ops with a
  warning (same behavior as the other Flux email paths).
- Auth service constructors gain an optional `credentialNotifier` dependency
  (only wired in `index.ts`), so existing callers/tests remain compatible.

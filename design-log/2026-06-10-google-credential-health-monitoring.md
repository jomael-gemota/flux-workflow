# Google Credential Health Monitoring & Reauth Alerts

**Date:** 2026-06-10
**Status:** accepted
**Author:** collaborative

## Context

Users' connected Google accounts (Gmail, Drive, Docs, Sheets) recently stopped
working because their OAuth refresh tokens were revoked (the project's OAuth
app is in production, so the likely causes are password changes on accounts
with Gmail scopes, manual revocation, or Google security sweeps — see
investigation in chat on 2026-06-10).

Two compounding problems were identified:

1. **Silent death.** A revoked refresh token only surfaces when a workflow
   node calls `GoogleAuthService.getAuthenticatedClient()` and the refresh
   throws a raw `invalid_grant` error — i.e. the user finds out when a
   scheduled workflow has already failed.
2. **Stale `credentialId` after delete + reconnect.** Deleting a credential
   and reconnecting creates a new document ID, orphaning every workflow node
   that referenced the old one. (UI guidance to "reconnect, don't delete" was
   added in commit `2412592`.)

Requirement from the user: **no scheduled run may fail** because of an
expired credential, and users must be alerted as early as possible. Refresh
tokens have no predictable expiry date, so prediction is impossible —
the design instead minimizes the detection window and prevents doomed runs.

## Decision

Four layers, all using existing infrastructure (Mongo `Credential` collection,
`setInterval` background jobs in `index.ts`, nodemailer SMTP, Flux email
template):

1. **Credential status field.** `CredentialModel` gains
   `status: 'active' | 'reauth_required'` (default `active`) and
   `lastVerifiedAt` (Unix ms). `CredentialRepository.updateTokens()` always
   resets `status` to `active` — so a successful refresh *or* an OAuth
   reconnect (same upsert path) automatically heals the credential.

2. **Hourly health check with forced token refresh**
   (`CredentialHealthService`, started from `index.ts` like the push-renewal
   cron). Every hour, each Google credential's refresh token is exercised via
   a forced `refreshAccessToken()`:
   - Success → persist new tokens + `lastVerifiedAt`. This exceeds the
     user-requested daily refresh cadence and, as a side effect, regular use
     of the refresh token prevents Google's 6-month-inactivity expiry.
   - `invalid_grant` → mark `reauth_required` and send an alert email
     (via platform SMTP, which does not depend on Google OAuth) to the
     credential owner listing the affected workflows and instructing them to
     reconnect (not delete). Alerts fire only on the `active →
     reauth_required` transition, so no spam.

3. **Graceful `invalid_grant` handling at call time.**
   `getAuthenticatedClient()` wraps its refresh in try/catch: on failure it
   marks the credential `reauth_required` and throws an actionable
   "reconnect your Google account" error instead of the raw Google error.

4. **Pre-flight check for cron-scheduled runs.** `WorkflowScheduler` checks
   the status of every credential referenced by the workflow before
   triggering. If any is `reauth_required`, the run is **skipped** (warn log)
   rather than executed-and-failed. Polling triggers need no change: a failed
   poll does not advance `lastPollAt`, so events occurring during an outage
   are delivered after reconnection.

Frontend: `CredentialSummary` exposes `status`; the Credentials modal shows a
"Reconnect required" badge + reconnect button, and the node `CredentialSelect`
marks dead accounts and renders stale/unknown IDs as "disconnected account"
instead of a silently blank field.

## Alternatives Considered

- **Predictive expiry warnings** — rejected: production refresh tokens have
  no expiry timestamp; revocations (password change, security sweep) are
  unannounced. Detection-ASAP is the best achievable.
- **BullMQ repeatable job for the health check** — rejected for now: Redis is
  optional in this deployment (`REDIS_URL` guard in `index.ts`), and the
  existing push-subscription renewal already uses `setInterval`. Consistency
  and zero new dependencies win.
- **Failing scheduled runs with a clear error instead of skipping** —
  considered (it would produce an execution record and reuse per-workflow
  failure notifications), but rejected: the user explicitly does not want
  failed runs, and the health-check email already covers notification.
- **Auto-remapping stale `credentialId`s on reconnect** — deferred. The
  upsert-by-email path keeps IDs stable when users follow the "reconnect,
  don't delete" guidance; remapping is a one-time data fix if needed.

## Consequences

- A dead credential is detected within ≤ 1 hour instead of at the next
  scheduled run; the owner gets one email with affected workflows.
- Scheduled runs against a dead credential are skipped, not failed. Trade-off:
  the scheduled work silently does not happen until reconnect — mitigated by
  the alert email. Skips are visible in server logs only (no execution
  record); a future entry may add a "skipped" execution status if visibility
  is needed.
- Hourly refresh writes new access tokens to Mongo (~24 writes/day per
  credential) — negligible load.
- Health checks cover `provider: 'google'` only; Slack/Teams/Basecamp keep
  their existing behavior (their auth services already surface refresh
  failures with explicit messages).
- Legacy credential documents without `status` are treated as `active`.

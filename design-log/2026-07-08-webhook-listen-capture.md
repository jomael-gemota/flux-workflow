# Webhook Trigger: Listen for Real Webhook (SSE Capture Session)

**Date:** 2026-07-08
**Status:** accepted
**Author:** ai

## Context

The prior entry [Webhook Trigger: Test Output & Sample Payload](./2026-07-08-webhook-trigger-test-output.md)
added a "Sample request body" textarea so users could hand-type a mock webhook
payload when testing a webhook trigger node. That entry explicitly **deferred**
the "Listen for real webhook" option (its Alternatives Considered section):

> **"Listen for real webhook"** — A polling/SSE approach that waits for an actual
> webhook hit and captures its payload. More realistic but requires a new backend
> endpoint and complex UX. Deferred to a future iteration.

This entry implements that deferred option. Hand-typing a sample is error-prone
and rarely matches the real provider payload shape (nested bodies, header casing,
query params). Capturing a real inbound hit gives users the exact payload their
downstream nodes will receive.

## Decision

Add a "Listen for webhook" capability to `NodeTestPanel` for webhook trigger nodes,
backed by a short-lived (~60s) server-side capture session streamed over SSE.

**Backend**

- **`src/services/WebhookCaptureRegistry.ts` (new):** in-memory `Map` keyed by
  `${workflowId}:${nodeId}` → `{ captureId, expiresAt, capturedPayload }`. `arm()`
  installs a self-cleanup TTL timer; `markCaptured()` records the first payload;
  `get()`/`clear()` manage lifecycle. Buffering the captured payload on the session
  closes the race where a webhook lands between arming and the SSE subscription.
- **`src/events/ExecutionEventBus.ts`:** add `emitWebhookCaptured(workflowId, nodeId, payload)`
  and `onWebhookCaptured(workflowId, nodeId, listener): () => void`, mirroring the
  existing node-result/complete pattern. Event key: `webhook-capture:${workflowId}:${nodeId}`.
- **`src/routes/webhooks.ts`:** in `fastify.all('/webhooks/:workflowId/trigger/:nodeId')`,
  when a capture session is armed for `{workflowId, nodeId}`, record + emit the payload
  and return a clean `200 { received: true, captured: true }` **without executing the
  workflow** (capture-only, to avoid firing downstream side effects during a test). The
  first hit closes the session; later hits execute normally.
- **`src/routes/workflows.ts`:** two new routes under `/api`:
  - `POST /workflows/:id/nodes/:nodeId/webhook-capture/start` — validates the node is a
    webhook trigger, arms the registry with a `crypto.randomUUID()` captureId and ~60s TTL,
    returns `{ captureId, expiresAt }`.
  - `GET /workflows/:id/nodes/:nodeId/webhook-capture/:captureId/events` — SSE endpoint
    following the existing `executions.ts` pattern (token/apiKey query auth, hijacked raw
    response, 15s heartbeat, cleanup on close). Replays a buffered payload if already
    captured; otherwise subscribes to the bus, emits a `captured` event on the first hit
    or a `timeout` event after the remaining TTL, then closes. Always clears the registry,
    bus listener, and timers on every exit path.

**Frontend**

- **`frontend/src/api/client.ts`:** `startWebhookCapture(workflowId, nodeId)` next to `testNode`.
- **`frontend/src/hooks/useWebhookCapture.ts` (new):** small hook that calls the start
  endpoint, opens an `EventSource` (token/apiKey query param like `useExecutionStream`),
  runs a 1s countdown, and exposes `start`/`cancel` plus `onCaptured`/`onTimeout` callbacks.
  Closes the `EventSource` on capture, timeout, cancel, and unmount.
- **`NodeConfigPanel.tsx` (`NodeTestPanel`):** a "Listen for webhook" button beside "Run node"
  (webhook triggers only). While listening it shows a "Waiting for webhook… (0:59)" countdown
  with Cancel. On `captured`, it pretty-prints the captured `body` into the sample textarea and
  auto-runs the test using the full captured payload (`{ method, headers, query, body, receivedAt }`)
  as `context.input`. Timeout/cancel returns to idle with a short message.

## Alternatives Considered

- **Long-polling instead of SSE** — simpler client but no clean push; the repo already has a
  proven SSE pattern (`executions.ts` + `useExecutionStream.ts`), so reuse it for consistency.
- **Execute the workflow on the captured hit** — rejected: a test listen must not fire real
  downstream side effects. We capture-only and let the user run the test explicitly.
- **Persist the captured sample in node config** — rejected for the same reason as the prior
  entry: keep config clean; the textarea is transient.
- **Emit-only over the bus with no buffering** — rejected: a hit arriving before the SSE
  subscription would be lost. Buffering the payload on the registry session makes it reliable.

## Consequences

- Users get the exact real payload shape without hand-typing, and it flows straight into the
  existing test-run path (`context.input`), so downstream `{{nodes.<id>.body.*}}` resolve against
  real data.
- New in-memory state (capture registry) is process-local and non-persistent — acceptable for a
  60s transient session; multi-instance deployments would need sticky routing for the SSE + intake
  to hit the same process (documented limitation, matches the existing SSE execution stream).
- Capture-only means the armed window swallows one real webhook without running the workflow. The
  window is short (~60s) and user-initiated; the response still returns 200 so the caller is unaffected.
- No schema or version changes.

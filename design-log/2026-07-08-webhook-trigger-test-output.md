# Webhook Trigger: Test Output & Sample Payload

**Date:** 2026-07-08
**Status:** accepted
**Author:** ai

## Context

The Webhook trigger node previously only showed `triggerType` and `triggeredAt` when tested via the "Test this node" panel. The actual webhook payload fields (`body`, `headers`, `query`, `method`) were never surfaced during testing, making it impossible to see what data downstream nodes could reference.

The root cause was two-fold:
1. **Backend:** The `POST /workflows/:id/nodes/:nodeId/test` route always set `input: triggerSample` in the execution context, where `triggerSample` was `{}` for webhook/manual triggers (only `app_event` had live sample fetching). This overwrote any `context.input` the caller sent.
2. **Frontend:** The `NodeTestPanel` had no way to supply a sample payload for webhook triggers.

## Decision

Enhance the webhook trigger test flow end-to-end:

**Backend (`src/routes/workflows.ts`):**
- When `triggerSample` is empty (i.e., no live sample from `TriggerTestService`) and the caller provides `context.input`, use `context.input` as the trigger's input. Live samples (app_event) still take priority.

**Frontend (`NodeConfigPanel.tsx`):**
- `NodeTestPanel` gains an optional `nodeConfig` prop.
- When `nodeType === 'trigger'` and `nodeConfig.triggerType === 'webhook'`, show a "Sample request body" JSON textarea pre-filled with example data.
- On "Run node", the parsed body is wrapped into a full webhook-shaped payload (`{ method, headers, query, body, receivedAt }`) and passed as `context.input` to the test API.
- JSON parse errors are shown inline and block the run.

**`TriggerResultDisplay`:**
- For webhook results, renders `body` sub-fields prominently with purple monospace keys.
- Renders `query` params if present.
- Renders `headers` in a collapsible section (they're verbose by default).
- Shows HTTP method as a violet badge alongside the "Webhook received" label.

## Alternatives Considered

- **"Listen for real webhook"** — A polling/SSE approach that waits for an actual webhook hit and captures its payload. More realistic but requires a new backend endpoint and complex UX. Deferred to a future iteration.
- **Saving sample in node config** — Persisting the sample JSON in the node's config so it's reloaded on panel open. Opted against to keep config clean; the textarea always resets to the default example.

## Consequences

- Downstream nodes can now use `{{nodes.<trigger-id>.body.*}}`, `{{nodes.<trigger-id>.query.*}}` etc. during design and testing.
- The variable picker already catalogs these fields; now test data fills them.
- No schema changes; the `context` field in the test API body already accepted arbitrary objects.

# Per-Workflow Variables (ENV-like)

**Date:** 2026-07-09
**Status:** accepted
**Author:** collaborative

## Context

Nodes can already reference other nodes' outputs via `{{nodes.<id>.field}}`, but
there is no way to define a reusable constant once and use it across many nodes.
Authors currently hardcode the same base URL, folder ID, model name, or channel
ID into every node. This entry introduces an "ENV-like" store of variables scoped
to a single workflow: each workflow has its own set, isolated from every other
workflow.

Relevant existing architecture:

- `ExpressionResolver` (`src/engine/ExpressionResolver.ts`) understands three
  expression roots: `nodes.*` (dot notation), `$...` (JSONPath), and template
  strings `{{ ... }}`.
- `WorkflowRunner.run` seeds `ExecutionContext.variables` with `{ input }` and
  stores each node's output under its node id.
- `WorkflowDefinition.definition` is a Mongoose `Mixed` field, so new fields need
  no migration. `WorkflowRepository.contentHash()` versions the workflow on any
  content change (excluding view-only fields).

## Decision

Add **plain (non-secret) string variables** scoped per workflow.

### Data model

`WorkflowDefinition.variables?: WorkflowVariable[]` where:

```ts
interface WorkflowVariable {
  key: string;        // /^[A-Za-z_][A-Za-z0-9_]*$/ — referenceable as vars.<key>
  value: string;      // plain string (env-like)
  description?: string;
}
```

Stored as an ordered array for a stable editing UI; flattened to a
`Record<string, string>` map at execution time.

### Referencing

New expression root `vars.<key>`, usable anywhere existing expressions are
(including inside `{{ ... }}`). `ExecutionContext` gains an optional
`vars?: Record<string, string>` map. `WorkflowRunner` builds it from
`workflow.variables` at run start; the node-test and step-run routes build it the
same way so isolated testing matches real runs. Code and Loop node sandboxes
expose a `vars` global alongside `nodes` and `input`.

### Persistence & versioning

`variables` is part of the content hash, so editing a variable bumps the workflow
version and records a history snapshot — consistent with treating variable values
as workflow logic. Included in create/update Zod schemas and the save flow.

### UI

A "Variables" button in the canvas action dock opens a modal to add/edit/remove
key/value pairs. The variable picker (`VariablePickerPanel`) gains a "Workflow
variables" section so `{{vars.<key>}}` can be inserted next to `{{nodes.*}}`.

## Alternatives Considered

- **Reuse `context.variables` map** for vars: rejected — a variable named after a
  node id would collide with that node's output. `vars` gets its own namespace.
- **Secrets / encrypted values now**: deferred. Plain values only for this pass;
  secret handling (encryption at rest, masking, scrubbing from
  `NodeResult.resolvedInput` and version history) is a separate future entry.
- **Workspace/Project-level tiers**: deferred. There is no workspace entity today;
  per-workflow is the correct primary scope. The resolver/context design leaves
  room for a later merge order (global → project → workflow).

## Consequences

- Missing variable references resolve to the existing `[missing: vars.x]`
  placeholder (via `resolveTemplate`), consistent with missing node references.
- Variable values are visible in the UI and stored in plaintext in the workflow
  definition and version history — acceptable for non-secret config, and the
  reason secrets are explicitly out of scope here.
- Keys are constrained to identifier syntax so they are always referenceable as
  `vars.<key>` without escaping.

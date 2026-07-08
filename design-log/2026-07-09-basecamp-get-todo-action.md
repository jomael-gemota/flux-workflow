# Basecamp: Get a To-Do Action

**Date:** 2026-07-09
**Status:** accepted
**Author:** collaborative

## Context

Follows [2026-07-09-basecamp-people-read-actions.md](./2026-07-09-basecamp-people-read-actions.md).

The Basecamp node had `list_todos` (many) but no single-to-do read. Requested:

- Get a to-do — `GET /todos/{id}.json`

Reference: https://github.com/basecamp/bc-api/blob/master/sections/todos.md#get-a-to-do

## Decision

Add a `get_todo` action that reads `GET /todos/{todoId}.json` and returns a
normalised to-do via a new module-level `mapBasecampTodo()` helper. The helper
flattens the rich API record into camelCase and reduces nested people (creator,
assignees, completion author, completion subscribers) to `{id, name, email}`
summaries through a shared `mapPersonSummary()` helper. It also surfaces the
parent to-do list and containing project (`bucket`) for downstream routing, and
a `completion` object (`{ createdAt, by }`) when the to-do is completed.

**Frontend (`NodeConfigPanel.tsx`, `BasecampNodeWidget.tsx`):**
- Add `get_todo` ("Get a To-Do") to the To-Dos group of the action dropdown.
- Reuse the existing complete/uncomplete to-do picker (Project → To-Do List →
  To-Do) plus the free-form To-Do ID input by extending those blocks' action
  conditions and the `useBasecampTodos` enable condition to include `get_todo`.
- Add output-field labels (`title`, `content`, `description`, `dueOn`,
  `assignees`, `creator`, `completion`, `appUrl`).

**Skill catalog (`src/skills/catalog/basecamp.ts`):** document `get_todo` inputs
and the flattened output shape.

## Alternatives Considered

- **Return the raw Basecamp to-do JSON.** Rejected for consistency with the
  node's other flattened outputs (`create_todo`, `list_todos`, the new people
  actions) and to keep `email_address`/nested objects easy to reference.
- **A separate to-do picker that browses both active and completed to-dos.**
  Deferred: the reused picker browses active to-dos, and the To-Do ID field
  accepts any id (including completed), which covers the lookup need without new
  UI. Can revisit if users need completed-to-do browsing here.

## Consequences

- New read-only action; no change to existing actions or outputs.
- The reused picker lists active to-dos for browsing; a completed to-do can still
  be fetched by entering its id directly.

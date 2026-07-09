# Basecamp Comment Read Actions (Get comments / Get a comment)

**Date:** 2026-07-10
**Status:** accepted
**Author:** collaborative

## Context

The Basecamp node supports several read actions (`get_todo`, `get_person`,
`get_project_people`) and a write `post_comment`, but no way to *read* comments.
This adds two read actions from the Basecamp API comments section
(https://github.com/basecamp/bc-api/blob/master/sections/comments.md):

- **Get comments** — `GET /recordings/{recording_id}/comments.json` (paginated)
- **Get a comment** — `GET /comments/{comment_id}.json`

Follows the precedent set by `2026-07-09-basecamp-get-todo-action.md` and
`2026-07-09-basecamp-people-read-actions.md`.

## Decision

Add actions `get_comments` and `get_comment`.

- **Names:** snake_case matching existing conventions and the user's phrasing
  ("Get comments" / "Get a comment").
- **Config:** `get_comments` reuses the existing `recordingId` field (also used by
  `post_comment`); `get_comment` adds a new `commentId` field. Neither requires a
  `projectId` — both use Basecamp's flat routes.
- **Mapper:** a new `mapBasecampComment()` flattens the API record (content,
  title, status, type, visibleToClients, boostsCount, url, appUrl, timestamps,
  `creator` summary, `parent` recording, `project`/bucket) — mirroring
  `mapBasecampTodo` / `mapBasecampPerson`.
- **Returns:** `get_comments` → `{ recordingId, comments: [...], count }` (via
  `fetchAllPages` with `throwOnError=true`); `get_comment` → the flat comment.
- **UI:** grouped under "Messaging" in the action dropdown; `get_comments` shows a
  Recording ID expression input + hint, `get_comment` shows a Comment ID input.
  A `comments[]` branch was added to `BasecampResultDisplay`, and the Basecamp
  `NODE_OUTPUT_FIELDS` catalogue lists the new output keys.
- **Skill catalog:** documented both actions and expanded summary/keywords so
  Fluxelle can select them.

## Alternatives Considered

- **Action names `list_comments` / `get_comment`:** `list_*` matches
  `list_todos`, but `get_*` matches the read-family (`get_todo`, `get_person`) and
  the user's wording. Chose `get_comments` for consistency with the user's request.
- **Comment browse picker (data route + hook):** deferred. Comments are id-driven;
  the recording/comment ids come from upstream outputs, triggers, or expressions.
  No `/basecamp/comments` picker endpoint added.
- **Legacy project-scoped routes** (`/buckets/{id}/...`): not used — the flat
  routes are the canonical form per the API docs.

## Consequences

- No new backend picker routes, data hooks, API client functions, or Fluxelle
  lookup tools were needed.
- `get_comment` uses the shared generic single-result banner in the test panel
  (like `get_todo`/`get_person`); `get_comments` gets a dedicated list view.
- A future enhancement could add a comment browse picker and a
  `list_basecamp_recordings` Fluxelle tool for discovering recording ids.

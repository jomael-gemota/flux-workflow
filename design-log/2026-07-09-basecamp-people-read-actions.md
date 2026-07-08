# Basecamp: Read People Actions (Get People on a Project, Get Person)

**Date:** 2026-07-09
**Status:** accepted
**Author:** collaborative

## Context

The Basecamp node (`src/nodes/BasecampNode.ts`) supported write/manage actions
plus `list_organizations`, but had no first-class **read** action for people. Two
read endpoints from the Basecamp API People section were requested:

- Get people on a project — `GET /projects/{id}/people.json`
- Get person — `GET /people/{id}.json`

Reference: https://github.com/basecamp/bc-api/blob/master/sections/people.md

## Decision

Add two new actions to the Basecamp node:

- `get_project_people`: resolves the project (numeric id or name via the existing
  `resolveProjectId`), then pages through `GET /projects/{id}/people.json` using
  the existing `fetchAllPages(..., throwOnError = true)` so an auth/permission
  failure surfaces as an error instead of an empty roster. Returns
  `{ projectId, people[], count }`.
- `get_person`: reads `GET /people/{personId}.json` and returns the mapped
  profile. Surfaces the optional `out_of_office` window when present.

Introduce a shared module-level `mapBasecampPerson()` helper that normalises the
raw API record into a flat camelCase shape (`email` from `email_address`,
`company`/`companyId` from the nested company object, booleans like
`admin`/`owner`/`client`/`employee`, `timeZone`, `avatarUrl`, timestamps, and
`outOfOffice` when set). Both new actions use it so their person shape is
consistent.

**Frontend (`NodeConfigPanel.tsx`, `BasecampNodeWidget.tsx`):**
- Add both actions to the action dropdown and the widget's label map.
- `get_project_people` reuses the existing cascading Project picker (added to
  `needsProject`).
- `get_person` adds a Person picker: select from the account people list (reusing
  the `useBasecampPeople` hook) with a "Use variable" toggle for an expression /
  raw id, storing the value in a new `personId` config field.
- Document output fields (`people`, `outOfOffice`) in the output catalogue.

**Skill catalog (`src/skills/catalog/basecamp.ts`):** document both actions,
their inputs and outputs, and extend keywords/summary.

## Alternatives Considered

- **Fold "get people" into the existing `list_organizations` / people helpers.**
  Rejected: those aggregate account-wide companies; the request is specifically a
  project roster and a single-person lookup, which map cleanly to dedicated
  endpoints and outputs.
- **Return the raw Basecamp JSON verbatim.** Rejected for consistency — other
  node outputs use flattened camelCase shapes, and `email_address`/nested
  `company` are awkward to reference in downstream expressions.

## Consequences

- New read-only actions; no change to existing actions or their outputs.
- `get_project_people` requires the connected account to have access to the
  project; failures are surfaced as errors (throwOnError) rather than empty lists.
- `email` may be redacted by Basecamp for non-admins (per API docs); this is a
  server-side behavior the node passes through unchanged.

# Component: Backend

**Read this when:** you need a high-level orientation on the API/DB before diving
into the `backend/` submodule, or you're deciding which repo owns a concern.
**Authoritative source:** `backend/CLAUDE.md` (the submodule). This page is a
bridge — keep it short and link, don't duplicate.

- **Submodule path:** `backend/`
- **Status:** not added yet
- **Stack (planned):** REST + WebSocket API, PostgreSQL primary DB, object
  storage for logs/reports/recordings.

## Responsibility

Single source of truth for all persistent state: users, teams, projects,
features, agent jobs, test suites, test reports, notifications. Manages GitHub
OAuth tokens, dispatches jobs to the Forge, and delivers real-time events to the
Frontend.

## Talks to

- **Frontend** — serves REST + WebSocket.
- **Forge** — dispatches job specs (see `concepts/job-dispatch.md`), receives
  streamed run events.
- **GitHub** — OAuth, mints short-lived scoped tokens for Forge runs.

## Deep docs (in the submodule, once added)

- `backend/CLAUDE.md` — router for the backend repo
- `backend/docs/` — data model, API surface, auth, event system, migrations

> TODO: fill in once the backend repo is scaffolded.

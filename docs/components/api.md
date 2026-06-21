# Component: API

**Read this when:** you need a high-level orientation on the API/DB before diving
into the `api/` submodule, or you're deciding which repo owns a concern.
**Authoritative source:** `api/CLAUDE.md` (the submodule). This page is a
bridge — keep it short and link, don't duplicate.

- **Submodule path:** `api/`
- **GitHub repo:** `yggdrasil-hq/yggdrasil-api`
- **Status:** added
- **Stack:** Express + TypeScript, REST + WebSocket (planned), PostgreSQL, MinIO/S3
  for artefacts.

## Responsibility

Single source of truth for all persistent state: users, teams, projects,
features, agent jobs, test suites, test reports, notifications. Manages GitHub
OAuth tokens, dispatches jobs to the Orchestrator, and delivers real-time events to the
Web app.

## Talks to

- **Web** — serves REST + WebSocket.
- **Orchestrator** — dispatches job specs (see `concepts/job-dispatch.md`), receives
  streamed run events.
- **GitHub** — OAuth, mints short-lived scoped tokens for Orchestrator runs.

## Deep docs

- `api/CLAUDE.md` — router for the API repo
- [`../concepts/authentication.md`](../concepts/authentication.md) — auth flows and API surface (canonical)
- [`../adr/001-authentication.md`](../adr/001-authentication.md) — auth rationale (ADR)
- `api/docs/concepts/authentication.md` — API-specific implementation notes

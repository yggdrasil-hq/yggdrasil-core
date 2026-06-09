# Component: Frontend

**Read this when:** you need a high-level orientation on the web app before
diving into the `frontend/` submodule, or you're deciding which repo owns a
concern.
**Authoritative source:** `frontend/CLAUDE.md` (the submodule). This page is only
a bridge — keep it short and link, don't duplicate.

- **Submodule path:** `frontend/`
- **Status:** not added yet
- **Stack (planned):** React / Next.js, desktop-first responsive.

## Responsibility

The daily user surface. Create projects, write feature specs, monitor agent runs
live, review test reports, chat with / steer the agent mid-run. Holds **no**
source-of-truth state — everything comes from the Backend.

## Talks to

- **Backend REST** — commands and queries.
- **Backend WebSocket** — live run/agent events.
- Never talks to the Forge directly.

## Deep docs (in the submodule, once added)

When `frontend/` exists, look there first:
- `frontend/CLAUDE.md` — router for the frontend repo
- `frontend/docs/` — component architecture, routing, state, design system

> TODO: fill in once the frontend repo is scaffolded.

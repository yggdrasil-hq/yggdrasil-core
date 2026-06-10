# Component: Web

**Read this when:** you need a high-level orientation on the web app before
diving into the `web/` submodule, or you're deciding which repo owns a
concern.
**Authoritative source:** `web/CLAUDE.md` (the submodule). This page is only
a bridge — keep it short and link, don't duplicate.

- **Submodule path:** `web/`
- **GitHub repo:** `yggdrasil-hq/yggdrasil-web`
- **Status:** added
- **Stack (planned):** React / Next.js, desktop-first responsive.

## Responsibility

The daily user surface. Create projects, write feature specs, monitor agent runs
live, review test reports, chat with / steer the agent mid-run. Holds **no**
source-of-truth state — everything comes from the API.

## Talks to

- **API REST** — commands and queries.
- **API WebSocket** — live run/agent events.
- Never talks to the Orchestrator directly.

## Deep docs (in the submodule, once added)

When `web/` exists, look there first:
- `web/CLAUDE.md` — router for the web repo
- `web/docs/` — component architecture, routing, state, design system

> TODO: fill in once the web repo is scaffolded.

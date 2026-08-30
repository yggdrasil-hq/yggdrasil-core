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

## `design/` as source of truth for IA

`design/` (meta repo root) holds the wireframed page/route inventory for
this app. Per [ADR 017](../adr/017-web-visual-parity-with-design.md),
`web/` is now expected to visually and structurally match every route in
`design/README.md`'s map — including static/mock pages for concepts that
are still product-undecided (usage/analytics/allocations, deployments
Staging; see `roadmap/open-questions.md` #9/#15) — not just the parts
already backed by real functionality (Organization/RBAC per ADR 016,
six-stage feature lifecycle per ADR 015). A page existing and looking right
does **not** imply its underlying concept is decided or wired to real data —
check the ADRs before assuming otherwise.

## Deep docs

- `web/CLAUDE.md` — router for the web repo
- [`../concepts/authentication.md`](../concepts/authentication.md) — auth flows and Web routes (canonical)
- [`../adr/001-authentication.md`](../adr/001-authentication.md) — auth rationale (ADR)
- `web/docs/concepts/authentication.md` — Web-specific implementation notes

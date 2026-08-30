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

## Proposed IA

`design/` (meta repo root) holds the current wireframed page/route inventory
for this app — a materially larger surface than what `web/` implements today
(usage/analytics/allocations pages and more remain undecided — plus the
six-stage feature lifecycle pages and the org-level settings pages, both of
which are now implemented for ADR 015 and ADR 016 respectively).
It's the source of truth for where the IA is headed, not for what's live.
See `design/README.md`'s route map, `docs/adr/015-six-stage-feature-lifecycle.md`,
`docs/adr/016-organization-rbac-and-cluster-routing.md`, and
`docs/CONTEXT.md`'s "Proposed (surfaced by `design/`)" section before
assuming a route described there exists in `web/`.

## Deep docs

- `web/CLAUDE.md` — router for the web repo
- [`../concepts/authentication.md`](../concepts/authentication.md) — auth flows and Web routes (canonical)
- [`../adr/001-authentication.md`](../adr/001-authentication.md) — auth rationale (ADR)
- `web/docs/concepts/authentication.md` — Web-specific implementation notes

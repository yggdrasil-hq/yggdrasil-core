# ADR 017: Bring `web/` and `landing/` visually in line with `design/`

**Status:** Accepted
**Date:** 2026-08-31
**Deciders:** Product/design session (grill-with-docs, short)
**Builds on:** [`conventions/design-wireframes.md`](../conventions/design-wireframes.md)
(what `design/` is), `components/docusaurus.md` (precedent: the Docusaurus
site already treats `design/` as source-of-truth-for-IA rather than
strict "docs match shipped code")

## Context

`design/` now sketches a materially larger surface than `web/` (and
`landing/`) implement — some of it real (Organization/RBAC, the six-stage
feature lifecycle, both built 2026-08-31), some of it still-undecided
product concepts (token usage/analytics/allocations, a deployments Staging
row) that only exist as wireframes with no ADR. The user wants `web/`/
`landing/` to visually and structurally match `design/` now, independent of
whether every page's underlying feature is wired to real data — a small,
scoped decision on how far that goes and what it does/doesn't imply.

## Decision

1. **Scope is the entire `design/README.md` route map** — every route listed
   there, both `landing/` (marketing) and the authenticated app (`web/`),
   gets a matching real page/component. This includes routes backing
   still-undecided concepts (`/usage`, `/analytics`, `/infrastructure`,
   `/allocations/infra`, `/allocations/api`, `/deployments`'s Staging row).
2. **Undecided-concept pages are static/mock only** — same inert-data
   posture `design/` itself uses (realistic placeholder data, no network
   calls beyond what the page shell already needs, no working controls
   beyond trivial UI state). **No new DB tables, API endpoints, or backend
   wiring for these** — this ADR is a UI-scaffolding decision, not a
   resolution of `roadmap/open-questions.md` #9 or #15. Those stay open;
   this pass's output should be expected to need rework once they're
   actually grilled and decided.
3. **Already-functional pages (Organization/RBAC, six-stage feature
   lifecycle) get drift reconciliation, not just gap-filling** — compared
   against their `design/` wireframe and brought back in line, including
   **route structure** where it currently diverges: the feature detail page
   currently implements the six stages as tabs/panels within one route,
   where `design/README.md` specifies six distinct sub-routes
   (`/spec`, `/action-items`, `/implementation`, `/testing`,
   `/agentic-review`, `/manual-review`). This pass restructures to match —
   real routing, not just visual style, since `design/`'s route map is part
   of what "the design" specifies, not only its CSS. Real wiring/data on
   these pages is preserved; only presentation and routing change.
4. **Styling: port `design/shared/tokens.css`'s tokens into `web/`'s
   existing Tailwind config** (theme extension), and build every page with
   `web/`'s existing Tailwind + component conventions. No raw CSS copy-paste
   from the wireframes, no second styling system introduced.
5. **This extends, not replaces, the Docusaurus precedent**: `web/`/
   `landing/` now join `docusaurus/` in deliberately reading ahead of shipped
   backend reality — `design/` is source-of-truth-for-IA everywhere in this
   product's docs *and* its actual frontends now, not docs alone.

## Consequences

### Positive

- One consistent policy ("build to `design/`, wire what's real, mock what
  isn't") instead of an ad hoc per-page judgment call each time.
- Route structure matching `design/` exactly means the wireframe route map
  stays literally accurate as a reference, not just directionally so.
- Reuses `web/`'s real production styling stack — no throwaway styling code
  to later replace.

### Negative / trade-offs

- **Static pages for undecided concepts risk looking more "done" than they
  are** — a fully-styled `/usage` page with fake numbers could read as
  shipped to someone unfamiliar with this ADR. Mitigated only by this
  document existing; no in-app "mock" banner is specified here.
- **Restructuring the feature detail page's routing is real, non-trivial
  work** on an already-shipped, working page (item 3) — not purely additive.
- **Rework risk is explicit and accepted**: once `roadmap/open-questions.md`
  #9/#15 are actually decided, some or all of the mock pages built here may
  need to change shape, not just get wired up.

### Follow-ups (out of scope here)

- Grilling `roadmap/open-questions.md` #9 (deployment safety net) and #15
  (usage/allocations) — this ADR explicitly does not resolve either.
- Wiring the mock pages to real data once their concepts are decided.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Only build pages for decided concepts, skip usage/analytics/allocations/deployments-staging | Direct product decision: build them as mocks now rather than wait |
| Leave already-functional pages alone, only fill gaps | Direct product decision: reconcile drift too, including routing |
| Copy `design/`'s raw CSS into `web/` directly | `web/` already has a real Tailwind-based styling system; a second parallel system would be pure debt |

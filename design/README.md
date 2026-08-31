# Yggdrasil wireframes

Static HTML/CSS mockups, one file per route, minus all functionality. Two
separate products live here, in two separate directories — kept apart on
purpose since they map to two different child repos with different
navigation, not because they share one app shell:

- **`landing/`** — the public marketing site, maps to the `landing/` repo.
- Everything else at the top level (`login/`, `projects/`, `settings/`, …) —
  the authenticated app, maps to the `web/` repo.

For the conventions behind this directory (and how it differs from ADR 014's
`designs/`), see
[`docs/conventions/design-wireframes.md`](../docs/conventions/design-wireframes.md).

## Implementation status

This directory is the source of truth for where the product's IA is headed —
**not** for what's built. Most pages below are proposed and unimplemented;
each page's own `.design-note` (visible in its HTML source) states precisely
what it maps to and what's real vs. faked vs. invented for that page. For a
rollup across all of them — the Organization/RBAC entity, the six-stage
feature lifecycle, usage/analytics/allocations surfaces, and more — see
[`docs/CONTEXT.md`](../docs/CONTEXT.md)'s "Proposed (surfaced by `design/`)"
section.

## Viewing

Links between pages use root-absolute paths (e.g. `/projects/index.html`), so
open this directory through a local static server rather than `file://`:

```bash
npx serve design
# or
python3 -m http.server --directory design 8080
```

Then open `http://localhost:.../index.html` — it's a sitemap linking to every
page.

## Route → file map

### Landing (`landing/` repo)

| Route | File |
|-------|------|
| `/` | `landing/index.html` |
| `/terms` | `landing/terms/index.html` (placeholder legal copy — not lawyer-reviewed) |
| `/privacy` | `landing/privacy/index.html` (placeholder legal copy — not lawyer-reviewed) |

### App (`web/` repo)

| Route | File |
|-------|------|
| `/login` | `login/index.html` |
| `/onboarding/confirm-username` | `onboarding/confirm-username/index.html` |
| `/projects` | `projects/index.html` |
| `/projects/new` | `projects/new/index.html` |
| `/projects/:projectId` | `projects/detail/index.html` |
| `/projects/:projectId/features` | `projects/detail/features/index.html` |
| `/projects/:projectId/features/:featureId` | `projects/detail/features/detail/index.html` |
| `/projects/:projectId/features/:featureId/spec` | `projects/detail/features/detail/spec/index.html` |
| `/projects/:projectId/features/:featureId/action-items` | `projects/detail/features/detail/action-items/index.html` |
| `/projects/:projectId/features/:featureId/implementation` | `projects/detail/features/detail/implementation/index.html` |
| `/projects/:projectId/features/:featureId/testing` | `projects/detail/features/detail/testing/index.html` |
| `/projects/:projectId/features/:featureId/agentic-review` | `projects/detail/features/detail/agentic-review/index.html` |
| `/projects/:projectId/features/:featureId/manual-review` | `projects/detail/features/detail/manual-review/index.html` |
| `/projects/:projectId/tests` | `projects/detail/tests/index.html` |
| `/projects/:projectId/tests/new` | `projects/detail/tests/new/index.html` |
| `/projects/:projectId/tests/:testId` | `projects/detail/tests/detail/index.html` |
| `/projects/:projectId/deployments` | `projects/detail/deployments/index.html` |
| `/projects/:projectId/usage` | `projects/detail/usage/index.html` |
| `/projects/:projectId/analytics` | `projects/detail/analytics/index.html` |
| `/projects/:projectId/settings/general` | `projects/detail/settings/general/index.html` |
| `/projects/:projectId/settings/secrets` | `projects/detail/settings/secrets/index.html` |
| `/projects/:projectId/settings/models` | `projects/detail/settings/models/index.html` |
| `/deployments` | `deployments/index.html` |
| `/usage` | `usage/index.html` |
| `/analytics` | `analytics/index.html` |
| `/infrastructure` | `infrastructure/index.html` |
| `/allocations/infra` | `allocations/infra/index.html` |
| `/allocations/api` | `allocations/api/index.html` |
| `/notifications` | `notifications/index.html` |
| `/settings/account` | `settings/account/index.html` (also the user-level tier of Usage/Analytics, as sections — no separate route) |
| `/settings/organization/general` | `settings/organization/general/index.html` |
| `/settings/organization/members` | `settings/organization/members/index.html` |
| `/settings/organization/providers` | `settings/organization/providers/index.html` |
| `/settings/organization/secrets` | `settings/organization/secrets/index.html` |
| `/settings/organization/cluster` | `settings/organization/cluster/index.html` |

`detail/` stands in for one sample record of a dynamic route segment.

## Editing

- `shared/tokens.css` — design tokens (colors, type, spacing). Keep in sync
  with [`docs/conventions/theming.md`](../docs/conventions/theming.md) by
  hand. Shared by both `landing/` and the app pages — it's the thing that
  keeps them looking like one product despite the separate navigation.
- `shared/shell.css` — the app shell: one `.shell`/`.sidebar`/`.main` layout
  used by every app page, hub-level (Projects, Notifications, Account/
  Organization settings, New project) and project-level alike — a persistent
  left sidebar (org switcher pinned above the nav, account cell pinned below
  it), Vercel-style, rather than a separate top-bar-only layout for hub
  pages. Also has a couple of primitives (`.logo`, `.design-note`) the
  landing page reuses. `landing/index.html` otherwise defines its own
  nav/hero/footer components locally — a marketing page has no use for the
  app shell.
- Every page is self-contained: no build step, no framework, no network
  calls beyond the Google Fonts stylesheet. A page may inline a small
  `<script>` for a trivial interaction state (a tab switch) but nothing that
  talks to a server.

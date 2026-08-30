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
| `/projects/:projectId/tests` | `projects/detail/tests/index.html` |
| `/projects/:projectId/tests/new` | `projects/detail/tests/new/index.html` |
| `/projects/:projectId/tests/:testId` | `projects/detail/tests/detail/index.html` |
| `/projects/:projectId/settings` | `projects/detail/settings/index.html` |
| `/notifications` | `notifications/index.html` |
| `/settings/account` | `settings/account/index.html` |

`detail/` stands in for one sample record of a dynamic route segment.

## Editing

- `shared/tokens.css` — design tokens (colors, type, spacing). Keep in sync
  with [`docs/conventions/theming.md`](../docs/conventions/theming.md) by
  hand. Shared by both `landing/` and the app pages — it's the thing that
  keeps them looking like one product despite the separate navigation.
- `shared/shell.css` — sidebar / hub-header / layout chrome classes for the
  app, plus a couple of primitives (`.logo`, `.design-note`) the landing page
  also reuses. `landing/index.html` otherwise defines its own nav/hero/footer
  components locally — a marketing page has no use for the app shell.
- Every page is self-contained: no build step, no framework, no network
  calls beyond the Google Fonts stylesheet. A page may inline a small
  `<script>` for a trivial interaction state (a tab switch) but nothing that
  talks to a server.

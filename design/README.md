# Yggdrasil web wireframes

Static HTML/CSS mockups of every page in `web/`, one file per route, matching
one-to-one, minus all functionality. For the conventions behind this
directory (and how it differs from ADR 014's `designs/`), see
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

| Route | File |
|-------|------|
| `/` | `index.html` |
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
  hand.
- `shared/shell.css` — shared sidebar / hub-header / layout chrome classes.
- Every page is self-contained: no build step, no framework, no network
  calls beyond the Google Fonts stylesheet. A page may inline a small
  `<script>` for a trivial interaction state (a tab switch) but nothing that
  talks to a server.

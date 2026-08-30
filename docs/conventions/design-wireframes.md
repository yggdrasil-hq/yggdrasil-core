# Convention: design wireframes (`design/`)

**Read this when:** you're adding, updating, or referencing a static HTML/CSS
wireframe of a `web/` page, or deciding whether new UI work should start from
`design/` before code.

## What this is

`design/` (singular), at the meta repo root, holds hand-built, self-contained
HTML/CSS wireframes — one file per route, matching one-to-one, with all app
logic stripped out. It exists so a human can iterate on layout, copy, and
information architecture with an agent, in a browser, before a Feature is
actually built.

Two products live under `design/`, kept in **separate directories** because
they map to two different child repos with two different navigation shells —
not because they share one app:

- **`design/landing/`** — the public marketing site, maps to the `landing/`
  repo. Its own nav/hero/footer, no app shell.
- Everything else at the top level (`design/login/`, `design/projects/`, …) —
  the authenticated app, maps to the `web/` repo, uses `shared/shell.css`'s
  hub-header/sidebar chrome.

Both share `shared/tokens.css` (and `shared/shell.css`'s `.logo`/`.design-note`
primitives) so they read as one product despite the different navigation.

## How this differs from ADR 014's `designs/`

Two different things share a similar name — keep them distinct:

- **`design/`** (singular, meta repo root, this doc): wireframes of
  **Yggdrasil's own web app**, hand-authored by a human + agent pair — no job
  kind, no container, no product mechanism involved.
- **`designs/`** (plural, inside a **child project's own repo**, see
  [ADR 014](../adr/014-design-grill-live-mockups.md)): what the product
  feature `design_grill` produces for **end users' projects** — an
  AI-run job kind with its own container, contract tools, and live-preview
  UI in the Web app.

`design_grill` doesn't (and can't yet) build Yggdrasil itself; `design/` here
is the same underlying idea — throwaway static HTML mockups before
implementation — applied by hand, one layer up. A routing-table hit for
"design_grill", live mockup sessions, or a child project's `designs/`
directory belongs in ADR 014, not here.

## Structure

- `design/index.html` — sitemap linking every wireframe.
- `design/shared/tokens.css` — design tokens (colors, type, spacing), copied
  from [`theming.md`](theming.md). Keep the two in sync by hand.
- `design/shared/shell.css` — shared sidebar / hub-header / layout chrome
  classes, mirroring `web/components/app-shell/*`. The landing page reuses
  only its `.logo`/`.design-note` primitives, not the app-shell components.
- `design/landing/index.html` — the marketing home page, maps to `landing/`.
  Defines its own nav/hero/section/footer components locally.
- One directory per **app** route, with `index.html` inside. A dynamic route
  segment (`[projectId]`, `[featureId]`, …) becomes a literal `detail/`
  directory standing in for one sample record.

Full route → file map: `design/README.md`.

## Conventions for a page file

- **Self-contained**: no build step, no framework, no network calls beyond
  the Google Fonts stylesheet (per `theming.md`). A page may use a tiny
  inline `<script>` only for a trivial interaction state (a tab switch, an
  accordion) — never for anything that talks to a server. Mirrors ADR 014
  item 7's "no logic" boundary.
- Every page opens with a `.design-note` div stating which real route and
  component it maps to (`web/` for app pages, `landing/` for the marketing
  page), and what's faked, inert, or still just proposed. Hidden by default
  (`display: none` in `shared/shell.css`) so a page previews like the live
  site — the note text stays in the HTML for whoever's editing.
- Links between pages are **root-absolute** (`/projects/index.html`, not
  `../projects/index.html`) — see `design/README.md` for why (serve the
  directory locally; don't open files via `file://`).
- Reuse `shared/tokens.css` classes (`.btn`, `.card`, `.badge`, `.field`,
  `.input`, …) instead of inventing new ones per page.
- Populate with realistic placeholder data grounded in what the real
  component actually renders — read the corresponding `web/` component
  before writing or updating a wireframe; don't invent fields it doesn't
  have.

## Keeping this in sync

- When a page's real layout changes meaningfully in `web/`, update its
  wireframe in the same change (or file a follow-up) — a stale wireframe is
  worse than none.
- When a new page/route is added to `web/`, add its wireframe here in the
  same change that adds the route, and add a row to `design/README.md`'s
  route → file map.

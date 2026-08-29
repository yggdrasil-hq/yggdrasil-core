# Component: Landing / marketing site

**Read this when:** you're working on the public marketing website.
**Authoritative source:** `landing/CLAUDE.md` (the submodule). Bridge page.

- **Submodule path:** `landing/`
- **GitHub repo:** `yggdrasil-hq/yggdrasil-landing`
- **Status:** scaffolded and built — Next.js app (`app/page.tsx`,
  `app/layout.tsx`), branding assets, `deploy/Dockerfile.{dev,prod,test}`,
  and a `build-and-push` CI workflow publishing to GHCR (see
  `docs/conventions/deploy.md`).
- **Stack:** Next.js
- **Purpose:** public-facing marketing/landing site. Separate from both the app
  (Web) and the user docs (Docusaurus). Served at nginx's `/` path.

## Scope notes

- No authenticated app functionality — that's the Web app.
- Product/how-to documentation lives in `docusaurus/`, not here.
- No project-specific runtime configuration — the image needs no
  service-specific env vars (see `docs/conventions/deploy.md`'s GHCR section).

## Deep docs (in the submodule)

- `landing/CLAUDE.md` — router for this repo
- `landing/docs/overview/{architecture,setup}.md`
- `landing/docs/conventions/conventions.md`

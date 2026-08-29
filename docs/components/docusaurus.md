# Component: Docs site (Docusaurus)

**Read this when:** you're working on the **end-user product documentation**
site.
**Authoritative source:** `docusaurus/CLAUDE.md` (the submodule). Bridge page.

- **Submodule path:** `docusaurus/`
- **GitHub repo:** `yggdrasil-hq/yggdrasil-docusaurus`
- **Status:** scaffolded and built — content sections: **Getting Started**
  (quick start), **Using Yggdrasil** (projects, features, agent runs,
  reviewing PRs, tests, notifications), **Self-Hosting** (overview, web, api,
  orchestrator, running from published images), **Reference** (glossary).
  Own CI workflow publishes to GHCR (see `docs/conventions/deploy.md`).
- **Stack:** Docusaurus.

## Important distinction

`docusaurus/` holds **user-facing product documentation** (how to use Yggdrasil).
The `docs/` folders described throughout the meta repo (and in each submodule)
are **agent + developer context** — a different audience. Don't move
developer/agent context into the Docusaurus site, and don't put user how-tos in
the `docs/` agent folders.

## Deep docs (in the submodule)

- `docusaurus/CLAUDE.md` — router for this repo
- `docusaurus/docs/README.md` — index for this repo's own agent docs
  (`overview/architecture.md`, `overview/setup.md`,
  `conventions/conventions.md`), living inside the same `docs/` directory
  Docusaurus publishes, alongside the published content
  (`getting-started/`, `using-yggdrasil/`, `self-hosting/`, `reference/`,
  `intro.md`, `branding.mdx`) — the "two different `docs/` trees" collision
  `docusaurus/CLAUDE.md` warns about, resolved by keeping agent docs strictly
  under `overview/`/`conventions/`.

User-facing guides live in `docusaurus/docs/` — see **Using Yggdrasil** (projects,
features, tests, notifications) and **Reference** (glossary).

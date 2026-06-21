# Component: Docs site (Docusaurus)

**Read this when:** you're working on the **end-user product documentation**
site.
**Authoritative source:** `docusaurus/CLAUDE.md` (the submodule). Bridge page.

- **Submodule path:** `docusaurus/`
- **GitHub repo:** `yggdrasil-hq/yggdrasil-docusaurus`
- **Status:** added
- **Stack:** Docusaurus.

## Important distinction

`docusaurus/` holds **user-facing product documentation** (how to use Yggdrasil).
The `docs/` folders described throughout the meta repo (and in each submodule)
are **agent + developer context** — a different audience. Don't move
developer/agent context into the Docusaurus site, and don't put user how-tos in
the `docs/` agent folders.

## Deep docs (in the submodule, once added)

- `docusaurus/CLAUDE.md`
- `docusaurus/docs/` (note: Docusaurus content lives here too — the submodule's
  `CLAUDE.md` should clarify which `docs/` is which)

> TODO: fill in once the docusaurus repo is scaffolded.

User-facing guides live in `docusaurus/docs/` — see **Using Yggdrasil** (projects,
features, tests, notifications) and **Reference** (glossary).

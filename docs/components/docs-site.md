# Component: Docs site (Docusaurus)

**Read this when:** you're working on the **end-user product documentation**
site.
**Authoritative source:** `docs-site/CLAUDE.md` (the submodule). Bridge page.

- **Submodule path:** `docs-site/`
- **Status:** not added yet
- **Stack:** Docusaurus.

## Important distinction

`docs-site/` holds **user-facing product documentation** (how to use Yggdrasil).
The `docs/` folders described throughout the meta repo (and in each submodule)
are **agent + developer context** — a different audience. Don't move
developer/agent context into the Docusaurus site, and don't put user how-tos in
the `docs/` agent folders.

## Deep docs (in the submodule, once added)

- `docs-site/CLAUDE.md`
- `docs-site/docs/` (note: Docusaurus content lives here too — the submodule's
  `CLAUDE.md` should clarify which `docs/` is which)

> TODO: fill in once the docs-site repo is scaffolded.

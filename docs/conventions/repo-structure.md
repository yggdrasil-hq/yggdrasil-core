# Convention: repo structure & submodules

**Read this when:** you deal with the parent/child repo layout, add/clone/update
a submodule, or need to know where a given doc should live.

## The model

- This is the **meta / parent repo**. It holds **docs + submodule pointers
  only** — no application code.
- Each component is its own GitHub repo, mounted here as a **git submodule**.
- Each submodule carries its **own** `CLAUDE.md` (+ `AGENTS.md` pointer) and its
  own `docs/` tree, structured like this repo's.

```
yggdrasil-core/            (meta repo — GitHub: yggdrasil-hq/yggdrasil-core)
├── CLAUDE.md              canonical router for the suite
├── AGENTS.md              pointer → CLAUDE.md
├── docs/                  suite-wide agent/developer docs
│   ├── overview/  components/  concepts/  roadmap/  conventions/
├── design/                static wireframes of the Web app's own pages
│   └── ...                (docs/conventions/design-wireframes.md)
├── templates/child-repo/  scaffold to drop into each new submodule
├── web/           → submodule (web/CLAUDE.md, web/docs/…)
├── api/           → submodule
├── orchestrator/  → submodule
├── landing/       → submodule
├── docusaurus/    → submodule (Docusaurus user docs)
└── agent-images/  → submodule (Pi base container images, ADR 004)
```

## GitHub repos (`yggdrasil-hq`)

| Submodule path | GitHub repo |
|----------------|-------------|
| _(meta repo)_ | `yggdrasil-core` |
| `web/` | `yggdrasil-web` |
| `api/` | `yggdrasil-api` |
| `orchestrator/` | `yggdrasil-orchestrator` |
| `landing/` | `yggdrasil-landing` |
| `docusaurus/` | `yggdrasil-docusaurus` |
| `agent-images/` | `yggdrasil-agent-images` |

## Where does a doc belong? (parent vs. child)

- **Suite-wide** (spans 2+ components, or the product as a whole) → here, in the
  meta repo's `docs/`.
- **Component-specific** (only meaningful inside one repo) → that submodule's
  `docs/`.
- **Don't duplicate.** The parent's `docs/components/<x>.md` is a *bridge*: a
  short summary + a link into the submodule. Detail lives in the submodule.

## How the parent points to child docs (and vice versa)

- Parent → child: `docs/components/<x>.md` and the routing table in `CLAUDE.md`
  link to `<submodule>/CLAUDE.md`. An agent working a component task reads the
  bridge, then jumps into the submodule's own router.
- Child → parent: a submodule's `CLAUDE.md` links **up** for suite-wide concepts
  (e.g. `../docs/overview/architecture.md`, `../docs/overview/glossary.md`)
  instead of restating them. Note: these up-links only resolve when the
  submodule is checked out inside the parent — that's the intended workflow.

## Submodule workflow (cheat sheet)

```bash
# add a new component repo as a submodule
git submodule add <git-url> <path>      # e.g. web
# clone the meta repo with everything
git clone --recurse-submodules git@github.com:yggdrasil-hq/yggdrasil-core.git
# after a normal clone, pull submodule contents
git submodule update --init --recursive
# pull latest for all submodules
git submodule update --remote --merge
```

> When you add a submodule, copy `templates/child-repo/` into it and fill in the
> placeholders. Update `CLAUDE.md`'s repo map + the routing table, and the
> `docs/components/<x>.md` bridge.

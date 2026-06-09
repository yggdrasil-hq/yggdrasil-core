# templates/

Reusable scaffolds for the Yggdrasil suite.

## `child-repo/`

The standard agent-docs scaffold for a new submodule (frontend, backend,
orchestrator, landing, docusaurus, and any future component).

**When you add a new submodule:**

1. Copy `templates/child-repo/` contents into the new repo's root.
2. Replace every `<COMPONENT NAME>` / `<x>` / `<...>` placeholder.
3. Fill in the `TODO` sections as the component takes shape.
4. In the **meta repo**, update:
   - `CLAUDE.md` repo map + routing table (mark the submodule as added),
   - `docs/components/<x>.md` bridge page,
   - `docs/README.md` if needed.

See `../docs/conventions/repo-structure.md` and
`../docs/conventions/documentation-guide.md` for the rules these scaffolds follow.

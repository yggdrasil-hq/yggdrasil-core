# Convention: how to write agent docs (meta-guide)

**Read this when:** you create or edit ANY doc in a `docs/` tree or a `CLAUDE.md`.
This is the rulebook that keeps agent context small and findable.

## The core goal

An agent should be able to load **only** the docs relevant to its task. Every
rule below serves that goal.

## Rules

1. **Router stays thin.** `CLAUDE.md` is a map, not an encyclopedia. It holds the
   repo map, the routing table, and standing rules — nothing that belongs in a
   topic doc.
2. **One concern per file.** If a doc covers two unrelated things, split it. Small
   single-purpose files = less wasted context.
3. **Lead with a trigger.** Every topic doc starts with:
   ```
   **Read this when:** <the situation that makes this doc relevant>
   **Skip if:** <optional — when it's a false match>
   ```
   This lets an agent decide *without* reading the body.
4. **Link, don't duplicate.** State a fact in exactly one canonical doc; link to
   it from elsewhere. Duplicated facts drift and waste tokens.
5. **Add a routing row when you add a doc.** A doc nobody routes to is invisible.
   Update `CLAUDE.md`'s table and `docs/README.md`.
6. **Keep it current.** If a code/design change makes a doc wrong, fix the doc in
   the same change.
7. **Mark certainty.** Use `DRAFT`, `TODO`, `PLACEHOLDER (confirm)` for anything
   not yet authoritative. Never present a guess as a decided fact — flag it and,
   for design gaps, cross-link `roadmap/open-questions.md`.
8. **Parent vs. child placement.** Suite-wide → meta repo; component-specific →
   that submodule. See `repo-structure.md`.
9. **Audience.** These docs are for **agents + developers**. End-user how-tos go
   in the Docusaurus `docusaurus/`, not here.

## Standard folder taxonomy (reuse in every repo)

| Folder | Holds |
|--------|-------|
| `overview/` | Orientation: what/why, architecture, glossary. |
| `components/` | (meta repo) bridges to each submodule. |
| `concepts/` | Cross-cutting domain logic and contracts. |
| `roadmap/` | Phases, open questions. |
| `conventions/` | How we work: structure, git, this guide. |

A submodule may drop folders it doesn't need, but should keep the same names for
what it does have.

## When adding a doc — checklist

- [ ] Single concern, in the right folder, right repo (parent vs. child).
- [ ] Starts with `**Read this when:**`.
- [ ] Linked from `CLAUDE.md` routing table and `docs/README.md`.
- [ ] No duplicated facts — links to canonical sources.
- [ ] Uncertain content marked `DRAFT`/`TODO`/`PLACEHOLDER`.

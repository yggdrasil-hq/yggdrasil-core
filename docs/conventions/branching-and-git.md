# Convention: branching, commits & PRs

**Read this when:** you create branches, commits, or PRs in any Yggdrasil repo.

> Status: DRAFT — confirm and tighten as the team settles conventions.

## Agent-generated branches

The Orchestrator creates feature branches named:

```
yggdrasil/<feature-slug>-<id>
```

Do not hand-create branches in this namespace; it's owned by the orchestrator.

## Human / general work

- Branch from the repo's default branch (`main`).
- Suggested prefixes: `feat/`, `fix/`, `docs/`, `chore/`, `refactor/`.
- Keep PRs small and focused; one concern per PR.

## Commits

- Imperative mood, concise subject ("add job dispatch contract", not "added…").
- Reference the feature/issue where relevant.
- Conventional Commits: TODO — decide whether to adopt.

## Submodules & git

- Committing in the meta repo records submodule **pointers** (specific commits),
  not their contents. Land changes in the submodule first, then bump the pointer
  in the meta repo.
- See `repo-structure.md` for the submodule command cheat sheet.

## TODO

- PR review/approval policy and how it maps to feature `in_review` state.
- Whether agent draft PRs follow a different template than human PRs.

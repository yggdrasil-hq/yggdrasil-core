# Architecture Decision Records (ADRs)

**Read this when:** you need the *rationale* behind a major design choice, or you
are proposing a change that should become a recorded decision.

ADRs capture **why** we chose something. Implementation detail lives in
`concepts/` docs and code; ADRs stay stable even as code evolves.

## Format

Each ADR is numbered sequentially: `NNN-short-title.md`.

| Section | Purpose |
|---------|---------|
| **Status** | `Proposed`, `Accepted`, `Superseded`, or `Deprecated` |
| **Context** | Problem and constraints |
| **Decision** | What we chose |
| **Consequences** | Trade-offs, follow-ups, what we are *not* doing |
| **Alternatives considered** | Options we rejected and why |

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [001](001-authentication.md) | Authentication and user identity | Partially superseded by 009 |
| [002](002-projects-features-tests.md) | Projects, features, tests, and project UX | Accepted |
| [003](003-orchestrator-kubernetes.md) | Orchestrator compute — Kubernetes-based job execution and project hosting | Accepted |
| [004](004-agent-base-containers.md) | Agent base container images (Pi integration) | Accepted |
| [005](005-github-app-repository-access.md) | GitHub App for repository access | Accepted |
| [006](006-pi-rpc-orchestrator-integration.md) | Pi RPC integration in the Orchestrator | Accepted |
| [007](007-per-user-default-model-configuration.md) | Per-user default model configuration | Accepted |
| [008](008-project-init-grill-and-submodule-repos.md) | `project_init` grill workflow, structure standard, and submodule sub-repos | Accepted |
| [009](009-github-only-authentication.md) | GitHub-only authentication (remove username/password) | Accepted |

When adding an ADR, update this index, add a routing row in root `CLAUDE.md`, and
link from `docs/CONTEXT.md` if the decision affects suite-wide context.

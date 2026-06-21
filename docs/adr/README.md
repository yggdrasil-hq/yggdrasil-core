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
| [001](001-authentication.md) | Authentication and user identity | Accepted |

When adding an ADR, update this index, add a routing row in root `CLAUDE.md`, and
link from `docs/CONTEXT.md` if the decision affects suite-wide context.

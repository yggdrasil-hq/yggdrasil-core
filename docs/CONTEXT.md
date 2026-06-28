# Yggdrasil — living context

**Read this when:** you need a quick snapshot of what is **decided** vs **still open**
before diving into code or docs. For details, follow the links — do not treat this
file as the full spec.

Last updated: 2026-06-28

## Glossary

| Term | Meaning |
|------|---------|
| **GitHub identity** | Proof of who a human is on GitHub (`read:user` OAuth or linked `github_id`). Used only for Yggdrasil login/linking — optional; not required to create projects or complete an App install. |
| **GitHub OAuth App** | Per Yggdrasil instance: separate from the GitHub App. Used only for user identity (`read:user`) — login, signup, account linking. Does not grant repo access. |
| **GitHub App installation** | Org or user grants the Yggdrasil GitHub App access to **selected repos**. GitHub allows one installation per (app, org/account) — multiple Yggdrasil projects on the same org **share** that installation; each project picks its own primary + sub-repos from the granted repo list. Adding repos later requires re-configuring the installation on GitHub. Lifecycle kept in sync via **installation webhooks** (`installation`, `installation_repositories`). |
| **Job-scoped GitHub credential** | Short-lived installation access token minted by the API for one Orchestrator run, scoped to the project's linked repos. |
| **Container access tier** | How much GitHub access a job kind gets inside its ephemeral container. `spec_grill` and `test_run`: clone + fetch only (read). `feature_build`: read + write on all linked repos. Enforcement in Phase 1 is operational (Orchestrator/tool allowlist), not token-level. |
| **Feature branch** | Agent branch `yggdrasil/<feature-slug>-<id>`, created on every linked repo the build touches. Same name across repos for one feature. |
| **Coordination PR** | Draft PR on the **primary** repo for a `feature_build`. The human review entry point; links to sibling repo PRs when sub-repos changed. |
| **Repo PR** | Draft PR on a **sub-repo** that received commits during `feature_build`. One per touched sub-repo; opened alongside the coordination PR. |
| **Acting user** | The Yggdrasil user who triggered a job (`spec_grill`, `feature_build`). Feature creator for spec; whoever clicks **Start build** for build. Audit/UX only — does not supply the GitHub credential. Commits and PRs appear as the **GitHub App bot**, not the acting user. |
| **Project installer** | The user who completed the GitHub App install when connecting repos to a project. Recorded for audit; jobs use the installation token, not their personal grant. May need to be a GitHub org admin; non-admins get instructions to involve one. |
| **GitHub App** | Per Yggdrasil instance: the instance admin registers one GitHub App in GitHub (app ID, private key, webhook secret) pointing at that deployment's URLs. Not a shared marketplace app. Repository permissions: Metadata (read), Contents (read & write), Pull requests (read & write). Coexists with a separate **GitHub OAuth App** on the same instance for user identity only. |
| **GitHub access warning** | Project flag set when installation webhooks report revoked/suspended access or removed repos. Jobs fail fast; action queue surfaces "Fix GitHub access" with re-install/configure link. Cleared when access is restored. |
| **GitHub App bot** | The GitHub identity (`yggdrasil[bot]`) that authors commits and opens PRs for all job kinds. Attribution to humans is in Yggdrasil (acting user), not on GitHub. |

## Product

AI-orchestrated dev suite for small teams (2–10). Self-hosted; Web + API +
Orchestrator. Phase 1 in progress — UI shell exists; auth is the current build
focus.

→ [`overview/product.md`](overview/product.md)

## Decided (Phase 1 auth)

**ADR 001 — Authentication** ([`adr/001-authentication.md`](adr/001-authentication.md))

- Username/password **or** GitHub OAuth; no email; no password reset.
- Open registration; permanent username; DiceBear **thumbs** avatars (username seed).
- HttpOnly session cookies, PostgreSQL sessions, API-owned GitHub OAuth.
- GitHub OAuth for **identity only** (`read:user`); repo access via **GitHub App** (ADR 003).
- Implementation reference: [`concepts/authentication.md`](concepts/authentication.md), [`concepts/github-app.md`](concepts/github-app.md)

## Decided (projects, features, tests)

**ADR 002 — Projects, features, tests, and project UX**
([`adr/002-projects-features-tests.md`](adr/002-projects-features-tests.md))

- Project = primary repo + linked sub-repos; all jobs clone all repos.
- Project init (`project_init` feature) hard-gates until merged.
- Features: two-phase workflow (`spec_grill` → ADR review → `feature_build`).
- Tests: separate entity; markdown spec with `##` subtasks; scheduled `test_run`
  against ephemeral main preview.
- Project home: feature buckets + action queue; global notifications page.

## Still open

→ [`roadmap/open-questions.md`](roadmap/open-questions.md)

## Repo map

| Path | Role |
|------|------|
| `web/` | Next.js UI — no source-of-truth state |
| `api/` | Express API, PostgreSQL, OAuth, GitHub App, sessions |
| `orchestrator/` | Stateless job runner |
| `deploy/` | Docker Compose + nginx |

→ [`CLAUDE.md`](../CLAUDE.md) routing table for task-specific docs.

## ADRs

| # | Title |
|---|-------|
| 001 | [Authentication](adr/001-authentication.md) |
| 002 | [Projects, features, tests, and project UX](adr/002-projects-features-tests.md) |
| 003 | [GitHub App repository access](adr/003-github-app-repository-access.md) |

→ [`adr/README.md`](adr/README.md)

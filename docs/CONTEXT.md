# Yggdrasil — living context

**Read this when:** you need a quick snapshot of what is **decided** vs **still open**
before diving into code or docs. For details, follow the links — do not treat this
file as the full spec.

Last updated: 2026-07-08

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
- Progressive GitHub scopes (`read:user` first, `repo` when needed).
- Implementation reference: [`concepts/authentication.md`](concepts/authentication.md)

## Decided (projects, features, tests)

**ADR 002 — Projects, features, tests, and project UX**
([`adr/002-projects-features-tests.md`](adr/002-projects-features-tests.md))

- Project = primary repo + linked sub-repos; all jobs clone all repos.
- Project init (`project_init` feature) hard-gates until merged.
- Features: two-phase workflow (`spec_grill` → ADR review → `feature_build`).
- Tests: separate entity; markdown spec with `##` subtasks; scheduled `test_run`
  against ephemeral main preview.
- Project home: feature buckets + action queue; global notifications page.

## Decided (GitHub App)

Separate from the OAuth App used for login (ADR 001): a GitHub **App** handles
project→repo linking. Permissions: Contents (read/write), Pull requests
(read/write), Metadata (read). Setup URL required for post-install redirect.
Implementation reference: [`concepts/github-app.md`](concepts/github-app.md)

## Decided (Orchestrator compute)

**ADR 003 — Orchestrator compute: Kubernetes-based job execution and project
hosting** ([`adr/003-orchestrator-kubernetes.md`](adr/003-orchestrator-kubernetes.md))

- Orchestrator targets **Kubernetes**, not a raw Docker socket; supports both
  self-hosted (bundled k3s by default) and managed deployment, one target
  cluster per Orchestrator instance for MVP.
- Namespace-per-project isolation + sandboxed RuntimeClass (gVisor/Kata) by
  default.
- Each project: one **always-on primary deployment** (stateful, auto-redeploys
  on merge to `main`, no migration safety net yet) + ephemeral **temporary
  deployments** for `spec_grill`/`feature_build`/`test_run`.
- Build contract: **Helm chart** in the primary repo (strict, scaffolded at
  `project_init`) + **Dockerfile** per linked sub-repo; Orchestrator applies
  Helm imperatively.
- Job dispatch transport: **Postgres-backed durable queue**, no broker.
  Orchestrator stays a single "modular monolith" service, 2+ replicas.
- Implementation reference: [`components/orchestrator.md`](components/orchestrator.md),
  [`conventions/deploy.md`](conventions/deploy.md)

## Decided (agent base containers)

**ADR 004 — Agent base container images (Pi integration)**
([`adr/004-agent-base-containers.md`](adr/004-agent-base-containers.md))

- New build-time-only repo `agent-images/` publishes Pi container images to the
  ADR 003 registry; common base layer + one Dockerfile per job kind
  (`spec_grill`/`feature_build`/`test_run`), no runtime service.
- Skills map one-to-one onto job kinds: grill-with-docs-derived skill, an
  unattended "implement" skill, a "run-tests" skill.
- MCP dropped (Pi has no native client); Playwright CLI installed in
  `feature_build` and `test_run` images instead.
- Shared `yggdrasil-contract` Pi extension replaces prose-based turn/completion
  signaling with explicit tool calls (`ask_user`/`submit_adr`,
  `submit_build_result`, `report_test_step`/`submit_test_report`).
- Model config is OpenAI-chat-completions-shaped, per-project, stored
  encrypted in `project_secrets`, delivered as job-pod env vars (same path as
  the GitHub token). Web settings UI is a tracked follow-up.
- `project_init` now scaffolds `docs/CONTEXT.md` + `docs/adr/` into every
  managed project's repo, so `spec_grill` always has a corpus to grill against.

## Still open

→ [`roadmap/open-questions.md`](roadmap/open-questions.md)

## Repo map

| Path | Role |
|------|------|
| `web/` | Next.js UI — no source-of-truth state |
| `api/` | Express API, PostgreSQL, OAuth, sessions |
| `orchestrator/` | Kubernetes-based job runner + project hosting (ADR 003) |
| `agent-images/` | Pi base container images: skills, shared extension, model config (ADR 004) |
| `deploy/` | Docker Compose + nginx (Yggdrasil's own control plane only) |

→ [`CLAUDE.md`](../CLAUDE.md) routing table for task-specific docs.

## ADRs

| # | Title |
|---|-------|
| 001 | [Authentication](adr/001-authentication.md) |
| 002 | [Projects, features, tests, and project UX](adr/002-projects-features-tests.md) |
| 003 | [Orchestrator compute — Kubernetes](adr/003-orchestrator-kubernetes.md) |
| 004 | [Agent base container images](adr/004-agent-base-containers.md) |

→ [`adr/README.md`](adr/README.md)

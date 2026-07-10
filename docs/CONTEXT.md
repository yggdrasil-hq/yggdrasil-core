# Yggdrasil — living context

**Read this when:** you need a quick snapshot of what is **decided** vs **still open**
before diving into code or docs. For details, follow the links — do not treat this
file as the full spec.

Last updated: 2026-07-10

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
| **Model configuration** | The `MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_ID` bundle Pi uses as its OpenAI-chat-completions-compatible backend. Always all three together — never a subset. Not "agent configuration": Pi itself is fixed (ADR 004); only the model it talks to varies. |
| **Account default (model configuration)** | A user's personal fallback model configuration, stored in `user_secrets`. Resolved live at job-dispatch time when a project has no model configuration of its own — not copied into the project at creation. Per-user, not per-instance (no team/org entity exists yet). |

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
- GitHub OAuth for **identity only** (`read:user`); repo access via **GitHub App** (ADR 005).
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

## Decided (GitHub App)

**ADR 005 — GitHub App for repository access**
([`adr/005-github-app-repository-access.md`](adr/005-github-app-repository-access.md))

- Separate from the OAuth App used for login (ADR 001): a GitHub **App** handles
  project→repo linking and job credentials. Permissions: Contents (read/write),
  Pull requests (read/write), Metadata (read). Setup URL required for
  post-install redirect.
- One installation per (app, org/account), shared across projects on that org;
  installation webhooks (`installation`, `installation_repositories`) keep repo
  access in sync.
- Implementation reference: [`concepts/github-app.md`](concepts/github-app.md)

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
- Model config is OpenAI-chat-completions-shaped, stored encrypted, delivered
  as job-pod env vars (same path as the GitHub token). Web settings UI exists
  on the project settings page. Resolution and per-user defaults: ADR 007.
- `project_init` now scaffolds `docs/CONTEXT.md` + `docs/adr/` into every
  managed project's repo, so `spec_grill` always has a corpus to grill against.

## Decided (Pi RPC integration)

**ADR 006 — Pi RPC integration in the Orchestrator**
([`adr/006-pi-rpc-orchestrator-integration.md`](adr/006-pi-rpc-orchestrator-integration.md))

- Scope: `spec_grill` only, backend only (no Web UI yet). `feature_build`/
  `test_run` reuse the same machinery in a later pass.
- The Orchestrator attaches directly to a job pod's stdin/stdout
  (`client-go` `remotecommand`, like `kubectl attach -i`) and speaks Pi's
  JSONL RPC protocol itself — no pod-side bridging service. A single
  `pi --mode rpc` process persists across `ask_user` turns.
- Worker loop becomes internally concurrent (one goroutine per running job,
  capped by a semaphore) instead of one job at a time, synchronously.
- Job payload (feature title + repos) fetched via a new internal API
  endpoint keyed by `feature_id`; repo cloning moves into
  `base/entrypoint.sh`.
- Curated event vocabulary (`agent_text`/`ask_user`/`submit_adr`/
  `run_failed`) relayed to a new `/internal/jobs/:id/events` endpoint;
  mid-run human replies delivered back via Postgres `LISTEN`/`NOTIFY`.
- Kubernetes Job status is no longer the completion signal for RPC-driven
  jobs — the Orchestrator deletes the Job itself on seeing the contract
  extension's terminating tool call.
- Deferred: crash-recovery/reattachment, timeout/token-budget enforcement,
  Web UI.

## Decided (per-user default model configuration)

**ADR 007 — Per-user default model configuration**
([`adr/007-per-user-default-model-configuration.md`](adr/007-per-user-default-model-configuration.md))

- Scope is **per-user**, not per-instance — each user has their own default; no
  shared instance-wide config (no team/org entity exists yet).
- New `user_secrets` table (mirrors `project_secrets`). Resolution is a **live
  fallback** at every dispatch site (project secrets checked first, then the
  owning user's default) — not a snapshot copied at project creation.
- The three model keys are an **all-or-nothing bundle**: a project has none of
  them set (fully inherits) or all three (fully custom); no per-key mixing.
- Every dispatch site (project creation, feature creation, start build,
  `test_run` cron) gates on a resolvable model config. Synchronous requests
  get a 400; `test_run` sets a `model_config_warning` project flag + action
  queue item ("Fix model configuration"), mirroring `github_access_warning`.
- Adds a retry path for a `project_init` feature stuck on a failed/missing
  `spec_grill` once configuration is fixed.

## Still open

→ [`roadmap/open-questions.md`](roadmap/open-questions.md)

## Repo map

| Path | Role |
|------|------|
| `web/` | Next.js UI — no source-of-truth state |
| `api/` | Express API, PostgreSQL, OAuth, GitHub App, sessions |
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
| 005 | [GitHub App repository access](adr/005-github-app-repository-access.md) |
| 006 | [Pi RPC integration in the Orchestrator](adr/006-pi-rpc-orchestrator-integration.md) |
| 007 | [Per-user default model configuration](adr/007-per-user-default-model-configuration.md) |

→ [`adr/README.md`](adr/README.md)

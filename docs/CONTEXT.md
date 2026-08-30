# Yggdrasil — living context

**Read this when:** you need a quick snapshot of what is **decided** vs **still open**
before diving into code or docs. For details, follow the links — do not treat this
file as the full spec.

Last updated: 2026-08-30 (implementation-status audit against ADRs 001-014;
ADR 015 six-stage feature lifecycle and ADR 016 Organization/RBAC/cluster
routing both decided same day)

## Glossary

| Term | Meaning |
|------|---------|
| **GitHub identity** | Proof of who a human is on GitHub (`read:user` OAuth or linked `github_id`). Used only for Yggdrasil login/linking — optional; not required to create projects or complete an App install. |
| **GitHub OAuth App** | Per Yggdrasil instance: separate from the GitHub App. Used only for user identity (`read:user`) — the only sign-in method (ADR 009). Does not grant repo access. |
| **GitHub App installation** | Org or user grants the Yggdrasil GitHub App access to **selected repos**. GitHub allows one installation per (app, org/account) — multiple Yggdrasil projects on the same org **share** that installation; each project picks its own primary + sub-repos from the granted repo list. Adding repos later requires re-configuring the installation on GitHub. Lifecycle kept in sync via **installation webhooks** (`installation`, `installation_repositories`). |
| **Job-scoped GitHub credential** | Short-lived installation access token minted by the API for one Orchestrator run, scoped to the project's linked repos. |
| **Container access tier** | How much GitHub access a job kind gets inside its ephemeral container. `spec_grill`, `test_run`, and `agentic_review` (ADR 015, not yet built): clone + fetch only (read). `feature_build` and `design_grill`: read + write on all linked repos (ADR 014 §3). `spec_grill`'s installation token is minted `contents: read`-scoped (ADR 005 item 16, amended 2026-07-11) — token-level, not just operational (Orchestrator/tool allowlist). `test_run` is still tool-allowlist-only pending its own dispatch implementation; `feature_build` and `design_grill` get a full-permission (`contents: write` + `pull-requests: write`) token. `script_test_run` (ADR 015, not yet built) isn't Pi/RPC-driven at all, but still clones repos with a read-only token. |
| **Action Item** | A requirement `spec_grill` surfaces alongside the ADR (ADR 015) that must be resolved before Implementation can start — env var/secret request, move to `design_grill`, a new blocking subtask feature, or a test request. Each type has its own resolution mechanic; see ADR 015 items 4-6. Persistence + "Start build" gate built (B1); the resolution mechanics wiring is not yet built (B2). |
| **Returned** (feature state) | Unified landing state (ADR 015, built in B1) when a feature is sent back to Implementation with a comment — from Testing failure, Agentic Review `changes_requested`, or Manual Review's human `changes_requested` (ADR 013 webhook). Carries `return_reason` and `return_comment`; requires an explicit human "Resume implementation" click before redispatching. Replaces today's `changes_requested` state. |
| **Agentic Review** | New job kind (ADR 015, not yet built): an agent reviews a feature's diff against its approved ADR, read-only container access, producing an internal `approved`/`changes_requested` verdict — not a real GitHub PR review. Per-project toggle, default on (`projects.agentic_review_enabled`, built in B1). |
| **`script_test_run`** | New, non-agent job kind (ADR 015, not yet built): runs a project's `test-unit.sh`/`test-integration.sh` (optional, structure-standard convention) in a plain container and reads a canonical `.yggdrasil/test-report.json`. No Pi, no skill, no attach/RPC. |
| **Design** | A named, agent-authored, self-contained static HTML mockup (or folder of related mockups) living under a project's `designs/` directory, produced by a `design_grill` session (ADR 014). No app logic beyond self-contained vanilla `<script>` for interaction states — no framework, no build step, no network calls. Not (yet) a persisted DB entity — see `roadmap/open-questions.md` #12. |
| **Feature branch** | Agent branch `yggdrasil/<feature-slug>-<id>`, created on every linked repo the build touches. Same name across repos for one feature. |
| **Coordination PR** | Draft PR on the **primary** repo for a `feature_build`. The human review entry point; links to sibling repo PRs when sub-repos changed. |
| **Repo PR** | Draft PR on a **sub-repo** that received commits during `feature_build`. One per touched sub-repo; opened alongside the coordination PR. |
| **Acting user** | The Yggdrasil user who triggered a job (`spec_grill`, `feature_build`). Feature creator for spec; whoever clicks **Start build** for build. Audit/UX only — does not supply the GitHub credential. Commits and PRs appear as the **GitHub App bot**, not the acting user. |
| **Project installer** | The user who completed the GitHub App install when connecting repos to a project. Recorded for audit; jobs use the installation token, not their personal grant. May need to be a GitHub org admin; non-admins get instructions to involve one. |
| **GitHub App** | Per Yggdrasil instance: the instance admin registers one GitHub App in GitHub (app ID, private key, webhook secret) pointing at that deployment's URLs. Not a shared marketplace app. Repository permissions: Metadata (read), Contents (read & write), Pull requests (read & write). Coexists with a separate **GitHub OAuth App** on the same instance for user identity only. |
| **GitHub access warning** | Project flag set when installation webhooks report revoked/suspended access or removed repos. Jobs fail fast; action queue surfaces "Fix GitHub access" with re-install/configure link. Cleared when access is restored. |
| **GitHub App bot** | The GitHub identity (`yggdrasil[bot]`) that authors commits and opens PRs for all job kinds. Attribution to humans is in Yggdrasil (acting user), not on GitHub. |
| **Model configuration** | The `MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_ID` bundle Pi uses as its OpenAI-chat-completions-compatible backend. Always all three together — never a subset. Not "agent configuration": Pi itself is fixed (ADR 004); only the model it talks to varies. |
| **Account default (model configuration)** | A user's personal fallback model configuration, stored in `user_secrets`. Resolved live at job-dispatch time when a project has no model configuration of its own — not copied into the project at creation. Per-user, not per-instance. **Superseded by ADR 016** (not yet built): replaced by an Organization-level default once that ships. |
| **Organization** | New entity (ADR 016, Track A built in `api/`): a user can belong to several; every user gets a personal one auto-created at signup. Projects belong to exactly one Organization (`organization_id`, replacing `owner_user_id`). Deliberately decoupled from GitHub App installations (ADR 005) — not a 1:1 mirror of a GitHub org. Has its own hard gate, `pending_cluster` → `ready`, mirroring `project_init`'s gate; setting a cluster flips an org to `ready`. |
| **Membership / Role** | New entity (ADR 016, built): a user's membership in an Organization carries exactly one role — Admin, Developer, Designer, Product Manager, or Tester — applying org-wide (every project under that org), not per-project. Capability grants per role are adjustable seed data in `role_capabilities`. |
| **Invite link** | New mechanism (ADR 016, built) for adding a member to an Organization: a token-based shareable URL (org + role baked in), not email or username — the auth model has no email at all (ADR 001/009). Whoever opens it and completes GitHub OAuth is added. |
| **Organization secrets** | New concept (ADR 016, built): a generic key/value store at the Organization level (`organization_secrets`), inherited automatically by every project under it — mirrors `project_secrets`'s shape. A project-level key of the same name shadows the org-level one. |
| **Cluster config** | New Organization-level setting (ADR 016, built; supersedes ADR 003 §3-4): each Organization stores its own encrypted kubeconfig; the Orchestrator resolves a job's target cluster via its project's org at claim time (cached per-org clients, A2). No instance-wide default/env var and no per-project override — whole-org granularity, hard-gated (an org with no cluster configured cannot create any project). |

## Product

AI-orchestrated dev suite for small teams (2–10). Self-hosted; Web + API +
Orchestrator. Phase 1 is built end to end (auth, GitHub App repo access,
project/feature CRUD, `spec_grill`→`feature_build` with Pi RPC integration,
webhook-driven merge/changes-requested/deploy automation). Parts of Phase 2
are also built (live agent chat/steering for `spec_grill`, build-progress UI,
per-org model configuration); `design_grill` (ADR 014) and the six-stage
feature lifecycle job-kind slices for the manual back half (ADR 015) remain
unbuilt, while Organization/RBAC/org-level config/cluster routing (ADR 016,
Track A) is implemented. `test_run` (Phase 3) and live preview tunnels remain
unbuilt.
See `roadmap/phases.md` for the current build-order snapshot. Separately,
`design/` still sketches a larger IA than any of the above has decided —
usage/analytics/allocations surfaces, a landing redesign, per-message grill
resume — see
["Proposed (surfaced by `design/`, not yet decided)"](#proposed-surfaced-by-design-not-yet-decided)
below before assuming any of it is real.

→ [`overview/product.md`](overview/product.md)

## Decided (Phase 1 auth)

**ADR 001 — Authentication** ([`adr/001-authentication.md`](adr/001-authentication.md)),
amended by **ADR 009 — GitHub-only authentication**
([`adr/009-github-only-authentication.md`](adr/009-github-only-authentication.md))

- **GitHub OAuth only** — no username/password, no linking/disconnecting, no
  password rate limiting (ADR 009; pre-launch simplification, no real users to
  migrate).
- No email. Open registration; permanent username (hybrid `pending_username`
  onboarding from the GitHub login); DiceBear **thumbs** avatars (username seed).
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
- **ADR 013 — PR-merge and review-status webhook events**
  ([`adr/013-pr-merge-webhooks.md`](adr/013-pr-merge-webhooks.md)): reverses
  ADR 005's Phase-1 "no PR-merge webhooks" cut. `pull_request` (closed +
  merged) sets a feature `merged` (and completes project_init via
  `projects.markReady`); `pull_request_review` (changes requested) sets
  `changes_requested`, only from `in_review`. Requires the instance admin to
  subscribe the GitHub App to those two events in its GitHub settings.
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

## Decided (per-user default model configuration) — superseded by ADR 016

> **Superseded by [ADR 016](#decided-organization-rbac-org-level-config-and-cluster-routing)**
> (2026-08-30), and **retired by the ADR 016 implementation** (Track A):
> an Organization-level default has replaced this per-user one entirely
> (`organization_secrets` + project → org resolution; the `user_secrets`
> tier / `/settings/account` model editing is gone). What follows is the
> historical decision, kept for the record.

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
- Adds a retry path for a feature stuck on a failed/missing `spec_grill` once
  configuration is fixed. Originally `project_init`-only; generalized to any
  feature type by ADR 012's 2026-08-24 follow-up.

## Decided (project_init grill workflow, structure standard, submodule sub-repos)

**ADR 008 — `project_init` grill workflow, structure standard, and submodule
sub-repos** ([`adr/008-project-init-grill-and-submodule-repos.md`](adr/008-project-init-grill-and-submodule-repos.md))

- `project_init` becomes explicit, not inferred: `FeatureSpec` gains a
  `featureType` field; the Orchestrator's initial prompt branches on it and
  names the exact skill file to read (`project-init` vs. `feature-grill`) —
  no reliance on the model guessing intent from a title string.
- `grill-with-docs` is replaced by two skills: **`project-init`** (interviews
  purpose / tech stack / repo relationships — not "single vs. multi-repo",
  already fixed by the project-creation repo picker — then checks the target
  repo against a bundled structure standard) and **`feature-grill`** (normal
  feature grilling, same substance as before, renamed).
- **Structure standard** every managed project's primary repo must meet:
  `setup.sh` (env/bootstrap/seed, optional), `run.sh` (the one deterministic
  local-run command), `docs/CONTEXT.md` + `docs/adr/` (ADR 004 §14), the Helm
  chart (ADR 003 §12, hosting only — never local dev), and a `CLAUDE.md`/
  `AGENTS.md` router mirroring `templates/child-repo/`. Lives as a bundled
  reference file inside the `project-init` skill, baked in at image build
  time, not fetched live.
- Restructuring a non-conforming existing repo is written into the ADR with
  **no separate mid-grill consent gate** — the existing `spec_ready` → human
  review → Start build gate (ADR 002 §14) is the approval mechanism.
- **Sub-repos become git submodules** of the primary (reversing ADR 002's
  sibling-clone model for customer projects, matching how yggdrasil-core
  nests its own component repos): wired once during `project_init`'s
  `feature_build` via `git submodule add`; `entrypoint.sh` moves to a global
  git URL auth rewrite + `git clone --recurse-submodules`; `feature_build`'s
  Coordination-PR/Repo-PR split is unchanged, with the Coordination PR now
  also bumping the touched submodule's pointer commit. Linking a sub-repo to
  an already-`ready` project later is a tracked follow-up, not solved here.

## Decided (feature_build RPC wiring)

**ADR 010 — Extending Pi RPC wiring to `feature_build`**
([`adr/010-feature-build-rpc-wiring.md`](adr/010-feature-build-rpc-wiring.md))

- Extends ADR 006's attach-driven RPC machinery (previously `spec_grill`-only)
  to `feature_build`: `buildAgentEnv`'s repo/token-fetch gate widens to both
  job kinds; `runInCluster`'s routing sends any kind with a real image
  configured through the attach-driven path, not just `spec_grill`.
- New `submit_build_result` curated event (terminal): success moves the
  feature `running` → `in_review` and stores the PR URL; failure matches
  `run_failed`'s existing handling.
- The internal feature-spec endpoint grows a `kind` param: `feature_build`
  gets `adrMarkdown`/`branch` in the response and a `contents:write` +
  `pull-requests:write` token, vs. `spec_grill`'s `contents:read`.
- `entrypoint.sh` checks out the feature branch and writes the approved ADR
  to `/workspace/.yggdrasil/adr.md` when `FEATURE_BRANCH`/`ADR_MARKDOWN` are
  set — no-ops for `spec_grill`.
- Deferred: `test_run` wiring, crash recovery, Web app surface for
  `feature_build`'s live state.

## Decided (feature `running` state)

**ADR 011 — Feature `running` state: closing the queued → running gap**
([`adr/011-feature-build-running-state.md`](adr/011-feature-build-running-state.md))

- Closes a gap ADR 010 surfaced but didn't solve: nothing ever wrote
  `features.status = 'running'` when a `feature_build` job actually started
  (`jobs.status` already did, via `queue.Claim` — a different column).
- New synthesized (not Pi-decoded) curated event `run_started`, fired once
  in `runAgentRPCJob` right after `k8s.WaitForJobPod` confirms the pod is up
  — the one call site shared by both `spec_grill` and `feature_build`, no
  `job.Kind` branch needed.
- `FeatureRepository.setRunning` is a **guarded** `UPDATE ... WHERE status =
  'queued'` — a new precedent vs. the file's other (unguarded) transition
  methods. The guard does double duty: it's also what makes `run_started`
  safe to fire unconditionally for `spec_grill` too (a no-op there, since
  that job kind's feature sits in `draft`, not `queued`).
- Also fixes an adjacent silent-failure gap: if `WaitForJobPod` itself
  errors, a `run_failed` event is now synthesized there too, instead of the
  feature being left stuck in `queued` forever with no event ever posted.
- Web UI now distinguishes `queued` from `running` (`BuildProgressPanel`,
  added after this ADR shipped — see ADR 011's item 8 amendment). Still
  deferred: `test_run`'s equivalent running-state gap.

## Decided (`spec_grill` retry state reset)

**ADR 012 — `spec_grill` retry status reset and live retry feedback**
([`adr/012-spec-grill-retry-state-reset.md`](adr/012-spec-grill-retry-state-reset.md))

- Retrying a failed/stuck `spec_grill` (including `project_init`'s) always
  dispatches a **new job row** — the old one kept as history, never
  reused/mutated — and the feature's status is explicitly reset so the
  retried run re-enters the same driven state machine as a first attempt.

## Decided (PR-merge and review-status webhooks)

**ADR 013 — PR-merge and review-status webhook events**
([`adr/013-pr-merge-webhooks.md`](adr/013-pr-merge-webhooks.md))

- Reverses ADR 005's Phase-1 "no PR-merge webhooks" cut. `pull_request`
  (closed + merged) sets a feature `merged` (and completes `project_init` via
  `projects.markReady`); `pull_request_review` (changes requested) sets
  `changes_requested`, only from `in_review`.
- Also guarantees a project's first `deploy` job actually fires, and adds
  deploy status feedback + a manual "Deploy now" trigger in the Web app.
- Requires the instance admin to subscribe the GitHub App to the `pull
  request` and `pull request review` events in its GitHub settings — not
  automatic on upgrade.

## Decided (design sessions)

**ADR 014 — `design_grill`: agent-authored live HTML mockup sessions**
([`adr/014-design-grill-live-mockups.md`](adr/014-design-grill-live-mockups.md))

- New job kind, sibling to `spec_grill`, reusing ADR 006's attach/RPC
  machinery wholesale. Produces self-contained static HTML/CSS (+ vanilla JS)
  mockups under a project's `designs/<slug>/` folder — one live chat session,
  no separate spec/build split, commits and opens a PR itself on finalize.
- Live preview has **no hosting**: the Web app polls snapshot events (like
  `spec_grill`'s chat) and renders them in a tabbed, sandboxed iframe.
- `project_init`'s repo-relationship interview gains a "does this project
  have a web/mobile UI" branch (ADR 008 amendment); `designs/` is only
  scaffolded, and `design_grill` only offered, when that's true.
- `feature-grill` is told to check `designs/` during normal exploration —
  implicit discovery, no structured link.
- **Left open:** whether a Design becomes a persisted DB entity or stays a
  pure repo convention (`roadmap/open-questions.md` #12).
- **Implementation status:** decided/accepted, but **not yet built**. As of
  2026-08-30, `orchestrator/` has no `design_grill` job kind or curated-event
  handling, `agent-images/` has no `design_grill` image/skill/contract
  tools, and `web/` has no design-session UI. Everything in this ADR is the
  design, not shipped behavior — see `concepts/job-dispatch.md` and
  `concepts/pi-agent.md`.

## Decided (six-stage feature lifecycle)

**ADR 015 — Six-stage feature lifecycle: Action Items, Testing, and Agentic
Review** ([`adr/015-six-stage-feature-lifecycle.md`](adr/015-six-stage-feature-lifecycle.md))

- Replaces ADR 002's `draft → spec_ready → queued → running → in_review →
  merged` model with six stages: **Spec → Action Items → Implementation →
  Testing → Agentic Review → Manual Review**. Three new states
  (`testing`, `agentic_review`, `returned`); `changes_requested` retired in
  favor of `returned`. "Action Items" and "Manual Review" are UI views of
  existing states (`spec_ready` and `in_review`/`returned`/`merged`
  respectively), not new states themselves.
- **Action Items** (see glossary) are generated once per `spec_grill` run,
  alongside the ADR; "Start build" stays gated until all are resolved.
- **`feature_build` stays fully unattended** — no new interactive tool. A new
  terminal tool, `request_action_item`, kicks a blocked build back to a fresh
  `spec_grill` run (landing in `draft`, seeded with the prior ADR + grill
  summary + kickback reason) — distinct from a generic crash, which still
  lands in `failed` (ADR 012 retry, unchanged).
- **Testing** splits: Agentic extends `test_run` with an on-demand trigger
  against the feature's branch; Unit/Integration are a **new, non-agent** job
  kind, `script_test_run` — deterministic script + canonical JSON report,
  zero Pi/RPC involvement (a second non-agent job kind, after `deploy`).
- **Agentic Review** is a brand-new job kind — read-only tier, reuses ADR
  006's attach/RPC machinery, internal-only verdict (never a real GitHub PR
  review, to avoid colliding with ADR 013's webhook). Per-project toggle,
  default on.
- **`returned`** unifies all three "sent back to Implementation" triggers
  (test failure, Agentic Review rejection, human PR review) behind one
  state + reason field; always requires an explicit human click to resume —
  no unattended retry loop.
- **Implementation status:** partially built (Track B, `docs/roadmap/adr-015-016-build-plan.md`).
  Slices **B1-B3 + B6** are in: the six-stage state machine
  (`testing`/`agentic_review`/`returned`, `changes_requested` retired),
  `feature_action_items` with the secret-auto-resolve/subtask-merge/test
  resolution paths, build-success → `testing`, `returned` re-entry on human
  PR review, the "Resume implementation" endpoint, and "Start build" gating
  on resolved Action Items; the `request_action_item` kickback contract
  (orchestrator curated event + API `draft` reset + fresh `spec_grill`
  re-dispatch) and the `submit_review` contract (orchestrator event + API
  `approved`→`in_review` / `changes_requested`→`returned`), plus the
  `script_test_run`/`agentic_review` job-kind routing and image config. The
  Web Action Items + returned/resume UI is in. **Not yet built:** B4
  (on-demand `test_run` with `ref`), the `agent-images/` Docker
  images/skills/contract tools for `request_action_item`/`submit_review`/
  `script_test_run`, B5's report schema + Testing tab, and the Agentic
  Review / Manual Review tab UIs.

## Decided (Organization, RBAC, org-level config, and cluster routing)

**ADR 016 — Organization entity, RBAC, org-level provider/secret config, and
per-org cluster routing**
([`adr/016-organization-rbac-and-cluster-routing.md`](adr/016-organization-rbac-and-cluster-routing.md))

- New **Organization** entity: a user can belong to several; every user gets
  a personal one auto-created at signup (no setup ceremony for solo/small-team
  use). Project ownership moves from `owner_user_id` to `organization_id`.
  Deliberately **decoupled from the GitHub App installation model** (ADR 005)
  — a project's repos can come from any installation the org's members have
  access to.
- **Invites are shareable links**, not email or username — the existing auth
  model has no email at all (ADR 001/009). An org admin generates a
  token-based link (org + role baked in); whoever opens it and completes
  GitHub OAuth is added.
- **Five roles** (Admin/Developer/Designer/Product Manager/Tester),
  **org-wide scope** (one role per membership, applies to every project under
  that org — no per-project override). Capability grants are adjustable seed
  data, not hardcoded logic.
- **Retires ADR 007 outright** — org-level config replaces the per-user
  default entirely (`project_secrets` → org config, no user-level fallback).
  Same all-or-nothing three-key bundle rule as before, just with org as the
  fallback tier.
- **Org-level secrets** (generic key/value): every project under an org
  inherits them automatically; project-level value wins on a name collision.
- **Cluster routing supersedes ADR 003 §3-4**: the instance-wide
  `KUBECONFIG_HOST_PATH` env var and bundled-k3s-by-default auto-selection
  are removed outright — **no platform-default cluster**. Every Organization
  must explicitly configure its own cluster (hard gate,
  `pending_cluster` → `ready`, mirroring `project_init`'s gate) before
  creating any project. Whole-org granularity — no per-project override.
- **Implementation status:** substantially built (Track A, `docs/roadmap/adr-015-016-build-plan.md`).
  A1-A4 land in `api/` (Organization entity, memberships/invites/roles +
  capability matrix, per-org encrypted kubeconfig + cluster gate,
  `organization_id` project ownership, org-level model/secrets config), A2
  lands in `orchestrator/` (dynamic cached per-org Kubernetes client
  resolution, `KUBECONFIG_HOST_PATH`/bundled-k3s removed) and `deploy/`, and
  A5 lands in `web/` (org settings pages, org switcher links, invite-accept,
  account model section made read-only). The deployment env templates no
  longer mount a per-instance kubeconfig.

## Proposed (surfaced by `design/`, not yet decided)

`design/` (the meta-repo wireframe directory, see
[`conventions/design-wireframes.md`](conventions/design-wireframes.md)) is
the current source of truth for **where the Web app's IA is headed** — every
page's own `.design-note` states precisely what it maps to, what's faked, and
what's grounded vs. invented. That directory now sketches a substantially
larger product surface than anything below has decided or built. **None of
what follows is implemented; none of it has an ADR** (the Organization/RBAC/
provider/cluster group formerly listed here is now decided — see
"Decided (Organization, RBAC, org-level config, and cluster routing)"
above). This section is a rollup for agents who want the summary without
opening every wireframe — the per-page `.design-note` is still the
authoritative detail on each point.

- **Token usage tracking + resource allocation caps.** `design/usage`,
  `design/analytics`, and `design/allocations/{infra,api}` (org, project, and
  account-level views) assume the API/Orchestrator log a token count and
  duration per job and expose cluster/spend telemetry — none of that exists
  today, at any level. `roadmap/phases.md` Phase 4's "token budgets" is the
  spend-cap half of this (`allocations/api`); consumption *reporting*
  (`usage`, `analytics`) is a distinct, equally unbuilt feature. `infrastructure`
  (org-only cluster status) and `allocations/infra` (per-project k8s
  ResourceQuota) are grounded in ADR 003's real namespace-per-project
  isolation but assume a live cluster-telemetry API that doesn't exist. See
  `roadmap/open-questions.md` #15.
- **Sidebar-first IA.** Every hub page (Projects, Notifications, Account/
  Organization settings, New project) now shares the same persistent
  `.sidebar`/`.main` shell as project pages (Vercel-style: org switcher above
  the nav, account cell below it) — replacing the old top-bar-only
  `.hub-header` pattern. Layout-only itself, no separate decision needed — but
  the org switcher it depicts now has a real entity behind it (ADR 016's
  Organization, above), where before it was purely speculative chrome.
- **Landing page redesign.** `design/landing/` is a full proposed copy/IA
  rework of the marketing site — positioning around safety/security, a
  6-step "how it works," a "no lock-in" (BYOK/BYOI/BYOG) section. The real
  `landing/` page today is just a logo + one-line tagline splash; nothing in
  the redesign is live.
- **Per-message grill resume/restart.** `design/projects/detail/features/detail/spec`
  adds "Resume from here" / "Restart from here" on individual grill-transcript
  messages, plus a "Stop" control. ADR 006 covers mid-run reply delivery and
  ADR 012 covers job-level retry, but neither operates at the granularity of
  one transcript message — this would need new API surface and a new
  Orchestrator/Pi contract. See `roadmap/open-questions.md` #17.

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
| 008 | [`project_init` grill workflow, structure standard, and submodule sub-repos](adr/008-project-init-grill-and-submodule-repos.md) |
| 009 | [GitHub-only authentication (remove username/password)](adr/009-github-only-authentication.md) |
| 010 | [Extending Pi RPC wiring to `feature_build`](adr/010-feature-build-rpc-wiring.md) |
| 011 | [Feature `running` state — closing the queued → running gap](adr/011-feature-build-running-state.md) |
| 012 | [`spec_grill` retry status reset and live retry feedback](adr/012-spec-grill-retry-state-reset.md) |
| 013 | [PR-merge and review-status webhook events](adr/013-pr-merge-webhooks.md) |
| 014 | [`design_grill` — agent-authored live HTML mockup sessions](adr/014-design-grill-live-mockups.md) |
| 015 | [Six-stage feature lifecycle — Action Items, Testing, and Agentic Review](adr/015-six-stage-feature-lifecycle.md) |
| 016 | [Organization entity, RBAC, org-level provider/secret config, and per-org cluster routing](adr/016-organization-rbac-and-cluster-routing.md) |

→ [`adr/README.md`](adr/README.md)

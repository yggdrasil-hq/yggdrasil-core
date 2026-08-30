# Build plan: ADR 015 (six-stage feature lifecycle) + ADR 016 (Organization/RBAC/cluster routing)

**Read this when:** you're picking up implementation work on either ADR 015
or ADR 016 and need to know what order to build in, what each slice
delivers, and what it depends on.
**Skip if:** you just need the decisions themselves — see the ADRs directly.

> Both ADRs are **decided, not built** as of 2026-08-30 (see `docs/CONTEXT.md`).
> This doc turns them into ordered, independently-shippable slices — roughly
> PR-sized, not a full task breakdown. Each slice names its repos, what it
> delivers, and what it depends on. No migration paths are included anywhere
> below — the application has no live deployment yet.

## How to read this

Two tracks, **A** (ADR 016) and **B** (ADR 015), are largely independent of
each other — Track B's Feature state machine doesn't care whether a Project
is owned by a user or an Organization. They're ordered here as one combined
sequence for narrative simplicity (this is a small team, likely working
sequentially, not two separate workstreams), but if there's capacity to
parallelize, **Track B can start anytime after A1**, in parallel with the
rest of Track A. Dependencies are called out per slice regardless.

Track A goes first overall because it changes the foundational ownership
model (`owner_user_id` → `organization_id`) that everything else — including
new Track B work — ends up sitting on top of; doing it first avoids
rebasing Track B's work onto a moving foundation.

## Track A — ADR 016 (Organization, RBAC, org-level config, cluster routing)

| # | Slice | Repo(s) | Depends on | Delivers |
|---|-------|---------|------------|----------|
| A1 | **Org core schema + API** | `api/` | — | `organizations`, `organization_memberships`, `organization_invites` tables. Personal-org auto-creation at signup. Invite-link generate/accept endpoints. Role → capability seed data (5 roles). **No cluster gate enforcement yet, no project ownership change yet** — pure new data model, additive only. |
| A2 | **Cluster config + hard gate** | `api/`, `orchestrator/` | A1 | `organizations.status` (`pending_cluster`→`ready`) + encrypted kubeconfig storage. API enforces the gate on project creation. **Removes `KUBECONFIG_HOST_PATH` and the bundled-k3s-by-default auto-selection entirely** (`orchestrator/cmd/server/main.go`, `deploy/` env templates, `docs/conventions/deploy.md`). Orchestrator's worker loop gains dynamic per-org Kubernetes client resolution, replacing its single static client. This is the riskiest/most invasive slice in Track A — budget accordingly. |
| A3 | **Project ownership migration: `owner_user_id` → `organization_id`** | `api/`, `web/` | A1, A2 | Project model, queries, and authorization all become org-scoped. Role-based authorization (the capability matrix from A1) enforced on project-level actions. |
| A4 | **Org-level provider/secret config, retires ADR 007** | `api/`, `web/` | A3 | Org-level model-config + generic-secrets tables. Resolution becomes project → org (no `user_secrets`, no per-user tier). `/settings/account`'s model section becomes read-only. Project-creation wizard and a project's own Settings → Models/Secrets update to resolve against the org. |
| A5 | **Web: Organization UI** | `web/` | A1-A4 | Org switcher (sidebar), Settings → Organization (General / Members / Providers / Secrets / Cluster) pages, invite-accept flow. Also where the `design/`-sketched **sidebar-first IA** lands (no separate ADR needed — layout-only) since it's the natural home for this work. |

## Track B — ADR 015 (six-stage feature lifecycle)

| # | Slice | Repo(s) | Depends on | Delivers |
|---|-------|---------|------------|----------|
| B1 | **Feature state machine extension** | `api/` | A1 (can start once Track A is underway; doesn't need it finished) | New states (`testing`, `agentic_review`, `returned`) + `return_reason`/`return_comment`. New `feature_action_items` table, `features.parent_feature_id`, `projects.agentic_review_enabled`. Action queue gains "Resume implementation" / Action Item rows. |
| B2 | **Action Items in `spec_grill`** | `agent-images/`, `api/`, `web/` | B1 | `submit_adr` gains an `actionItems` field. All four resolution mechanics wired: env var/secret auto-resolve (poll `project_secrets`), move-to-`design_grill` (snapshot attached to next grill context), blocking subtask feature (auto-created, parent resolves on `merged`), test request (synchronous, human-supervised). "Start build" gated on all resolved. Web Action Items view. |
| B3 | **`feature_build` kickback path** | `agent-images/`, `orchestrator/`, `api/` | B1 (parallelizable with B2) | New terminal tool `request_action_item`, distinct from generic crash/`run_failed`. Orchestrator dispatches a context-seeded `spec_grill` (previous ADR + grill-transcript summary + kickback reason) on kickback; feature lands back in `draft`. |
| B4 | **Testing stage: Agentic** | `orchestrator/`, `api/`, `web/` | B1 (parallelizable with B2/B3) | `test_run` job spec gains a `ref` field and an on-demand (non-cron) trigger, targeting an ephemeral deployment of the feature's own branch. Testing tab UI (Agentic group). |
| B5 | **Testing stage: Unit/Integration (`script_test_run`)** | `agent-images/`, `orchestrator/`, `api/`, `web/` | B1 (parallelizable with B4) | New non-agent job kind + lightweight (no-Pi) image. Structure standard gains `test-unit.sh`/`test-integration.sh` convention (amends ADR 008 §6). Canonical `.yggdrasil/test-report.json` schema, read and rendered (pass/fail/skip counts, coverage %, failing tests) — never framework-parsed. Testing tab UI (Unit/Integration groups). |
| B6 | **Agentic Review job kind** | `agent-images/`, `orchestrator/`, `api/`, `web/` | B4, B5 | New job kind reusing ADR 006's attach/RPC machinery; read-only container tier. New terminal tool `submit_review({verdict, comment})` — internal verdict, never a real GitHub PR review. Per-project toggle (`agentic_review_enabled`, default on). Agentic Review tab UI. |
| B7 | **Unified `returned` state + Manual Review UI** | `api/`, `web/` | B3, B6 (needs all three trigger sources: Testing, Agentic Review, human PR review) | Wires Testing failure, Agentic Review `changes_requested`, and the existing ADR 013 human-review webhook into one `returned` state + reason. "Resume implementation" action (human-gated, no auto-retry). Manual Review tab groups `in_review`/`returned`/`merged`. Retires `changes_requested` as a state name. |

## Cross-track notes

- **No slice here touches `landing/`** — the `design/landing/` redesign
  needs no ADR and isn't sequenced against either track; it can happen
  anytime, independently.
- **Track B does not depend on Track A finishing.** The ordering above (A
  before B) is a sequencing choice for a single-threaded team, not a hard
  dependency — B1 only needs A1's org tables to exist so `spec_grill`/
  `feature_build` job payloads have *something* to key project ownership on,
  not the full org/RBAC/provider surface.
- **A2 is the highest-risk slice in either track** — it's the only one that
  removes an existing, currently-load-bearing mechanism
  (`KUBECONFIG_HOST_PATH`) rather than purely adding new surface. Consider
  doing it in isolation, with the Orchestrator's existing job-dispatch tests
  as a regression gate, before layering A3-A5 on top.
- **Every job kind added or extended here** (`script_test_run`,
  `agentic_review`, extended `test_run`, extended `spec_grill`/
  `feature_build`) needs a corresponding update to
  `docs/concepts/job-dispatch.md` and `docs/concepts/pi-agent.md` if new
  contract tools are introduced — both already updated for the *design*
  (ADR 015/016 themselves); re-check them for drift once code actually
  lands, per `docs/conventions/documentation-guide.md` rule 6.

## What this doc is not

This is a build **order**, not a spec. Each slice's actual implementation —
exact schema, exact API routes, exact UI copy — should reference the ADR
directly ([015](../adr/015-six-stage-feature-lifecycle.md),
[016](../adr/016-organization-rbac-and-cluster-routing.md)) and the relevant
`concepts/` doc (`feature-lifecycle.md`, `job-dispatch.md`,
`project-settings.md`), not this file.

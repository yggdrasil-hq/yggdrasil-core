# Concept: feature lifecycle

**Read this when:** you touch feature states, transitions, or the state machine
(Web status display, API persistence, Orchestrator run outcomes).
**Skip if:** you don't deal with feature status at all.

> **Authoritative states, current behavior:** ADR 002 (`docs/adr/002-projects-features-tests.md`).
> **Authoritative states, decided target model:** ADR 015
> (`docs/adr/015-six-stage-feature-lifecycle.md`) — six stages (Spec → Action
> Items → Implementation → Testing → Agentic Review → Manual Review).
> **Implementation:** the state machine itself (B1 of the build plan) is built
> in `api/`: `testing`/`agentic_review`/`returned`, `feature_action_items`,
> build-success → `testing`, agentic `test_run` dispatch/report aggregation,
> `returned` on test or human PR review, and "Resume implementation". The
> non-agent `script_test_run` path remains separate B5 work.
> Not touched by ADR 015: Org/RBAC (`roadmap/open-questions.md` #13) and
> per-message grill resume/restart (`roadmap/open-questions.md` #17) remain
> undecided.

## What a feature is

A user-described unit of work for the agent to build. Each feature goes through a
**spec phase** (grill-me → ADR) and a **build phase** (implementation → PR).
Each build maps to a branch `yggdrasil/<feature-slug>-<id>` and a draft PR on the
**primary repository**.

Special type **`project_init`** — auto-created on project setup; same lifecycle,
templated grill prompt. Project stays `initializing` until this feature merges.

Not a Feature: **Design sessions** (`design_grill`) are a separate, sibling job
kind with their own single-phase flow — no ADR, no spec/build split. See
[ADR 014](../adr/014-design-grill-live-mockups.md).

## Current model (implemented)

### Two job phases

| Phase | Job kind | Feature states | Output |
|-------|----------|----------------|--------|
| Spec | `spec_grill` | `draft` → `spec_ready` | ADR stored on feature record (API) |
| Build | `feature_build` | `spec_ready` → `queued` → `running` → `testing` → … | Code + ADR commit on feature branch |
| Agentic Testing | `test_run` | `testing` → `agentic_review` / `in_review` | Feature-branch preview and structured step/report events |

User must explicitly approve the ADR and click **Start build** to dispatch
`feature_build`. Spec and build use **separate containers**.

### States and transitions

```
draft → spec_ready → queued → running → testing → agentic_review → in_review → merged
                          │        │          │          │              │
                          │        ├──► failed └──► returned ──(resume)→ queued
                          │        └──► cancelled
                          └──► cancelled
```

| State | Meaning |
|-------|---------|
| `draft` | `spec_grill` in progress or awaiting user reply in grill chat. |
| `spec_ready` | ADR generated; awaiting human review and build approval. |
| `queued` | Build approved (with no unresolved Action Items); waiting for Orchestrator capacity. |
| `running` | `feature_build` job active; events streaming. |
| `testing` | Auto-entered the instant a build succeeds; enabled agentic tests run against the feature branch here. |
| `agentic_review` | (ADR 015) auto-entered when all enabled Testing passes, if the per-project toggle is on. |
| `in_review` | Build + gates finished; draft PR ready for human review. |
| `returned` | (ADR 015, replaced `changes_requested`) sent back to Implementation with a comment — from `test_failure`, `agentic_review`, or `human_review` (the ADR 013 webhook). Carries `return_reason`/`return_comment`; requires an explicit human "Resume implementation" click to redispatch. |
| `merged` | PR merged. Set by the `pull_request` webhook (ADR 013) when the feature's tracked PR closes with `merged: true`. |
| `failed` | Build/job errored (includes infra-level Testing/Review container crashes — those are NOT `returned`, ADR 015 item 19). |
| `cancelled` | Spec or build was stopped. |

### Project home buckets

| Bucket | States |
|--------|--------|
| **Planned** | `draft`, `spec_ready` |
| **Being worked on** | `queued`, `running`, `testing`, `agentic_review`, `in_review`, `returned`, `failed` |
| **Completed** | `merged`, `cancelled` |

## Remaining target model (ADR 015)

### States and transitions

```
draft → spec_ready → queued → running → testing → agentic_review → in_review → merged
  │         │(*)         │        │         │            │              │
  │         │            │        └─►returned◄───────────┴──────────────┘
  │         │            │        (reason: test_failure | agentic_review | human_review)
  │         │            └─►failed   (generic crash/bug — unchanged, ADR 012 retry)
  │         └─►cancelled
  └─►cancelled

returned → [human clicks "Resume implementation"] → queued
```

(*) `spec_ready` covers both the "Spec" and "Action Items" wireframe stages —
Action Items is a UI view of `spec_ready`, not a new state; "Start build"
stays disabled until every Action Item on the batch resolves.

### Six stages → states/mechanics

| Stage | State(s) | What's new |
|-------|----------|------------|
| Spec | `draft`, `spec_ready` | `spec_grill`'s `submit_adr` gains an optional Action Items batch. Can also be re-entered via a kickback from Implementation (below) — same `draft` state, seeded with the previous ADR, a grill-transcript summary, and the kickback reason. |
| Action Items | `spec_ready` (UI view) | Four types (env var/secret, move to `design_grill`, blocking subtask feature, test request), each with its own resolution mechanic — see ADR 015 items 4-6. "Start build" gates on all being resolved. |
| Implementation | `queued`, `running`, `failed`, `returned` | `feature_build` gains a new terminal tool, `request_action_item`, called when the agent is blocked on something only a human/another job can supply — distinct from a generic crash (`failed`, unchanged). This is the only path that kicks back to Spec (ADR 015 items 7-8). |
| Testing | `testing` | Agentic group extends `test_run` with an on-demand trigger against the feature's branch (not `main`). Unit/Integration are a **new, non-agent** job kind `script_test_run` — runs `test-unit.sh`/`test-integration.sh` (optional, structure-standard convention) in a plain container, reads a canonical `.yggdrasil/test-report.json`. |
| Agentic Review | `agentic_review` | New job kind, read-only tier, reuses ADR 006 attach/RPC machinery. New terminal tool `submit_review({verdict, comment})` — an internal verdict, not a real GitHub PR review. Per-project toggle, default on. |
| Manual Review | `in_review`, `returned`, `merged` | Unchanged mechanically (ADR 013's webhooks) — a UI grouping of existing states, now gated behind Agentic Review instead of being the second-of-three-phases finish line. |

### The unified `returned` state

Testing failure, Agentic Review `changes_requested`, and Manual Review's
human `changes_requested` (ADR 013 webhook) all land in one state:
`returned`, with `return_reason` (`test_failure` | `agentic_review` |
`human_review`) and `return_comment`. Requires an explicit human "Resume
implementation" click to redispatch — no auto-retry loop, for any of the
three reasons. Replaces today's `changes_requested` state outright
(migration: existing rows rename to `returned` / `reason: human_review`).

### New job kinds

- **`agentic_review`** — Pi/RPC-driven, read-only container tier.
- **`script_test_run`** — not agent-driven at all; runs a deterministic
  script and reads a JSON report file. See `docs/concepts/job-dispatch.md`.

Full mechanics, every resolved trade-off, and rejected alternatives:
[ADR 015](../adr/015-six-stage-feature-lifecycle.md).

## Project home buckets

Unchanged bucket concept; once ADR 015 ships, "Being worked on" additionally
covers `testing`, `agentic_review`, and `returned`.

## TODO

- ~~Define who/what triggers each transition (user action vs. Orchestrator event vs.
  PR webhook) in API implementation.~~ Done for `in_review → merged` /
  `in_review → changes_requested` (ADR 013, `pull_request` /
  `pull_request_review` webhooks). All other transitions are Orchestrator
  curated events or direct user action, both already implemented.
- ~~Re-grill / ADR revision workflow after `spec_ready`.~~ Decided by
  ADR 015 for the "Implementation is blocked" case (kickback to `draft`
  with context). A human-initiated re-grill while still in `spec_ready`
  (before any build was attempted) remains undecided.
- A closed-without-merge PR has no lifecycle representation (ADR 013,
  deliberately left open).
- B5's `script_test_run` path and the remaining Agentic Review image/UI work
  are still pending — see ADR 015's Follow-ups section for what's explicitly
  out of scope (kickback-context growth cap,
  blocking-subtask recursion guard, Agentic Review Web UI beyond the
  Returned view).

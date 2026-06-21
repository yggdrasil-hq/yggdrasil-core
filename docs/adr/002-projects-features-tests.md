# ADR 002: Projects, features, tests, and project UX

**Status:** Accepted  
**Date:** 2026-06-22  
**Deciders:** Product/design session (grill-me)

## Context

Yggdrasil needs a domain model for how users organize work: **projects** (linked
GitHub repos), **features** (agent-built units of work), and **tests** (scheduled
AI-driven verification). The Web app needs project-level surfaces — a home page
with progress summaries, an action queue for blocked work, and a global notifications
feed.

Prior state:

- Glossary named projects, features, and test suites but lacked concrete models.
- Feature lifecycle states were placeholders (`docs/concepts/feature-lifecycle.md`).
- Multi-repo handling was open question #3 (`docs/roadmap/open-questions.md`).
- Job dispatch listed `feature_build` and `test_run` but not the spec/grill phase.

Constraints:

- Phase 1 auth uses progressive GitHub OAuth scopes (ADR 001); repo access requires
  `repo` scope for every linked repository.
- Orchestrator is stateless — job specs must carry everything needed for a run.
- Self-hosted, small-team product; no email notifications in v1.

## Decision

### Projects and repositories

1. A **project** has one **primary repository** (coordination root — branches, PRs,
   project identity) and zero or more **linked sub-repositories** (dependencies
   cloned alongside the primary).
2. When linking repos, OAuth requests **`repo` scope for all linked repos** (progressive
   upgrade per ADR 001).
3. **Every feature and test run clones all linked repos** — no per-feature repo
   scoping. Simple single-repo projects are the degenerate case (primary only).
4. Project status: **`initializing`** until project init completes, then **`ready`**.

### Project initialization (hard gate)

5. On project creation, the system auto-creates a **`project_init`** feature and
   immediately dispatches a **`spec_grill`** job (see below).
6. While status is **`initializing`**, the project **cannot** create other features,
   define tests, or dispatch non-init jobs.
7. Project init uses the **same feature workflow** as normal features, with a fixed
   type and templated grill prompt (“bootstrap/adapt this codebase for Yggdrasil”).
8. Project flips to **`ready`** when the `project_init` feature reaches **`merged`**.

### Features vs tests

9. **Features** and **tests** are **separate entities** with different lifecycles:
   - **Feature** — build work: spec → implementation → PR → merge.
   - **Test** — verification work: markdown scenario run on a schedule against
     `main`.
10. Tests are **not** a kind of feature.

### Feature workflow (two job phases)

11. Creating a feature requires only a **title** (heading). The API creates the
    feature in **`draft`** and dispatches **`spec_grill`**.
12. **`spec_grill` job:** Orchestrator spins up a container with all linked repos.
    An agent explores the codebase, conducts a grill-me conversation with the user,
    and generates an **ADR** as the feature spec.
13. When grilling completes, the feature moves to **`spec_ready`**. The ADR is stored
    on the **feature record in the API** (markdown). Nothing is committed to GitHub
    during review.
14. The user reviews (and may edit) the ADR in the Web app, then marks it **ready to
    work on** and clicks **Start build**.
15. **`feature_build` job:** A **fresh container** receives the approved ADR as the
    implementation contract. The agent implements, opens a draft PR on the primary
    repo, and **commits the ADR** to `docs/adr/NNN-<slug>.md` on the feature branch.
16. Spec and build are **two separate jobs** — the spec container is torn down after
    grilling; build gets a new container.

### Feature lifecycle states

```
draft → spec_ready → queued → running → in_review → merged
                         │        │          │
                         │        ├──► failed └──► changes_requested → queued
                         │        └──► cancelled
                         └──► cancelled
```

| State | Meaning |
|-------|---------|
| `draft` | Spec grill in progress (`spec_grill` job active or awaiting user reply). |
| `spec_ready` | ADR generated; awaiting human review and build approval. |
| `queued` | Build approved; waiting for Orchestrator capacity. |
| `running` | `feature_build` job active. |
| `in_review` | Build finished; draft PR ready for human review. |
| `changes_requested` | Reviewer requested changes; can re-run build. |
| `merged` | PR merged. |
| `failed` / `cancelled` | Build errored / was stopped. |

Implementation reference: `docs/concepts/feature-lifecycle.md`.

### Project home — feature count buckets

| Bucket | States |
|--------|--------|
| **Planned** | `draft`, `spec_ready` |
| **Being worked on** | `queued`, `running`, `in_review`, `changes_requested`, `failed` |
| **Completed** | `merged`, `cancelled` |

### Project home — action queue

A per-project **action queue** surfaces items blocking progress until a human acts:

| Action type | When |
|-------------|------|
| Grill response needed | Agent asked a question during `spec_grill` (`draft`) |
| ADR review | Grill finished; feature in `spec_ready` |
| Start build | ADR approved but build not yet dispatched |
| PR review | Feature in `in_review` |
| Changes requested | Reviewer requested PR changes |
| Test failure | Scheduled test run failed (any step) |
| Failed build | Feature in `failed` |

Sorted oldest-first. Each row deep-links to the relevant surface.

### Notifications (global)

17. A **notifications page** lists informational events **across all projects**:
    build completed/failed, test run completed/failed, PR merged, project init
    complete, non-blocking agent messages during runs.
18. **In-app only in v1** — no email or push.
19. Action-queue items **also emit notifications** when they appear, so users see
    blocking work globally even when not on the project home page.
20. Notifications are an audit trail; the action queue remains the canonical
    “what needs my decision now” surface.

### Tests

21. A **test** belongs to a project and consists of: **name**, **markdown spec**,
    **schedule**, and **enabled/disabled** toggle.
22. **Subtasks** are `##` sections in the markdown spec — not separate persisted
    entities. The agent follows them in order.
23. **Scheduling:** presets (hourly, every 6 hours, daily, weekly) plus optional
    custom cron expression. Minimum interval: **1 hour**. Overlapping runs for the
    same test are **skipped** (do not stack).
24. On schedule fire, the API dispatches a **`test_run`** job. The Orchestrator:
    clones all linked repos at **`main`**, builds and exposes an **ephemeral preview
    tunnel**, runs the test agent against that URL using the markdown spec, produces
    a **test report** artefact (per-step pass/fail, screenshots, optional screen
    recording), then tears down.
25. Tests are only definable when project status is **`ready`**.

### Job kinds (Orchestrator)

| Kind | Trigger | Purpose |
|------|---------|---------|
| `spec_grill` | Feature created (or re-grill) | Codebase exploration + grill-me → ADR |
| `feature_build` | User approves ADR | Implement spec → PR |
| `test_run` | Cron schedule | Run markdown test against main preview |

Implementation reference: `docs/concepts/job-dispatch.md`.

## Consequences

### Positive

- Clear separation between spec (grill + ADR) and build (implementation).
- ADR review in-app is fast; repo gets canonical ADRs on merge.
- Tests validate real `main` via ephemeral previews — no stale staging URLs.
- Project init ensures build commands and conventions exist before other work.
- Action queue + notifications give both urgency and history.

### Negative / trade-offs

- **Two containers per feature** — higher latency and compute vs. one long-lived
  session.
- **Hard init gate** — users cannot draft features while init runs.
- **All repos always** — simple single-file changes still clone everything.
- **Ephemeral preview per test run** — expensive; mitigated by 1-hour minimum
  interval and skip-on-overlap.
- **Markdown-only test subtasks** — no UI to toggle individual steps without
  editing the spec.

### Follow-ups (out of scope for this ADR)

- GitHub App for org-level repo installs (open question #2).
- Team RBAC and multi-user project permissions (Phase 2).
- Email/push notifications.
- Exact job-dispatch transport and event schema.
- Re-grilling / ADR revision after `spec_ready` (workflow TBD in implementation).
- Manual “run test now” trigger (scheduling is the v1 entry point).

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Tests as a kind of feature | Different lifecycle, trigger, and output — conflates build and verify |
| Subtasks as DB entities | Unnecessary CRUD; markdown sections sufficient for v1 |
| Persistent staging URL for tests | Can drift from `main`; ephemeral preview tests current code |
| Per-feature repo scoping | User chose all repos always for consistency |
| One container pausing between spec and build | Ties up resources during ADR review (hours/days) |
| Commit ADR during spec_grill | Noisy draft PRs for abandoned specs |
| Soft init gate (draft features during init) | User chose hard gate until init merges |
| Presets-only test scheduling | User chose presets + custom cron |
| Notifications as sole failure surface | Action queue needed for blocking-work UX |

# ADR 011: Feature `running` state — closing the queued → running gap

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Product/design session (grill-me)
**Builds on:** [ADR 006](006-pi-rpc-orchestrator-integration.md) (Pi RPC integration, curated event vocabulary), [ADR 010](010-feature-build-rpc-wiring.md) (extends that vocabulary to `feature_build`)

## Context

`docs/adr/002-projects-features-tests.md` and `docs/concepts/feature-lifecycle.md`
both document `running` as a real feature state ("`feature_build` job active").
The Web app already has it wired up cosmetically —
`web/lib/features/statuses.ts:25` maps it to the label "Building", and
`feature-detail-client.tsx:242` already branches on
`feature.status === "queued" || feature.status === "running"`. But nothing in
the API or Orchestrator ever writes `status = 'running'` to a `features` row.
Confirmed by grepping the whole API for `SET status = 'running'`: zero
matches. `FeatureRepository.setInReview`'s own doc comment, added while
implementing ADR 010, already names this exact gap:

> "nothing yet flips a feature to 'running' when its feature_build job
> actually starts (a separate, undecided gap — the job goes straight from
> 'queued' to whatever this call sets)"

This is not the same gap as `jobs.status`: `queue.Claim`
(`orchestrator/internal/queue/queue.go`) already does
`UPDATE jobs SET status = 'running' ...` the moment a job is claimed — that's
a different table and already correct. `spec-grill-panel.tsx`'s
`jobStatus === "running"` checks read that column (via
`GET /:projectId/features/:featureId/events`, ADR 006 item 15) and are
unaffected by this ADR. The gap is specifically `features.status`, the column
every other part of the product (labels, buckets, the action queue) reads.

Every other feature-state transition (`spec_ready`, `in_review`, `failed`,
`cancelled`) is driven by an explicit curated event the Orchestrator posts via
`PostJobEvent` → `syncFeatureState` (`api/src/jobs/internal-routes.ts`). No
`run_started`-equivalent event exists in the curated vocabulary, the
`job_events` type CHECK constraint, or anywhere in ADR 006/010 — not
implemented, not listed as deferred.

A second, adjacent gap surfaced during this session: `runAgentRPCJob`
(`orchestrator/internal/worker/specgrill.go`) calls `k8s.WaitForJobPod` before
ever calling `driveAgentSession` (the only place `handle`/`PostJobEvent` is
invoked). If `WaitForJobPod` itself errors — pod never schedulable, image
pull failure, etc. — `runAgentRPCJob` returns before any event is ever posted.
`runClaimedJob` calls `q.Fail` on the `jobs` row, but `features.status` is
never touched, so the feature is left stuck in `queued` forever with no
visible failure anywhere in the Web app.

## Decision

### A new curated event, synthesized locally, not decoded from Pi

1. `rpc.CuratedEvent` (`orchestrator/internal/rpc/curated.go`) grows
   `EventRunStarted` ("run_started"). Unlike `ask_user`/`submit_adr`/
   `submit_build_result`, this is never decoded from a `tool_execution_end`
   result — it's synthesized directly by the Orchestrator, the same way
   `run_failed`/`run_cancelled` already are (ADR 006 item 7: "synthesized
   locally when the attach stream itself ends unexpectedly"). `Terminal()`
   returns `false` for it.

### Fired once, at the one call site shared by both job kinds

2. In `runAgentRPCJob`, right after `k8s.WaitForJobPod` returns a `podName`
   and before `driveAgentSession` is called: call
   `handle(rpc.CuratedEvent{Type: rpc.EventRunStarted})` once. This is the
   only call site — it fires for `spec_grill` and `feature_build` alike,
   since `runAgentRPCJob` is already shared code (ADR 010 item 5), with no
   `job.Kind` branch needed. `WaitForJobPod` succeeding is the literal
   "container is up and running" signal (its own doc comment: "blocks until
   a Job's pod exists and is running"); this fires before `entrypoint.sh`'s
   repo-clone/branch-checkout work necessarily finishes for `feature_build`,
   which is accepted — the pod is up, which is what the event says.
   - **Rejected:** firing from inside `driveAgentSession`'s turn loop after
     the first `runTurn`/attach call succeeds. A stronger liveness signal
     (proves the container's stdin is actually reachable, not just that k8s
     reports the pod `Running`), but `feature_build` has no non-terminal
     curated event to hang this off of at all — its one turn's event is
     always terminal (`submit_build_result`) — so this would need a special
     "is this the first turn" flag threaded through the loop instead of one
     clean call site.
3. If `WaitForJobPod` itself errors, call
   `handle(rpc.CuratedEvent{Type: rpc.EventRunFailed, Message: ...})` before
   returning the error — closing the adjacent gap (Context) where a pod that
   never becomes attachable left the feature stuck in `queued` with no event
   ever posted. Reuses the existing `run_failed` handling in
   `syncFeatureState` (item 6) unchanged; the only change is that this call
   site now actually invokes it instead of returning silently.

### API: guarded write, differentiates job kind for free

4. New `FeatureRepository.setRunning(featureId)`
   (`api/src/features/repository.ts`), mirroring `queueBuild`'s guarded
   pattern rather than `setInReview`'s currently-unguarded one:
   ```sql
   UPDATE features SET status = 'running', updated_at = NOW()
   WHERE id = $1 AND status = 'queued'
   RETURNING ...
   ```
   The `WHERE status = 'queued'` guard is load-bearing, not just defensive:
   it's what lets the same `run_started` event (item 2) fire uniformly for
   both job kinds without a `job.Kind` check anywhere in `syncFeatureState`.
   A `spec_grill` job's feature sits in `draft` when `run_started` arrives —
   `draft` already means "`spec_grill` active" (ADR 002) — so the guarded
   UPDATE is a no-op there, which is exactly the desired behavior, not an
   edge case to special-case around.
5. `syncFeatureState` grows a case for `run_started`: calls
   `features.setRunning(job.featureId)`, no other side effects. `run_failed`
   (item 3) needs no new handling — the existing unguarded
   `updateStatus(featureId, "failed")` path already covers it once the new
   call site actually posts the event.
6. `job_events.type` CHECK constraint and the `jobEventSchema` zod enum both
   widen to include `run_started` — same mechanical migration shape as
   `010_job_events_user_message.sql`/`011_job_events_build_result.sql`.
7. The Web app's `GrillEvent` switch (`spec-grill-panel.tsx:209`) already has
   a `default: return null` fallback, so `run_started` appearing in a
   feature's event list renders nothing there — no code change required for
   this pass; a future pass may choose to render it, out of scope here.

### Explicitly deferred

8. **Any Web app surface that visually distinguishes `queued` from `running`
   beyond the label.** `feature-detail-client.tsx:242` still shows the same
   "Build job dispatched" placeholder for both — ADR 010 item 12 already
   deferred "Web app surface for `feature_build`'s live state" and this ADR
   doesn't resolve it either, only makes the underlying data correct.
9. **`test_run`'s equivalent gap.** `test_run` has no dispatch implementation
   yet (ADR 007's model-config gating already notes this); its own
   running-state signal is a later pass, same as ADR 010 deferred it for the
   RPC/event-relay machinery generally.
10. **Crash recovery / reattachment**, same standing gap from ADR 006/010 —
    unaffected by this ADR either way.

Implementation reference: `docs/concepts/feature-lifecycle.md`,
`docs/concepts/job-dispatch.md`, `orchestrator/CLAUDE.md`, `api/CLAUDE.md`.

## Consequences

### Positive

- Closes a real, already-named gap (`setInReview`'s own doc comment) using
  the exact same machinery every other transition already uses — no parallel
  mechanism invented.
- One call site drives both job kinds' `running`-equivalent signal with no
  `job.Kind` branching, by leaning on the guarded UPDATE's `WHERE` clause to
  do the differentiation.
- Also fixes a silent stuck-forever failure mode (`WaitForJobPod` erroring)
  that existed independently of this gap, at the same edit site.

### Negative / trade-offs

- `run_started` fires before `entrypoint.sh` finishes cloning/branching for
  `feature_build`, so "Building" can display for a stretch of time where the
  container is still doing setup work, not yet running Pi. Accepted: the
  alternative (waiting for first-attach) doesn't cleanly generalize to
  `feature_build`'s single-turn shape (item 2's rejected alternative).
- `setRunning` is now the *first* guarded transition in `repository.ts`,
  inconsistent with `setInReview`/`run_failed`/`run_cancelled`'s existing
  unguarded `updateStatus` calls — a deliberate new precedent, not a
  retrofit of the others, so the file now has two different conventions
  side by side until/unless a later pass unifies them.
- No Web UI change — the underlying state is correct but nothing yet
  presents `running` differently from `queued` to the user (item 8).

### Follow-ups (out of scope for this ADR)

- Web app surface distinguishing `queued`/`running` visually (ADR 010 item
  12, still open).
- `test_run` dispatch and its own running-state wiring.
- Retrofitting `setInReview`/`run_failed`/`run_cancelled` to the guarded
  pattern this ADR introduces for `setRunning`, if the inconsistency proves
  worth resolving later.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Derive an "effective status" at read time by joining `features` to `jobs.status`, instead of writing `running` to `features.status` at all | No new event/migration/Orchestrator change needed, since `jobs.status` already flips to `running` via `queue.Claim` — but introduces a second status source every consumer (Web app, action queue, notifications) has to know to join against, breaking from every other transition in this system being event-driven onto a single `features.status` column. |
| Fire `run_started` from inside `driveAgentSession`'s turn loop, after the first attach succeeds | Stronger liveness proof (container's stdin actually reachable, not just k8s-`Running`), but `feature_build` has no non-terminal curated event to anchor this to — would need a first-turn special case inside the shared turn loop instead of one clean call site in `runAgentRPCJob`. |
| Reuse `setInReview`'s existing unguarded `updateStatus` pattern for `running` too, and disambiguate spec_grill vs. feature_build with an explicit `job.Kind` check in `syncFeatureState` | Simpler / more consistent with the majority of existing call sites, but loses the free job-kind differentiation the guarded `WHERE status = 'queued'` clause gives for nothing, and reintroduces a (currently theoretical) clobber risk on every terminal transition. |
| Leave the `WaitForJobPod`-failure gap for a separate pass | Keeps this change scoped strictly to "queued → running," but the fix is a few lines at the exact call site this ADR already touches, closing a real silent-stuck-forever failure mode while the code is already open. |

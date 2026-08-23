# ADR 012: `spec_grill` retry status reset and live retry feedback

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Product/design session (grill-me)
**Builds on:** [ADR 006](006-pi-rpc-orchestrator-integration.md) (Pi RPC integration, curated event vocabulary), [ADR 007](007-per-user-default-model-configuration.md) (per-user default model config — the trigger for `retry-grill`'s existence), [ADR 011](011-feature-build-running-state.md) (guarded-UPDATE convention for feature-status transitions)

## Context

Incident: a `project_init` feature's `spec_grill` job failed due to a
misconfigured model. The model config was fixed and the feature was retried
via the Web app's "Retry grill" button. The new pod ran successfully, but the
frontend kept showing the feature as `failed` indefinitely, with no
indication a retry was even in progress.

Root-caused by code inspection (not a hypothesis — traced end to end):

- `retry-grill` (`api/src/projects/routes.ts:755-808`) dispatches a
  brand-new job via `dispatchJob` → `JobRepository.create`
  (`api/src/jobs/repository.ts:37-55`), which always inserts a new `jobs`
  row with a new id — it never mutates or reuses the failed job's row. But
  the handler (lines 799-804) **never writes `features.status`**. It stays
  at `'failed'` for the entire lifetime of the retried run.
- `FeatureRepository.setRunning` (`api/src/features/repository.ts:159-168`,
  introduced by ADR 011) is guarded `WHERE status = 'queued'` — a
  documented no-op for `spec_grill` by design, since a spec_grill feature
  sits in `'draft'`, not `'queued'`, when `run_started` fires (ADR 011 item
  4). That same guard is *also* a no-op against `'failed'`, so a retried
  job's `run_started` event does nothing to the status either way.
- `SpecGrillPanel` (`web/components/features/spec-grill-panel.tsx`) is the
  only component in the app that polls job/event status. Its parent,
  `feature-detail-client.tsx:188`, renders it only while
  `feature.status === "draft"`. Once `'failed'`, it's unmounted and its poll
  loop (`spec-grill-panel.tsx:49-80`) stops entirely.
- `handleRetryGrill` (`feature-detail-client.tsx:112-125`) does exactly one
  `POST retry-grill` followed by one `fetchFeature`, then resets its local
  `retrying` flag. Since `retry-grill` never changed the status, that one
  fetch reads back `'failed'` again — the entire user-visible "feedback" is
  a button that briefly says "Retrying…" and then looks exactly like it did
  before.

**Both reported symptoms — the stale `failed` status and the silent retry —
are the same gap**: retrying never re-enters the feature into the states
that the rest of the system already knows how to show progress for.

Contributing but not causal to this incident: `jobs.last_error` and
`jobs.attempts` (`api/src/db/migrations/004_job_queue.sql`) are written on
failure (`orchestrator/internal/queue/queue.go`'s `Fail`) but never read by
any repository method, route, or frontend component. The failure banner
shows generic copy ("Project initialization didn't complete") instead of the
actual reason — the user had to find the "misconfigured model" cause outside
the product.

No independent reconciliation loop against pod/Kubernetes health exists or
is proposed here. By design (ADR 006 item 11), `features.status` is driven
entirely by curated events the Orchestrator's in-process RPC session posts
via `POST /internal/jobs/:jobId/events` → `syncFeatureState`
(`api/src/jobs/internal-routes.ts:105-150`). That is accepted, standing
architecture. This ADR closes a specific gap inside it — retry not
re-entering the state machine it already drives — not a parallel poller.

Explicitly out of scope, confirmed during this session:

- Generalizing retry to non-`project_init` features. `retry-grill`'s own
  comment already names this as a separate, open question (does a normal
  feature's retry need to preserve or discard prior grill chat history?).
- Stitching `job_events` across multiple retry attempts into one persistent
  feature-level timeline. `findLatestSpecGrillJob`
  (`api/src/jobs/repository.ts:141-152`) only ever surfaces the newest
  attempt; a past failed attempt's events disappear from view once
  superseded. Sufficient for now: the goal is live visibility into the
  *current* attempt, not permanent multi-attempt history.
- The standing crash-recovery / orphaned-pod reattachment gap (ADR 006 item
  16 / ADR 010 item 11 / ADR 011 item 10) — unaffected either way. Confirmed
  this incident's working pod came from a normal UI-driven retry (new job
  row, new pod), not an orphan from a crashed Orchestrator process.

## Decision

1. **New guarded `FeatureRepository.resetForRetry(featureId)`**
   (`api/src/features/repository.ts`):
   ```sql
   UPDATE features
   SET status = 'draft', awaiting_user_input = FALSE, updated_at = NOW()
   WHERE id = $1 AND status = 'failed'
   RETURNING ...
   ```
   Guarded `WHERE status = 'failed'`, following `setRunning`'s ADR-011
   precedent rather than the older unguarded `updateStatus` calls
   (`setInReview`, `run_failed`, `run_cancelled`). This makes the method
   itself safe to call from any context, not just this one route, and
   no-ops safely under a race (e.g. a double-click, or a job that finishes
   between the route's own pre-checks and this call) instead of clobbering
   a state set by something else in between.

2. **`retry-grill` calls it.** `api/src/projects/routes.ts:799-804`'s
   standalone `setAwaitingUserInput(featureId, false)` call is replaced by
   `features.resetForRetry(featureId)`, run before `dispatchJob`.
   `resetForRetry` already clears `awaiting_user_input` itself, so the
   separate call is redundant once this lands.

3. **No frontend gating change needed.** Once `features.status` is
   `'draft'` again, the existing condition at `feature-detail-client.tsx:188`
   (`feature.status === "draft" && <SpecGrillPanel .../>`) re-mounts the
   panel for free. Its existing poll loop and UI states — "Starting the
   grill session…", "Waiting for the agent to start…", the `ProcessingBubble`
   once `jobStatus === "running"` — already do exactly what "show retry is
   in progress" requires. None of that needed to be built; it just needed to
   become reachable again.

4. **Surface `jobs.last_error` on the failure banner:**
   - Add `last_error` to `jobColumns` / `JobRow` / the mapped `Job` type in
     `api/src/jobs/repository.ts` (currently omitted from all three).
   - `GET /:projectId/features/:featureId/events`
     (`api/src/projects/routes.ts:815-842`) already resolves the feature's
     latest spec_grill job via `findLatestSpecGrillJob` — add
     `lastError: job.lastError` to its JSON response alongside the existing
     `jobStatus`.
   - `feature-detail-client.tsx`'s failed-state banner (lines 163-186),
     which today only renders generic copy, fetches this endpoint once when
     `status === "failed"` and renders `lastError` if present.

5. **No DB migration required.** `features.status` has no CHECK constraint
   to widen — transitioning to `'draft'` is already a legal value in a
   plain column — and `jobs.last_error` already exists
   (`004_job_queue.sql`).

## Consequences

### Positive

- One root-cause fix resolves both reported symptoms. No new "retry
  feedback" UI has to be designed or built — it reuses `SpecGrillPanel`'s
  existing states, which were simply unreachable from `'failed'` before now.
- The actual failure reason (e.g. "model not recognized") becomes visible
  in the product instead of requiring a dig through pod/Orchestrator logs.
- Follows the exact guarded-UPDATE convention ADR 011 established for
  `setRunning`, rather than introducing a third status-mutation style
  alongside the guarded and unguarded ones that already coexist.

### Negative / trade-offs

- `SpecGrillPanel`'s own local retry button and `handleRetry`/`canRetry`
  (`spec-grill-panel.tsx:111-133`) remain unreachable dead code after this
  fix: `feature.status` flips to `'failed'` in the same poll tick that
  observes `jobStatus === 'failed'` (both fetched together in the panel's
  own `Promise.all`), unmounting the panel before that branch could ever
  render. Pre-existing, orthogonal to this fix — not removed here.
- ~~`retry-grill` stays `project_init`-only; a normal feature's failed
  spec_grill still has no retry path at all. Pre-existing gap, not
  introduced or worsened by this ADR.~~ **Resolved (2026-08-24):** see the
  "Generalizing retry" follow-up below.
- `job_events` still doesn't stitch across retries — a superseded attempt's
  events simply disappear from `SpecGrillPanel`'s view once a newer job
  exists for the same feature. Acceptable given this ADR's scope (live
  visibility into the current attempt).
- Crash-recovery / orphaned-pod reattachment remains unaddressed. Not this
  incident's cause, so left deferred per ADR 006/010/011.

### Follow-ups (out of scope for this ADR)

- Removing or fixing the reachability of `SpecGrillPanel`'s local
  retry/cancel dead-code branch.
- ~~Generalizing retry to non-`project_init` features.~~ **Done (2026-08-24):**
  `retry-grill`'s `featureType !== "project_init"` guard
  (`api/src/projects/routes.ts`) and the matching frontend gating
  (`feature-detail-client.tsx`) were dropped — `resetForRetry` and
  `dispatchJob` were already feature-type-agnostic, so no state-reset
  semantics changed. ADR 007's original scoping rationale, and this ADR's
  own "Alternatives considered" rejection of generalizing retry, no longer
  apply. Grill chat history semantics (raised as the open question at the
  time) turned out to be moot: a retried run always starts a brand-new pod
  session with no memory of the prior attempt, project_init or not, and
  `job_events` already only ever surfaces the latest job per feature.
- A feature-level event timeline spanning multiple spec_grill attempts.
- Crash-recovery / reattachment (standing gap, ADR 006/010/011).
- The three independent copies of the `FeatureStatus` literal union
  (`api/src/features/types.ts`, `web/lib/features/statuses.ts`,
  `web/lib/features/types.ts`), with no DB CHECK constraint tying them
  together — noted as a latent drift risk, not addressed here.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Change `SpecGrillPanel`'s render condition to "does an active/recent job exist" instead of `feature.status === "draft"` | Would also fix the gating symptom, but treats the symptom rather than the cause — `features.status` would still be lying about reality to every other consumer of that column (status buckets, badges, notifications), not just this one panel. |
| Unguarded `updateStatus(featureId, "draft")` instead of a guarded `resetForRetry` | Fewer lines, consistent with the majority of existing transitions in `repository.ts` — but loses the free protection against a race clobbering a concurrent state change, and this ADR's own precedent (ADR 011's `setRunning`) already chose guarded for the equivalent "re-enter an active state" case. |
| Generalize retry to all feature types now | Directly serves the broader "detailed monitoring" ask, but the route's own existing comment already flags normal-feature retry as a distinct open question deserving its own design pass (e.g. grill chat history semantics), not a drive-by in a bug-fix ADR. |
| Stitch `job_events` across retries into one feature-level timeline now | A bigger, separate API/UI change (new cross-job query, merged event list, distinguishing attempts) not required to fix either reported symptom — the current attempt's live view is sufficient. |

Implementation reference: `docs/concepts/feature-lifecycle.md`,
`docs/concepts/job-dispatch.md`, `api/CLAUDE.md`, `web/CLAUDE.md`.

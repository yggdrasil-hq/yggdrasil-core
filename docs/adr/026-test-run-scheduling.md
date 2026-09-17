# ADR 026: Test-run cron scheduling and run history

**Status:** Accepted
**Date:** 2026-09-17
**Deciders:** Product session (open-issue burn-down, wave 4)
**Builds on:** [ADR 002](002-projects-features-tests.md) (the Test entity, its
scheduling interval rule, and the project home/action-queue model),
[ADR 003](003-orchestrator-kubernetes.md) §18 (the Postgres-backed durable job
queue and its `SELECT … FOR UPDATE SKIP LOCKED` claim), [ADR 004](004-agent-base-containers.md)
(the `test_run` agent image), [ADR 015](015-six-stage-feature-lifecycle.md)
(the six-stage lifecycle and the per-*feature* Testing stage this ADR is
deliberately distinct from), [ADR 016](016-organization-rbac-and-cluster-routing.md)
(project access and membership), [ADR 017](017-web-visual-parity-with-design.md)
(the `design/projects/detail/tests/*` wireframes this UI continues),
[ADR 018](018-multi-provider-model-config.md) (`model_config_warning`),
[ADR 028](028-audit-logging.md) (why the new reads are not audited)
**Does not touch:** ADR 015's feature-stage Testing gate, `script_test_run`
(unchanged — a scheduled run dispatches `test_run`, the agent-driven kind the
Test entity's markdown spec is written for), ADR 022's deploy ledger, and
screen recording (split out to issue #17)

## Context

Phase 3 of the roadmap is "testing product", tracked by issue #3, with issue
#16 splitting out the history view. Today the Test entity is **entirely
inert**:

- `tests` (migration 002) stores `name`, `spec_markdown`, `schedule_cron`,
  `enabled`, and `last_run_at`.
- CRUD exists (`GET/POST/PATCH /projects/:projectId/tests[/:testId]`), and both
  write paths validate the cron string (`isValidCronExpression`,
  `meetsMinimumInterval`).
- `jobs.trigger_source` already allows `"schedule"`, and `JobRepository.create`
  even defaults a `test_run` to `trigger: "schedule"` and `ref: "main"`.

**But nothing ever reads a schedule.** `tests.last_run_at` is written by no code
path at all, there is no scheduler process, and consequently no `test_run` has
ever been dispatched from a Test entity. A `test_run` only happens today as a
side effect of a feature build finishing (ADR 015), against a feature branch.

The reporting half is similarly half-built: `test_run_reports` /
`test_run_steps` (migration 019) persist the canonical
`.yggdrasil/test-report.json`, and ADR 015's Testing stage renders them — but
only grouped by *feature*. There is no view of a Test entity's own history, and
the test detail page renders just the edit form. The `design/` wireframe for that
page says so explicitly in its own `.design-note`: *"the Test type only tracks
schedule + last-run, no pass/fail history yet."*

Two decisions had to be made that the existing docs do not cover: **where the
scheduler runs**, and **what "due" means** — including what happens across an
outage, and how several API replicas avoid double-firing everything.

### The two Testing surfaces, precisely

This ADR adds the **project-level standalone Testing product** (Phase 3). It is
not the same surface as ADR 015's **feature-stage Testing**:

| | Feature-stage Testing (ADR 015) | Test entity history (this ADR) |
|---|---|---|
| Question | "Did this feature's branch pass before review?" | "How has this scheduled suite been doing over time?" |
| Scope | one feature, since its last `feature_build` | one Test entity, across all its runs |
| Trigger | automatic, immediately after a successful build | the test's own cron, plus feature runs |
| Target | the feature branch (`yggdrasil/<slug>-<id>`) | `main` |
| Gate | blocks the feature's progress to Agentic Review | none — informational |
| API | `GET /projects/:id/features/:fid/testing` | `GET /projects/:id/tests/:tid/runs` |

Both read the same `test_run_reports` rows. They are grouped differently and
show different surrounding context, which is why this ADR adds a distinct
response type rather than widening ADR 015's.

## Decision

### 1. The scheduler runs inside the API process.

Started in `index.ts` next to `app.listen`, **not** inside `createApp`.

- The `tests` entity, its cron expressions, `last_run_at` and the job rows a
  schedule produces are all API-owned. The Orchestrator never reads or writes
  any of them — it only claims already-created jobs from the queue.
- Putting the tick in the Orchestrator would add a second writer of `tests` to
  the component whose entire design premise is being stateless across replicas
  (ADR 003 §19-20), and would mean the schedule stops whenever the Orchestrator
  is scaled to zero.
- A separate service would add a deployable, an image, and a health story for
  one query loop; ADR 003 §19 rejected exactly that move for the Orchestrator
  ("splitting is deferred until there's concrete evidence").
- Starting it from `index.ts` rather than `createApp` means **building an app
  never spawns a background ticker** — every test in the api repo constructs an
  app, and none of them should have to think about a scheduler.

### 2. Several replicas are safe by a transactional claim, not by being alone.

The API runs 2+ replicas. A naive "select the due tests, then dispatch" would
let every replica dispatch the same test every tick.

The tick is therefore one transaction:

1. `SELECT … FROM tests … FOR UPDATE OF t SKIP LOCKED` takes row locks on the
   candidates for the duration of the tick.
2. The due-check runs in TypeScript (SQL cannot evaluate a cron string in a
   column).
3. For each due test: insert the job row **and** stamp `last_run_at`, then
   commit.

A concurrent replica skips the locked rows and claims different ones — the work
is partitioned rather than raced for. This is deliberately the **same
mechanism as the job queue itself** (ADR 003 §18), rather than a new
distributed-lock concept (advisory locks, a leader election, a `claimed_at`
column). If a replica dies mid-tick the transaction rolls back, so the test is
left unadvanced and the next tick picks it up — the failure mode is "runs a
little later", never "dispatched twice" or "half-dispatched".

Verified against a real Postgres, not just reasoned about: with one connection
holding the claim, a second connection's identical statement returns zero rows.

### 3. Schedules are evaluated in UTC. Explicitly, and in the UI.

There is no per-project timezone concept anywhere in the product, so any other
choice would mean inventing one. UTC is also the only option that makes DST
**structurally** impossible rather than merely unlikely — a UTC day is always
86,400 seconds, so there is no missing hour to skip and no repeated hour to
double-fire.

The consequence is user-visible and therefore has to be said out loud: the
`daily9am` preset means **09:00 UTC**, and the preset labels are changed to say
so ("Daily at 09:00 UTC"). A bare "Daily at 9:00 AM" would read as the viewer's
local time and quietly promise a run three or four hours from when it happens.

A per-project timezone is a follow-up (§Follow-ups), not an oversight.

### 4. "Due" is: the most recent matching occurrence is newer than the last run.

```
previousOccurrence(cron, now) > (lastRunAt ?? createdAt)
```

Three properties fall out of that one expression, which is why it is written
that way rather than as a set of special cases:

- **A new test starts on its next window.** The reference for a never-run test
  is `createdAt`, not the epoch, so a test created at 09:30 with a daily-09:00
  schedule waits for tomorrow's 09:00 instead of firing the moment it is
  created because a window elapsed before it existed.
- **The boundary is decided in exactly one place.** `previousOccurrence` is
  inclusive (`<= now`), so the strict `>` here is the single thing that stops a
  test firing twice for one window.
- **An unfireable or malformed schedule is inert.** `previousOccurrence`
  returns null, so no dispatch — a fail-safe direction, since the alternative
  (treating unparseable as "always due") would spin.

Cron evaluation is a **pure, dependency-free module** (`scheduling/cron.ts`),
unit-tested on its own across field expansion, the day-of-month/day-of-week OR
rule, leap days, month/year boundaries, and both DST transitions. No cron
library is added: the api's dependency set is deliberately small, and the syntax
the product accepts (`isValidCronExpression` only checks for five non-empty
fields) is a contained subset that is cheaper to specify and test than to adopt.

### 5. A missed window catches up **once**.

After an outage, the most recent occurrence is still newer than the last run, so
the test fires **once**, not once per window missed. `last_run_at` then moves to
the tick's instant and the test is not due again until the next window.

A test suite is a verification action, not an event log: replaying six missed
hours six times would spend six containers and six model calls to learn the same
thing the single run already says. The one-dispatch-per-tick bound is reinforced
by the claim itself — `last_run_at < now` stops matching the moment it is
stamped.

### 6. A blocked project is skipped, and left overdue.

If `model_config_warning` or `github_access_warning` is set, the tick does not
dispatch — and crucially does **not** advance `last_run_at`. The test stays
overdue, so the run happens as soon as the operator clears the warning.

The alternative, treating a skip as "it ran", would silently drop the run
entirely, which is the worse failure for exactly the case those flags exist to
surface. The scheduler deliberately adds **no new warning surface**: both flags
already have an action-queue item and a Web banner (ADR 018 / ADR 005), and a
second signal would only need reconciling.

### 7. `last_run_at` means "this schedule last fired".

Not "this test last ran". A feature-driven run (ADR 015) does not touch it, and
that is intentional: allowing it to would silently shift a test's schedule every
time a feature happened to be tested.

The consequence is that `last_run_at` is a scheduling field, and the
authoritative "last run of any kind" is the newest entry in the run history this
ADR also adds. Both are shown, labelled for what they are ("Schedule last fired
…" on the status card).

### 8. The tick is bounded, self-overlapping is skipped, and a failed tick is swallowed.

- **Bounded candidates.** One tick considers at most 100 tests, longest-since-run
  first. A backlog drains over successive ticks rather than holding row locks
  for an unbounded time.
- **No overlap.** If a tick is still running when the next interval elapses, the
  next is skipped rather than stacked. The claim makes a skipped tick harmless.
- **Failure is logged, not fatal.** A tick that throws rolls back, releases its
  client, and logs; the process stays up. A scheduler that took the API down on
  a transient database error would turn a control-plane blip into an outage, and
  the missed work is picked up by §5's catch-up anyway.
- **`now` is a parameter**, so one tick reasons about a single instant
  throughout. A slow tick that read the clock twice could judge a test due and
  then stamp a time that makes it look not-yet-due.

The interval defaults to 60s (`TEST_SCHEDULER_INTERVAL_MS`, floored at 1s so a
bad env var cannot busy-loop) and is the resolution of every schedule — a test
fires up to one tick after its window opens. It is well under the product's
one-hour minimum interval by construction.

### 9. The history read is two read-only, project-scoped endpoints.

- `GET /projects/:projectId/tests/:testId/runs` — a page of runs, newest first
  (default 50, capped at 200; a malformed `limit` falls back to the default
  rather than 400ing a display hint).
- `GET /projects/:projectId/tests/:testId/runs/:jobId` — one run.

Both resolve the test through the caller's project **first**, and the run query
is scoped by `test_id` in its own `WHERE` clause, so another project's test or
run is a 404 rather than a readable history. All statuses are included, not just
completed ones: a queued, running, or failed-before-reporting run is exactly
what an operator needs to see, and filtering them out is how a stuck schedule
becomes invisible.

A page is three queries (jobs, reports, steps) rather than two per run — the
per-job loop would issue 2N queries for a 50-run page.

### 10. The UI extends the existing test detail page; no new route.

The run history is a card on `/projects/:projectId/tests/:testId`, placed with
the rest of that page's status information, matching the
`design/projects/detail/tests/detail` wireframe's structure ("Run status" →
details → schedule → spec). No new route is added: the wireframe has exactly one
route per test, and a nested per-run page would drift from it for no
navigational gain, so rows expand in place (the per-run endpoint remains the
canonical deep-linkable read for when that changes).

Every presentation decision — counts, durations, tone, the header summary, the
empty-state copy — lives in a pure module (`web/lib/features/test-runs.ts`) with
unit tests. The web repo has no React testing library by design (vitest runs
`environment: "node"`), so the component is left with markup only.

### 11. No audit events, and no new notification kind.

- **No audit events.** Both new endpoints are reads, and ADR 028 explicitly
  lists read-auditing as out of scope. The scheduler's dispatch is a
  *system*-initiated action recorded by the job row itself (with
  `trigger: "schedule"`), which is precisely the reasoning ADR 028 uses to leave
  the routine `deploy` trigger unaudited: the job row already carries the fact,
  and a trail row would add no actor the product does not already know. Note the
  same asymmetry ADR 022 drew — `deploy.rolled_back` *is* audited because a
  human chose it.
- **No notification kind.** Test-run outcomes could arguably notify, but ADR 027
  owns the notification-kind list and the preferences that gate it; adding a
  kind here would silently create a class of notification users cannot switch
  off. Deferred (§Follow-ups).

## Consequences

### Positive

- Tests defined in the product actually run. The `schedule_cron` column, its
  validation, `trigger: "schedule"`, and the `test_run` image were all already
  paid for; this is the missing half.
- Scheduling correctness is provable: the due-decision is a pure function with
  exhaustive tests, and the multi-replica claim was verified against a real
  Postgres rather than assumed.
- Catch-up semantics are stated once (§4-5) instead of emerging from
  special-cased branches, which is what usually makes cron schedulers
  surprising.
- The two Testing surfaces are now distinguishable in both code and docs,
  instead of one growing type serving two screens.
- No new service, no new dependency, no new daemon to operate.

### Negative / trade-offs

- **Schedules are UTC, and the UI has to say so.** Users who think in local time
  will misread a schedule unless they read the label. A per-project timezone is
  the real fix and is deferred.
- **Catch-up-once is a judgement call.** An operator who wanted a run per missed
  window does not get one. Chosen deliberately (§5), and it is the cheaper
  mistake.
- **The claim's window is per tick, not per occurrence.** Two ticks inside one
  window cannot both fire, but a very long tick (past the next window) could, in
  principle, dispatch twice for two windows. Bounded by the interval and the
  one-dispatch-per-tick rule, and strictly better than firing once per missed
  window.
- **`last_run_at` is now written by the scheduler and read by the UI as
  scheduling bookkeeping.** Two different "last run" notions exist and are
  labelled rather than unified.
- **The scheduler polls.** Every tick scans candidate rows whether or not work
  exists. At this product's scale that is microseconds; the partial index
  (migration 039) keeps it that way as the table grows.
- **A scheduled run's outcome is only visible where you look for it** — the test
  detail page. There is no project-home action item for "your scheduled suite
  has been failing", which is where an operator would most naturally want it.

### Follow-ups

1. **`meetsMinimumInterval` does not actually enforce its own rule (found while
   building this; not fixed here).** It rejects `*/N * * * *` and `* * * * *`,
   but accepts other sub-hourly expressions, so `* 10 * * *` (every minute
   during 10:00-10:59) and `* * * * 1` (every minute on Mondays) pass validation
   while the UI states "Minimum interval is 1 hour." The scheduler is correct
   for them regardless — at most one dispatch per test per tick — so this is a
   validation gap, not a scheduler bug. Tightening it is a behaviour change to
   an existing endpoint and belongs in its own change.
2. **Per-project timezone** for schedules, or at least a per-project display
   offset. Requires a product decision about where the setting lives.
3. **Surface a persistently failing scheduled suite**, e.g. a project-home
   action item once N consecutive runs fail. Neither ADR 002's action-queue
   vocabulary nor ADR 027's notification kinds currently include it.
4. **A manual "Run now"** trigger for a Test entity, for the obvious reason that
   waiting up to a day to check a fix is poor. Deliberately not built here: it
   is a new mutating endpoint, hence new authorization surface and an ADR 028
   audit row, and it was outside the two issues in scope.
5. **Screen recording** of scripted runs — issue #17 (Playwright video, MinIO
   upload, player). The report schema already carries a `recordingPath` field
   that nothing writes.
6. **Backfill/sync for runs that never reported** (a job deleted, or an
   Orchestrator crash): history shows them as "no report", which is honest but
   indistinguishable between the two causes.
7. **A design-note refresh** for `design/projects/detail/tests/detail`, whose
   `.design-note` still says "no pass/fail history yet" (the `design/` directory
   is meta-repo content owned by the parent).

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Scheduler in the Orchestrator** | Makes a stateless component (ADR 003 §19-20) the second writer of `tests`, and stops scheduling whenever it is not running. The API already owns the entity and the job rows. |
| **Scheduler as its own service** | A deployable, an image and a health story for one query loop — the same "concrete evidence" bar ADR 003 §19 sets for splitting the Orchestrator. |
| **A cron library** | The accepted syntax is a contained subset; specifying and exhaustively testing it (62 unit tests) is smaller than adopting a dependency whose edge-case semantics would still have to be pinned down. |
| **`pg_try_advisory_lock` as a single leader** | Elects one replica to do all scheduling, so a leader that is slow or wedged delays every test, and adds a lock-lifetime/connection-lifetime coupling. `SKIP LOCKED` partitions the work instead and is the queue's own precedent. |
| **A `claimed_at` column or a claims table** | Re-implements what a row lock already gives, with a stale-claim reaper needed to recover from crashes — more state, more failure modes. |
| **`last_run_at` written per dispatch but also on feature runs** | Silently shifts a test's schedule every time a feature is built (§7). |
| **Catch up one dispatch per missed window** | Spends a container and a model call per missed window to learn the same thing; a test suite verifies the current state, it does not replay history (§5). |
| **Treat a warning-blocked project's skip as "ran"** | Silently drops the run instead of running it when the block clears — the opposite of what the warning flags exist to surface (§6). |
| **Local-time (or per-install-timezone) evaluation** | Every install would silently disagree about when "9am" is, and DST would create missing and repeated hours; there is no timezone concept in the product to store it on (§3). |
| **Fire immediately for a newly created test whose window just passed** | A test created at 09:30 would run instantly against a spec its author just wrote, for a window that elapsed before the test existed (§4). |
| **Widen ADR 015's `TestRunExecution` for history** | Mutates a feature-stage response to serve an unrelated screen, and the two need different surrounding fields (trigger, ref, timings) — see the table in Context. |
| **A dedicated per-run page under the test route** | Drifts from ADR 017's one-route-per-test wireframe for no navigational gain; the endpoint exists for when deep links are wanted (§10). |
| **Audit every scheduled dispatch** | ADR 028's own precedent excludes system-initiated records already captured by a job row, and a scheduler firing hourly would flood the trail with rows carrying no actor the product lacks (§11). |
| **Add a `test_run_failed` notification kind** | ADR 027 owns the kind list and the preferences that filter it; adding one here would create notifications a user cannot turn off (§11). |

## Implementation

- `api/src/scheduling/cron.ts` — pure cron parse/match, `previousOccurrence`,
  `isDueForSchedule` (62 unit tests).
- `api/src/scheduling/repository.ts` — the candidate query (`FOR UPDATE OF t
  SKIP LOCKED`) and `last_run_at` stamp.
- `api/src/scheduling/scheduler.ts` — the tick and the interval loop
  (19 unit tests, including transaction shape, overlap skipping and failure
  swallowing).
- `api/src/db/pool.ts` — `Queryable`, so repositories can join a caller's
  transaction; `JobRepository.create` takes an optional client for the same
  reason.
- `api/src/tests/run-history.ts` + `reports-repository.listRunsForTest` /
  `findRunForTest` — the history read, batched to three queries per page.
- `api/src/projects/routes.ts` — the two read endpoints (appended).
- `api/src/db/migrations/039_test_schedule_index.sql` — partial index for the
  poll predicate.
- `api/src/config.ts` / `api/src/index.ts` — scheduler configuration and start.
- `web/lib/features/test-runs.ts` + `src/features/test-runs.test.ts` — all
  history presentation logic, unit-tested (49 tests).
- `web/components/tests/test-run-history.tsx` — the card;
  `test-detail-client.tsx` renders it; `lib/api.ts` and `lib/features/types.ts`
  gain the read.

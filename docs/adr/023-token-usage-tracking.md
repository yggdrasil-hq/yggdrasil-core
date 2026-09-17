# ADR 023: Per-job token usage tracking and consumption reporting

**Status:** Accepted
**Date:** 2026-09-17
**Deciders:** Product session (open-issue burn-down, wave 3)
**Builds on:** [ADR 004](004-agent-base-containers.md) (Pi is the fixed agent
runtime), [ADR 006](006-pi-rpc-orchestrator-integration.md) (the Orchestrator
drives Pi over JSONL RPC), [ADR 018](018-multi-provider-model-config.md) and its
per-feature amendment (which model configuration served a job),
[ADR 016](016-organization-rbac-and-cluster-routing.md) (the Organization is the
tenancy boundary every read is scoped by), [ADR 017](017-web-visual-parity-with-design.md)
(the mock pages this replaces), [ADR 028](028-audit-logging.md) (its `/internal/*`
scope-out is what this reporting path relies on for not being audited)
**Does not touch:** ADR 003 (cluster compute — `/infrastructure` and
`/allocations/infra` remain mock, see item 12), the deployment pipeline, and
anything that could *limit* consumption — budgets and caps are explicitly out of
scope (item 11, split to #18)
**Resolves:** `roadmap/open-questions.md` #15, and the reporting half of issue #6

## Context

`roadmap/phases.md` Phase 4 lists "token budgets and usage/consumption
reporting"; `design/usage`, `design/analytics`, and `design/allocations/*` mock
all of it. Under ADR 017 those surfaces were built as **static-only** pages, and
every one of their design-notes says the same thing: *"there is no token-usage
tracking concept anywhere in the current system — not in any ADR, not in
job-dispatch.md, nothing."* No job records what it consumed. There is no per-job
count, no cost, no duration, and nothing to aggregate.

That made the mock pages unanswerable rather than merely unfilled: they display
a percentage **of a provider limit** and a **billing-cycle reset date**, neither
of which Yggdrasil can observe at all. Providers are bring-your-own-key and
organization-owned (ADR 016/018) — Yggdrasil meters usage against someone
else's account; it does not hold a quota and cannot see one.

Two facts change what this costs to build:

1. Pi already keeps this accounting for its own session. Its RPC exposes
   `get_session_stats`, returning `tokens {input, output, cacheRead,
   cacheWrite, total}`, `cost`, message/tool-call counts, and `contextUsage`.
   The Orchestrator already speaks that protocol (ADR 006).
2. The Orchestrator already knows when a run started and ended, and which model
   id the pod ran with (it builds that env itself).

So this is instrumentation over an existing interface, not new accounting.

## Decision

### Capture

1. The Orchestrator issues Pi's **`get_session_stats`** when a job's session
   ends, and posts the result to the API. Yggdrasil **never tokenizes or
   estimates**: every count is provider-reported, and is only ever as accurate
   as the provider that billed it. This is a deliberate refusal to build a
   second, divergent source of truth.

2. Capture happens at **session end only** — not streamed. Considered and
   rejected for now: Pi's live `message_update` events carry a cumulative
   `usage` field, but Pi's own documentation states it *"may remain zero until
   completion when a provider does not report usage during streaming"* — a
   partial record would be least trustworthy in exactly the case it was meant to
   cover. Nothing consumes a live figure, and the streaming path would need
   per-turn accumulation and reconciliation against the authoritative total. Revisit
   if a UI ever needs live spend.

3. The read is the **last** thing that happens to the pod. Pi's stdin is
   per-attach, so a question can only be asked inside a turn, and the pod is
   deleted as soon as the session function returns — meaning a failure is not
   retryable and must not be fatal. The whole capture is **best-effort**: a
   failure is logged and dropped, never turned into a job failure, because the
   job's real outcome has already been decided and relayed by then.

4. `total` falls back to the sum of the four components when a provider reports
   a zero total alongside non-zero parts. That combination is a reporting gap,
   not a real zero, and the sum is arithmetically the same quantity — storing 0
   would understate every aggregate built on the column. A genuinely empty
   session still records 0.

5. A failed stats response (`success: false`) is rejected rather than parsed as
   all-zeros, so a rejected call can never be recorded as "this job used
   nothing".

### Reporting

6. **Per-job token usage table** (`job_usage`, migration 036), one row per job,
   keyed on `job_id` and upserted. A retried job is a *new* job row (ADR 012),
   so a retry gets its own row rather than overwriting the attempt it replaced,
   and a duplicate report from a restarted Orchestrator replaces rather than
   accumulates — the figures are a whole-session snapshot.

7. Stored per row: job id, project, job kind, the literal model id the pod ran
   with, the model-config **tier** that resolved it, the catalog **provider**
   name where one exists, input/output/cache-read/cache-write/total tokens,
   cost, duration, and timestamp.

8. **`project_id` and `job_kind` are denormalized**; the **organization is
   not**. The first two are immutable facts about a job and are the grouping
   keys of every read, so copying them keeps the hot aggregates join-free. An
   organization belongs to the *project*, not the job — a stored copy could
   silently misattribute historical usage if that ever changed, so org-scoped
   reads join `projects` instead (verified: the join is what every aggregate
   carries).

9. **Cost and duration are nullable, and stay nullable through the
   aggregates.** "No provider reported a cost for this window" and "this window
   cost nothing" are different facts, and a billing page must not present the
   first as the second. `SUM()` over an all-null group returns NULL for exactly
   this reason, which the pages surface as "Not reported". A reported `0` is a
   real, useful zero and is preserved as one.

10. **Duration is agent working time**, i.e. cumulative time inside Pi turns,
    deliberately **excluding** time a `spec_grill` sat waiting on a human reply.
    A grill can idle for hours; folding that in would make the figure measure
    human latency rather than agent cost. Reported as a nullable millisecond
    count.

11. **Reporting only — no enforcement.** Nothing here throttles, blocks, warns,
    or budgets. Caps and quotas (per-project spend caps, provider allow-lists,
    per-namespace Kubernetes ResourceQuota) are a distinct feature with real
    behavioural questions (warn vs. block, which counter is authoritative, what
    happens to an in-flight job) and are **out of scope**, split to #18.

### Authorship and access

12. **Scope is derived entirely from the stored job, never from the request
    body.** The caller is the Orchestrator reporting on a job it just ran;
    letting it name the project, kind, or tier would make the table assertable
    from outside rather than observed. The body carries only the accounting.

13. **Provider and tier are resolved server-side from the API's own catalog**
    (`resolveModelConfigSource`, which decrypts nothing). The Orchestrator never
    learns a provider name and never sends a key; only `MODEL_ID` is read out of
    the pod's env, and it records what *actually served the run* even if
    configuration changed underneath it mid-run. For the two custom-triplet
    tiers there is no catalog row to name a provider from — those record a null
    provider, and the pages show "Custom endpoint" rather than a blank or a
    guess.

14. Read routes mirror their neighbours rather than inventing a capability:
    organization usage/analytics for **any member** (the membership check
    `GET /organizations/:id/members` uses), project usage/analytics for anyone
    with project access (`findByIdForUser`). These are the organization's own
    metered consumption, not secret material. A non-member gets **404 rather than
    403** so an organization's existence is not disclosed, and every query is
    scoped by the org/project the caller was just checked against.

15. **Not audited.** ADR 028 item 7 already scopes out `/internal/*`
    Orchestrator-driven writes — job outcomes the API itself orchestrated rather
    than human actions — so no `recordAudit()` call was added and ADR 028's
    coverage table is unchanged.

### Web

16. `web/app/usage`, `web/app/analytics`, and their project-scoped
    counterparts render measured data, and every remaining placeholder in
    `lib/mock/monitoring.ts` for these pages is deleted.

17. **Two things the mocks displayed are removed rather than wired:**
    - **"% of limit" and "resets in N days"** — unknowable (context above). The
      pages carry a metering notice saying so instead.
    - **"By user"** — not derivable. Nothing attributes a job to the person who
      triggered it: the glossary's *acting user* is explicitly not the feature
      creator, and only mutations carry an actor (the audit trail). A per-user
      split would have been a guess, so "By model" — which is measured —
      replaces it. Per-user attribution needs an acting user recorded on each
      job, which is its own change and is not attempted here.

18. The activity graph is built from the API's **sparse** per-day counts:
    `buildActivityHeatmap` fills and week-aligns a 52-week grid (columns
    Sunday→Saturday, ending on the current week's Saturday), so a quiet day
    renders as a real zero rather than a gap, and the layout cannot drift as the
    week progresses. All date maths is UTC so server and client agree and
    hydration cannot mismatch.

19. Windows default to 30 days (max 365), and each response also carries the
    **preceding window of equal length**, so a period-over-period change needs
    no second request. Where the previous window is empty there is no percentage
    to show, and the page says so rather than reporting "+100%".

## Consequences

### Positive

- Consumption is now a measured fact, for every job kind, at no cost to the job
  itself: the capture is bounded (20s), best-effort, and never affects outcomes.
- The figures are provider truth rather than a second estimate, so they cannot
  disagree with the bill in a way Yggdrasil would have to defend.
- Four mock pages become real without inventing a single number, and the two
  things that genuinely cannot be known are named on the page instead of faked.
- The nullable-cost discipline means a future spend feature inherits a counter
  that already distinguishes "unknown" from "zero" — the distinction any cap
  would depend on.

### Negative / trade-offs

- **Cost is only as good as the provider.** A provider that reports no cost
  leaves a permanent NULL; nothing backfills it.
- **Usage is not captured for a session that died** (attach failure, pod death,
  cancellation): the RPC channel is gone by the time that is known, and blocking
  on a dead channel after the real work is done would be worse than the missing
  row. Those jobs under-report.
- **Retention is unbounded.** No pruning or rollup; `created_at` is indexed so
  partitioning is the escape hatch if volume ever demands it.
- **Deleting a project deletes its usage rows** (`ON DELETE CASCADE`), so org
  totals drop retroactively. Chosen because every read here is project- or
  org-scoped and a deleted project has no surface left to appear on; the audit
  trail is the durable record, which is precisely what it is for.
- **A job kind that reports usage but resolves no model config** stores its
  counts with a null tier rather than a misleading attribution.
- The four pages are covered by typecheck, unit tests, and a production build
  (route registration + prerender), but were not exercised against a live API
  with real usage rows.

### Follow-ups (out of scope here)

- **Caps and enforcement** — #18, with `/allocations/api` (per-project token
  cap, provider allow-list) and `/allocations/infra` (per-namespace
  ResourceQuota).
- **Live cluster telemetry** — `/infrastructure` and `/allocations/infra`
  remain mock. ADR 003 establishes namespace-per-project isolation and a
  sandboxed RuntimeClass, but **no mechanism was ever decided** for the
  API/Orchestrator to expose live cluster metrics, so those pages stay static
  and are not part of this ADR.
- **Per-user attribution** — needs an acting user recorded per job.
- **Streaming usage** (item 2) and a **usage rollup/retention policy** (item 5's
  volume escape hatch).

## Alternatives considered

| Alternative | Why not |
|---|---|
| Tokenize/estimate usage in the Orchestrator | A second, divergent source of truth that would disagree with the provider's own bill, with no way to arbitrate. Pi already reports the real numbers. |
| Stream usage from `message_update` instead of (or as well as) session end | Pi documents the field as possibly staying zero until completion when a provider does not report mid-stream, so it is least reliable exactly when it would be needed; nothing consumes a live figure. |
| Store usage on the `jobs` row instead of a table | Jobs are the queue's business; usage has its own read shapes (four aggregate groups), its own nullable columns, and a different lifetime question. A separate table keeps the queue's hot path unchanged. |
| Denormalize `organization_id` too | It belongs to the project, not the job. A stored copy would silently misattribute history if a project's org ever changed, and the join is one indexed hop. |
| Coalesce a missing cost to `0` | Makes "we were never told" indistinguishable from "it was free" — the exact distinction any future spend cap depends on. |
| Keep a fake "% of limit" scaled to measured tokens | An invented denominator. The provider's limit is unobservable by design (bring-your-own-key), so the honest move is to say so on the page. |
| Attribute usage to the feature's creator for a "By user" card | The glossary distinguishes the acting user from the creator; a build is triggered by whoever clicked *Start build*. Attributing to the creator would be a plausible-looking guess, which is worse than not showing it. |
| Audit the usage report | ADR 028 item 7 already scopes out `/internal/*` Orchestrator writes: they are job outcomes the API orchestrated, not human actions. |
| Enforce caps in this change | Mixing measurement with control: enforcement needs warn-vs-block, an authoritative counter, and an in-flight-job answer, none of which this ADR decides. Split to #18. |

## Implementation

- **Orchestrator** (`internal/rpc/session_stats.go`, `internal/worker/usage.go`,
  `internal/worker/specgrill.go`, `internal/apiclient/client.go`):
  `CommandGetSessionStats` + `ParseSessionStats`; one extra attach turn at
  session end (`fetchSessionStats`, bounded and best-effort); the stats fetch is
  injected as a function type so the existing session tests — whose stand-in
  pods speak canned JSONL, not Pi's RPC — substitute a fake instead of blocking;
  `PostJobUsage` to the internal endpoint.
- **API** (`src/db/migrations/036_job_usage.sql`, `src/usage/{types,repository,routes}.ts`,
  `src/jobs/internal-routes.ts`, `src/app.ts`): the table and its two indexes;
  the upsert; four read routes; `POST /internal/jobs/:jobId/usage` deriving
  scope from the job and attribution from the catalog.
- **Web** (`lib/features/usage.ts`, `components/usage/*`,
  `components/analytics/analytics-page-client.tsx`,
  `components/projects/project-{usage,analytics}-client.tsx`, `app/{usage,analytics}/page.tsx`):
  the pure aggregation/formatting module (unit-tested), shared presentational
  blocks, and four pages rendering measured data.

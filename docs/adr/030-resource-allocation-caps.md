# ADR 030: Resource allocation caps

**Status:** Accepted
**Date:** 2026-09-18
**Deciders:** Product session (open-issue burn-down, wave 5)
**Builds on:** [ADR 003](003-orchestrator-kubernetes.md) (§5-6 namespace-per-project
isolation, §17 the ResourceQuota this makes configurable), [ADR 023](023-token-usage-tracking.md)
(the per-job accounting that supplies the counter), [ADR 018](018-multi-provider-model-config.md)
(providers are org-owned and bring-your-own-key; the model-resolution tiers a cap rides on),
[ADR 016](016-organization-rbac-and-cluster-routing.md) (the org-admin authorization this reuses),
[ADR 028](028-audit-logging.md) (`recordAudit`, and its rule that any meaningful mutation is recorded),
[ADR 026](026-test-run-scheduling.md) (the UTC-calendar-period precedent reused for the cap period)
**Does not touch:** ADR 003 §17's *preview* slot cap (a different cap, already implemented, deliberately
enforced at claim rather than at dispatch — see §4), ADR 013's deploy automation, ADR 017's route map
(both pages keep the routes `design/` defines)

## Context

`roadmap/phases.md` Phase 4 lists "token budgets" as unbuilt, and
`yggdrasil-hq/yggdrasil-core#18` tracks it. ADR 023 has since shipped the *measurement*
half — one `job_usage` row per job, from Pi's own `get_session_stats` — which is what
makes this ADR possible: a cap needs a counter it can trust, and before ADR 023 there
was none. This is the enforcement half, deliberately split out so the counter could
land first and be seen working.

Two unrelated caps are mocked on the same page family (`design/allocations/`):

1. **`allocations/api`** — a monthly **token cap per project**, throttling that
   project's draw against the organization's own provider credential. Providers are
   bring-your-own-key and org-owned (ADR 018), so Yggdrasil *meters*; it does not bill.
   The same mock also shows a **per-project provider allow-list**.
2. **`allocations/infra`** — per-project Kubernetes **ResourceQuota** limits. Worth
   noting what already exists: `orchestrator/internal/k8s/namespace.go` has created a
   namespace plus a hardcoded `ResourceQuota` (4 CPU / 8Gi / 10 pods) since ADR 003 §17,
   with a comment saying "not yet configurable per project". The work here is therefore
   making existing limits **admin-configurable and reported**, not inventing them.

The hard question a spend cap has to answer is what happens to work already running. It
turns out the answer follows from ADR 023's own design (§4).

## Decision

### Token cap

**1. Scope: a monthly token cap per project, set by an organization admin.**
A row in `project_token_caps`; **absence means uncapped**. The cap is an override, not a
default — a project with no row behaves exactly as it did before this ADR.

**2. Only token-consuming job kinds are governed.** Exactly the five agent kinds that
resolve a model configuration: `spec_grill`, `feature_build`, `test_run`,
`agentic_review`, `design_grill`. `deploy`, `script_test_run`, and `rollback` are fully
deterministic (no Pi, no provider call), so they neither spend tokens nor can be blocked
by a spend cap. This is a deliberate product decision, not an implementation shortcut: a
project over its model budget must still be able to deploy, roll back, and run its own
script tests. Taking shipping hostage to model spend would be a worse failure than
overspending.

**3. The counter is the aggregation of ADR 023's `job_usage` rows over the current
calendar month (UTC), not a running total.**
Three reasons, in order of weight:

- **A running total is a second source of truth.** It can drift from the rows
  `/usage` and `/analytics` already display, and then an admin sees one number on the
  allocations page and a different one two clicks away, with no way to tell which is
  right. Aggregating the same rows makes disagreement structurally impossible.
- **Nothing needs the optimisation.** `idx_job_usage_project_created_at` (migration 036)
  already serves `project_id + created_at`; the cap read is one indexed `SUM` on a table
  with one row per job.
- **A counter must not be decremented by a re-report.** `upsert` is idempotent on
  `job_id` precisely because a restarted Orchestrator may re-post a whole-session
  snapshot (ADR 023). A stored running total would need its own idempotency story; a
  `SUM` gets one for free.

The period is the **UTC calendar month** — the same choice, for the same reason, as
ADR 026's test scheduling: there is no per-project timezone in the product, and UTC makes
DST structurally impossible. A month is long enough that no off-by-one-hour question ever
has to be answered.

**4. Enforcement: the API owns the decision; the Orchestrator acts on it before the job
starts any work. A job already running is never interrupted.**

The boundary is `used >= cap`, not `used > cap`. A cap of N means "at most N tokens this
period", so once exactly N are spent the budget is gone and the next job must not start.
Using `>` would let a project spend its way to N and then start one more job on top —
the single most likely way for a spend cap to be reported as working while not working.
Two consequences follow deliberately: `cap === null` is uncapped (not zero, not
infinite), and `cap === 0` permits nothing further, which is the honest reading of "spend
nothing this period" (`used > cap` would have made a zero cap mean "one more job").

**In-flight work is not interrupted, and this falls out of ADR 023 rather than being a
preference.** A job's usage is reported when its session *ends*, so at no point during a
run does a figure exist to compare against — there is no mid-run signal to enforce on.
Killing a run on the strength of *other* jobs' spend would also throw away work already
paid for while saving nothing. So the cap's job is to stop work from **starting** once the
trailing total has reached it.

The consequence is stated plainly rather than hidden: **a cap cannot prevent overshoot
within a job.** Overshoot is bounded by the jobs already dispatched when the cap is
crossed. In the normal single-user flow that is one job; a project with several features
started in quick succession could overshoot by that many. This is inherent to trailing
accounting, not a defect in the check, and §"Consequences" records the alternative.

**5. One enforcement point, at the Orchestrator's job start — not one per dispatch site.**
Given §4 there is nothing to check mid-run, so the only question is where "may this start?"
is asked. The answer is the Orchestrator, because it is the one place every origin passes
through: user-initiated routes, the internal callbacks that re-dispatch after
`request_action_item`, the test scheduler, and the webhook-driven deploy path all end in a
claimed job. Enforcing in the API's routes instead would mean instrumenting every job
creation site — around twenty across three modules — and would still miss any origin added
later; a single check where the work actually begins cannot be bypassed by omission.

**The authority stays in the API**: it holds the cap and the aggregation, so the
Orchestrator asks one question about one job and acts on the answer. Its own copy of the
kind list is a mirror with no independent authority — a kind missing there would cost an
extra question, never a wrong decision. Two *deciding* layers are avoided on purpose;
ADR 028 already established for this codebase that a rule duplicated in two places is
worse than an explicit call site.

**The consequence, stated plainly:** because the check runs after a job row exists and is
claimed, a user who clicks "Start build" on an over-cap project gets a job that starts and
immediately fails with the cap reason, rather than a refusal at the click. That is a real
UX cost of the single-point design, and a small one — the failure carries the spend, the
cap, the period and the remedy into `jobs.last_error`, which is the same channel ADR 012's
retry UI already surfaces, and the allocations page shows the blocked state before anyone
clicks. A dispatch-time API pre-check returning `409` would improve it and is cheap now
that the decision endpoint exists; it is left as a follow-up rather than built, because it
would be a second deciding path for no enforcement gain.


**6. Consumption is the job's own reported figures, so "uncapped", "zero", and "not
reported" stay distinguishable.** A token count is always provider-reported and never
estimated (ADR 023). Cost is out of scope for enforcement: providers are bring-your-own-key,
so a cost figure is informational, and the cap is on *tokens* — which is what the mock
shows and what an admin can reason about across models of very different price.

**6a. The cap counts tokens, so the model-resolution tiers (ADR 018) change how fast a
budget is spent but never what is counted — and this is the case most likely to surprise
someone.** A project's jobs may resolve their model from any of four tiers: an org
job-kind default, a project override, a per-feature override, or a project/feature custom
triplet. The cap sits above all of them and does not care which one won: it sums tokens
from `job_usage`, which records the resolved model and provider alongside them.

Three consequences worth stating outright, because each is a way someone will be
surprised:

- **A feature that overrides to an expensive model spends the *whole project's* budget
  faster.** The cap is per project, not per feature or per job kind, so one feature's
  override is not isolated to that feature. An admin who caps a project and then lets a
  single feature point at a premium model has not capped that feature's spend — they have
  shortened everyone's runway.
- **Token ceilings are not cost ceilings.** Two projects at the same token cap can differ
  by more than an order of magnitude in what they cost, because tokens are priced per
  model. An admin reasoning about money while reading a token cap is reading the wrong
  number, which is why `/usage` shows cost beside tokens and why §Follow-ups leaves a
  cost-based cap open.
- **Only the five agent kinds count, including `test_run` and `agentic_review`.** A
  project whose review or test model is overridden to something large burns budget on
  reviews and test runs, not just on builds. That is correct — they are real spend — but
  it is not obvious from "the build is capped".

No per-tier or per-kind cap is built. If per-feature budgets are ever wanted, the
`job_usage` rows already carry `feature_id` through the job, so the counter supports it;
what would be needed is a decision about whether the tiers *nest* (a feature cap inside a
project cap) or *replace* one another, which is a product question rather than a data one.

**7. There is no warn-vs-block setting; a cap blocks.** Considered and rejected: a cap
nobody enforces is indistinguishable from no cap, and a "warn" mode would double the state
machine (two enforcement semantics × two caps × the UI states for each) to provide a signal
the presentation layer already gives — the allocations page derives an "approaching" state
at 80% from the same numbers, which is what a soft rollout actually wants. An admin who
wants visibility without teeth leaves the cap unset and reads `/usage`, which needs no new
concept to work.

**8. An admin raises or clears a cap from the same page that set it.** Setting is an upsert;
clearing deletes the row, because absence *is* "uncapped" — a sentinel value could not be
told apart from a real limit. Both are audited with the previous value
(`project_token_cap.set`), so the trail shows what changed and what it changed from.

### Resource quota

**9. Per-project CPU / memory / pod limits, admin-set, applied to the project's namespace
ResourceQuota — making the ADR 003 §17 defaults configurable.** Stored in
`project_resource_quotas`; absence means "use the platform default".

**10. Limits are stored normalized — millicores and MiB — not as Kubernetes quantity
strings.** Quantity syntax is a wide surface (`"500m"`, `"0.5Gi"`, `"1e3"`, `"1.5"`) to
validate in the API and to get wrong; integers are exactly representable and trivially
validated. Formatting into quantities happens in `orchestrator/internal/k8s`, the one
component that actually talks to Kubernetes, so the syntax lives where it is consumed
rather than being round-tripped through the API as text. The API's admin surface accepts
human units (vCPU, GiB) at the edge and converts once.

**11. The Orchestrator now *applies* a quota, where it previously only created one.**
Before this, the quota was written once at namespace creation and never revisited — so an
admin's change could not have taken effect on an existing namespace even if it had been
stored. The update path is the part that makes this page real rather than cosmetic.
(The same create-only limitation is why `secret.go` documents needing its own update
path.) The update **merges** the three managed keys into the existing `Hard` map rather
than replacing it, so limits this package does not manage survive — a bug the
fake-clientset test caught during implementation.

**12. No `LimitRange` is added.** ADR 003 §17 mentions "ResourceQuota/LimitRange", but a
LimitRange supplies defaults to pods that omit requests/limits — and every job pod
already declares them explicitly (`jobrunner.go`'s comment records that this is required
precisely *because* the quota demands it). A LimitRange would be redundant today. It
becomes worth adding only if something in the namespace can create a pod that does not
declare limits.

**13. A failed quota read falls back to the built-in defaults; it does not fail the job.**
Quota sizing is a guardrail, not a correctness dependency, and a transient API failure
must not cost a job. This is why the defaults exist in two places (the API, where an
admin sees them; the Orchestrator, as the fail-soft fallback) — an accepted duplication,
recorded in §"Consequences" with the note that the two must be changed together.

### Both

**14. Authorization — write is admin-only; read is member-visible.** This follows ADR
016's org-admin gate for mutations (matching org secrets, cluster, and providers). The
read deliberately does **not**: the `design/` note says "org-admin-only in concept", but
a cap is not a credential like a provider key — it is the operational fact explaining why
a project's work stopped, and hiding it from the developer who is blocked converts a
clear "you are over cap" into an unexplained failure. Project names and limits leak
nothing sensitive.

**15. Both caps are per-project and organization-scoped.** Every read and write resolves
the project inside the organization named in the path, so an admin of one organization
cannot reach another's project by guessing an id.

**16. Every cap mutation is audited** (`project_token_cap.set`,
`project_resource_quota.set`), with the previous value in metadata. ADR 028's coverage
table gains both rows.

**17. The provider allow-list is NOT built here.** It is bundled on the same mock page,
so it needs an explicit answer rather than silence. Deferred because **it cannot be made
to mean what the mock implies**: an allow-list restricts which *catalog* providers a
project may draw from, but a project can bypass the catalog entirely by supplying its own
custom `MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_ID` triplet (ADR 018 §6, and the
per-feature tier on top of it). An allow-list over catalog providers would therefore
leave a project free to reach any endpoint the admin was trying to exclude — security
theatre, and worse than none because it reads as a control. Making it real requires first
deciding what a custom triplet means under an allow-list (forbid it? treat it as an
implicit provider? validate its endpoint against an org-level list?), which is a product
question with its own failure modes and belongs in its own ADR. The page renders the
provider pills disabled with that reason attached so the surface is accounted for.

**18. `/infrastructure` and `allocations/infra`'s live cluster telemetry remain out of
scope and are not faked.** The mock's "cluster capacity", "allocated across projects" and
"live utilization" figures assume the API or Orchestrator can expose live cluster metrics
and per-pod usage. **No mechanism for that exists or is decided** — it would mean either a
metrics pipeline (Prometheus or equivalent) or on-demand queries against the cluster from
the API, neither of which this product has. Those cards are therefore not rendered on the
real page; the page says why. The same applies to `design/usage`'s "resets in N days",
which is the *provider's* billing cycle and not observable.

## Consequences

### Positive

- Spend becomes governable using numbers that already existed and were already trusted,
  with no new accounting path and no second counter to keep in sync.
- The two caps cover genuinely different failure modes — runaway model spend, and one
  project's workloads crowding a shared cluster — and neither interferes with the other.
- Resource limits become adjustable without a redeploy or a hand-edited constant, which
  is the first time the ADR 003 §17 quota has been reachable by an operator at all.
- Containing the decision in the API means the Orchestrator has no cap policy of its own;
  a change to what a cap means cannot leave the two sides disagreeing.

### Negative / trade-offs

- **A cap cannot prevent a single job from overshooting**, because usage is reported only
  at session end. Bounded by the jobs already dispatched, but real. The alternative —
  killing runs mid-flight — was rejected as costing more than it saves (§4).
- **Enforcement is dispatch-time only, and the user sees it as a failed job.** A job created
  a moment before the cap is crossed still runs; and because the check happens when the job
  begins rather than when the user clicks, the refusal arrives as that job's failure rather
  than an immediate error (§5, follow-up 2).
- **The platform-default quota exists in two repositories** (the API's, which an admin
  sees, and the Orchestrator's fail-soft fallback). Accepted so that a quota-read failure
  cannot fail a job; the two must be changed together.
- **A cap on tokens constrains spend only as well as the provider's own reporting.** If a
  provider does not report usage, its jobs count as zero and the cap cannot see them.
  ADR 023 already treats absent figures as `null` rather than guessing, so the failure is
  visible in `/usage` even though it is invisible to the cap.
- **One extra HTTP call per token-consuming job** (the Orchestrator's cap check), plus one
  for the quota, and one indexed `SUM` per allocations page load.
- The audit trail records *that* a cap changed and to what, not *why*.

### Follow-ups

1. **The provider allow-list** (§17) — needs its own ADR answering what a custom triplet
   means under one.
2. **A dispatch-time API pre-check** so an over-cap "Start build" is refused at the click
   with a `409` instead of starting and immediately failing (§5). Cheap now that the
   decision endpoint exists; deliberately not built here to avoid a second deciding path.
3. **Live cluster telemetry** (§18) — capacity, allocation and utilisation need a metrics
   mechanism that does not exist; `/infrastructure` stays a mock until it does.
4. **Cost-based caps.** This ADR caps tokens; `job_usage.cost_usd` is already recorded, so
   a USD cap is a natural addition once someone needs it. Deferred because providers are
   BYO-key and cost reporting is per-provider and often absent.
5. **Overshoot beyond one job** — a merge queue / dispatch gate that reserves budget
   atomically would bound it properly. Worth doing only if overshoot is observed to hurt.
6. **A per-job-kind breakdown of a project's spend against its cap**, so an admin can see
   which kind is consuming the budget. `/usage` already has the by-kind data.
7. **Per-project timezone for the period boundary**, if that ever matters (the same
   follow-up ADR 026 left open).

## Alternatives considered

| Alternative | Why not |
|---|---|
| A stored running total per project, incremented on each usage report | A second source of truth that can drift from the rows `/usage` shows; needs its own idempotency for re-reports; the aggregation is already indexed and cheap (§3). |
| Enforce at the Orchestrator, one check before the job starts | **Chosen.** The only point every dispatch origin passes through, so no origin added later can silently bypass the cap (§5). |
| Enforce in the API's job-creation routes | Would need instrumenting ~20 sites across three modules, and any creation site added later silently bypasses the cap (§5). |
| Enforce at the queue claim, like ADR 003 §17's preview cap | Right for previews, wrong here: an over-cap preview slot frees in seconds, but a monthly cap could leave a job `pending` for weeks — a silently never-starting job is worse than one that stops and says why. It would also hide the reason from the user. |
| Kill or pause running jobs when the cap is crossed | No mid-run figure exists to justify it, and it discards work already paid for. Strictly worse than overshooting (§4). |
| Check at dispatch *and* at claim (two enforcement points) | Nothing to check mid-run (§5), and a duplicated rule in two components is the thing this codebase already decided against in ADR 028. |
| A `warn` enforcement mode alongside `block` | A cap with no teeth is indistinguishable from no cap, and the "approaching" signal is a presentation concern already derived from the same numbers (§7). |
| Reuse ADR 016's `role_capabilities` matrix for a new `allocations_manage` capability | The matrix is seed data that is not wired into enforcement anywhere; introducing a capability would be a new concept, where reusing the established org-admin check is not (§14). |
| Store quotas as Kubernetes quantity strings | A wide syntax to validate and to get wrong; integers are exact, and the one component that needs quantity syntax can produce it (§10). |
| Add a `LimitRange` alongside the quota | Redundant while every pod declares its own requests/limits (§12). |
| Explicit `null`/sentinel value for "uncapped" | A sentinel cannot be told apart from a real limit; absence of a row is unambiguous (§8). |

## Implementation

- **`api/`** — `src/allocations/` (`types`, `evaluate` (pure), `repository`, `routes`,
  `internal-routes`), migration `042_allocation_caps.sql`, mount in `src/app.ts`, two audit
  actions in `src/audit/actions.ts`.
- **`orchestrator/`** — `internal/apiclient` (`CheckProjectTokenCap`,
  `FetchProjectResourceQuota`), `internal/worker` (`enforceTokenCap`, called before any work;
  quota fetched and passed through), `internal/k8s/namespace.go` (quota parameter, update
  path, merge-not-replace), `internal/queue` (`ConsumesTokens`).
- **`web/`** — `lib/features/allocations.ts` (pure presentation + unit conversion),
  `lib/api.ts` + `lib/features/types.ts` (read/write), and both pages rebuilt on real data.
  The per-row Save replaces the mock's single page-level "Save changes": with real
  projects a page-level save would issue N writes that can partially fail, leaving the page
  showing a state the API does not have.

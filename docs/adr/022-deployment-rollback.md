# ADR 022: Primary deployment migration/rollback safety net

**Status:** Accepted
**Date:** 2026-09-17
**Deciders:** Product session (open-issue burn-down, wave 3)
**Resolves:** `roadmap/open-questions.md` #9 — "Primary deployment
migration/rollback safety net"
**Builds on:** [ADR 003](003-orchestrator-kubernetes.md) (§9-13: one always-on
primary deployment per project, auto-redeploy on merge to `main`, imperative
Helm via the Go SDK, Postgres-backed job queue), [ADR 013](013-pr-merge-webhooks.md)
(deploy status feedback and the manual "Deploy now" trigger this extends),
[ADR 016](016-organization-rbac-and-cluster-routing.md) (per-org cluster
resolution at claim time), [ADR 028](028-audit-logging.md) (the audit trail the
rollback action is recorded in)
**Does not touch:** ADR 017's `design/` wireframes or the mock surfaces for
Preview/Staging; ADR 015's feature lifecycle; the `deploy` job's own definition
(unchanged — rollback is a sibling kind, not a modification of it)

## Context

ADR 003 §9 gave every project an always-on primary deployment that redeploys
automatically on merge to `main`. Its own "Negative / trade-offs" section
recorded what that cost:

> **No migration safety net for primary deployment auto-deploys** — a bad
> migration against real project data on merge to `main` has no automatic
> rollback yet. Accepted explicitly to ship an MVP faster.

That acceptance has now expired. Two things made the gap concrete:

1. **Nothing recorded what was deployed.** Deploys ran `helm upgrade --install`
   and reported only pending → running → completed/failed onto the `jobs` row.
   The Helm revision they produced lived in the cluster's release history and
   nowhere else, so there was no *record* of a prior state to return to —
   even for a human doing it by hand.
2. **`design/deployments` and `design/projects/detail/deployments` mock a
   "Production" row against exactly this question**, and that row's own
   design-note calls Staging "the least grounded of the three — it isn't
   decided at all, it's explicitly open-questions.md #9".

This ADR decides #9. What made the decision sharp is that the question had been
framed as *"staging branch + staging deployment gate vs. nothing"*, when the
actual failure mode an operator faces is narrower: a deploy that is *known bad*
with a *known predecessor* still running in the cluster's release history. That
does not need a second environment.

## Decision

### 1. Rollback first. No staging branch, no staging deployment gate.

The accepted fix is an explicit rollback path plus deploy history. A staging
environment is **considered and deferred**, not overlooked — this is a decision,
and the trade-off is stated in §12 rather than left implicit.

A staging branch would require a second long-lived deployment per project, a
second set of project secrets, a promotion flow with its own authorization, and
a second Ingress — all to protect against a class of failure (a migration that
only breaks against real data) that rollback already addresses for the case
that actually happens in practice. Staging's genuine advantage is *catching* a
bad deploy before production sees it; rollback only *undoes* one after. That is
a weaker guarantee, and §12 says so plainly. It is also the guarantee ADR 003
already committed to shipping first.

Consequence for the wireframes: `design/.../deployments`'s **Staging row is now
a settled "not built" rather than a pending decision**, so the real page drops
it (§11). Preview is untouched — its absence is ADR 003's ephemeral-tunnel work
(issue #1), an unrelated open item, and the page keeps a labelled placeholder
for it.

### 2. Rollback is a new, non-agent job kind — not a synchronous call, not a `deploy` variant.

`rollback` joins `deploy`, `script_test_run` and `design_grill` as a job the
Orchestrator runs deterministically: no Pi, no attach/RPC, no agent image.

- **Not a synchronous Orchestrator call.** Every cluster-mutating operation goes
  through the Postgres queue (ADR 003 §18), which is the durability boundary for
  it. Routing rollback around the queue would give the *recovery* path weaker
  crash-safety than the deploys it exists to undo — an API process that dies
  mid-request would leave an operator believing a rollback happened (or didn't)
  with nothing to check.
- **Not a `deploy` variant.** The two operations differ in authorization intent,
  in audit action, and in what history has to say about them; conflating them
  would make the ledger unable to answer "was production rolled back, and for
  how long". Precedent: `script_test_run` is likewise a distinct non-agent kind
  rather than a variant of `test_run`.

The job carries its target on its own row (`jobs.target_revision`, migration
035), pinned when the API enqueues it. A rollback therefore keeps the revision
the operator chose even if a deploy lands before the worker claims it — resolving
"the revision before the current one" at claim time would silently roll back to a
different state than the one that was approved.

### 3. The Orchestrator records the Helm revision the deploy *produced*.

`helm.Deploy` now returns the revision from Helm's own release object
(`release.Version`) instead of only an error, and `helm.Rollback` returns the
same for a rollback. Two reasons not to re-derive it later from release history:
a concurrent operation makes "the latest revision" ambiguous, and `History`'s
ordering is not part of Helm's storage-driver contract.

**This is the detail most likely to be misread, so it is stated explicitly:
a rollback does not rewind the revision counter.** Rolling back to revision 3
from revision 9 creates revision **10**, whose content matches revision 3. So
each ledger row stores both numbers — `helm_revision` (produced) and
`target_revision` (requested) — and it is `helm_revision` that identifies what
is running. This is also what makes the ledger's rollback targets correct
without consulting the cluster.

### 4. A per-project deploy ledger (`project_deploys`), append-only.

One row per deploy or rollback that reached a terminal state: project, job,
kind, produced revision, target revision (rollbacks), terminal status, error,
git ref, timestamp.

- **Append-only, no update or delete path.** A ledger whose rows can be
  rewritten is not a record of what happened; correcting a bad entry is a new
  entry.
- **Written at the Helm boundary, not at job creation.** A failure *before* Helm
  ran (a secret fetch, a chart fetch, an unreachable cluster) produced no
  revision and so belongs to the `jobs` row, not to the release ledger. A
  failure *during* a Helm operation **does** get a row, with `helm_revision`
  NULL — which is what keeps "which revisions can I roll back to" unambiguous:
  only rows with a non-NULL revision are candidates.
- **Keyed to the job but not owned by it** (`job_id ... ON DELETE SET NULL`).
  The ledger is what makes rollback possible, so it must outlive the queue row
  that produced it.

### 5. The Orchestrator reports completion to a dedicated internal endpoint.

`POST /internal/jobs/:jobId/deploy-result`, bearer-token authenticated like the
existing internal surface.

- **Not a curated job event.** Deploy is not agent-driven and has no event
  vocabulary; it has exactly one terminal fact to report (which revision it
  produced) that the `jobs` row cannot express. Overloading the event stream
  would imply a conversation where there is only a result.
- **The ledger row is derived from the job**, not trusted from the body —
  project, kind and git ref all come from the row the API itself enqueued, so a
  buggy or compromised caller cannot attribute a deploy to another project or
  dress a rollback up as a routine deploy. Only the outcome fields (revision,
  target, error) come from the request.
- **A failed report does not fail the job.** The release really was applied, so
  marking the job failed would report a true outcome as a false one — the same
  principle as ADR 028's non-fatal audit write. The cost is real, though: that
  revision is then absent from the ledger and so not offered as a rollback
  target, so the worker logs it loudly with the revision named rather than
  swallowing it (§12, follow-ups).

### 6. One deployment operation at a time per project.

Both `POST /deploy` and `POST /rollback` refuse (409) while any `deploy` **or**
`rollback` is pending/running, so the two kinds share a single in-flight guard.
Asking only about `deploy` would let a rollback run concurrently with a deploy.

Placed on both sides deliberately: a rollback requested mid-deploy would race
that deploy on one Helm release, and Helm would reject whichever operation
arrived second with an "another operation is in progress" error — a confusing
failure in place of a clear refusal.

**Helm is the second line of defence, not the first.** `action.Rollback` and
`action.Upgrade` mark the release `pending-rollback`/`pending-upgrade` while they
run and refuse to start against a release in one of those states, so a race that
slips past the check-then-enqueue guard fails the second job loudly instead of
corrupting release state. **The guard is not atomic** — it reads, then inserts —
so this window is real and accepted; §12 records the constraint that would close
it.

### 7. Rollback authorization reuses the project-access gate.

`POST /projects/:projectId/rollback` is gated exactly like every other project
mutation (`projects.findByIdForUser` — project membership), not a new capability
and not an org-admin-only check. The capability matrix (`role_capabilities`)
exists but is not wired into enforcement anywhere in the API, so inventing a
`deploy_rollback` capability here would create a permission concept that nothing
enforces while every neighbouring route used the membership gate. Rollback is
thus exactly as privileged as "Deploy now", which is why §8's audit and §9's
confirmation carry the weight that the authorization does not.

### 8. Rollback is audited; the routine deploy trigger still is not.

A new `deploy.rolled_back` audit action is recorded with actor, project, the
revision being undone and the revision requested.

ADR 028's out-of-scope table lists the manual `deploy` trigger as unaudited,
with the reason that "the `deploy` job row plus ADR 013's deploy-status feedback
already record this; the trail adds a duplicate with no actor detail the job row
lacks". That reasoning does **not** carry over to rollback: the job row still
carries no actor, and "who sent production back to an older revision, and when"
is precisely the question an audit trail exists to answer for a destructive
operation. The asymmetry is therefore intentional and this note exists so a
reader does not read it as an oversight. Auditing the plain `deploy` trigger for
consistency is a deliberate non-goal here (§12).

### 9. The UI requires deliberate confirmation, and states the consequence.

The project deployments page offers rollback only for entries that actually
applied something and are not already live (rolling back to the running revision
is a no-op). Confirmation is **inline next to the row**, not a modal: the
operation is destructive, and a modal invites dismissal without reading.

The confirmation names both revisions and says explicitly that the revision
being left **stays in history** — because "roll back" reads to most people as
"rewind", and an operator who believes the old revision is being discarded will
make a different decision than one who understands a new revision is created.

### 10. Pre-Helm failures stay on the job row; the ledger is about releases.

Stated in §4, repeated here because it is a deliberate boundary rather than an
omission: a deploy that never reached Helm leaves no ledger row. Its outcome is
still visible — the `jobs` row's status and `last_error`, surfaced by the
existing ADR 013 status panel — but it does not appear in the release history,
because no release event occurred.

### 11. Scope of the page change under ADR 017.

The project deployments page was built as a static mock under ADR 017. This ADR
makes its **Production row real** (status, live revision, deploy history, and
rollback controls) and **drops the Staging row** per §1. Preview keeps a labelled
placeholder. `design/` itself is untouched — it remains a proposal, and a
proposal may still show a Staging row; the divergence between wireframe and
product is recorded here rather than by editing the wireframe.

## Consequences

### Positive

- A bad deploy is now reversible by an authorized user, from a UI, with the
  action attributable to a person after the fact.
- The project has a durable answer to "what is running, and what was it before"
  that survives the queue row, the worker, and a cluster's own release-history
  pruning.
- The revision contract is pinned by tests, including the counter-does-not-rewind
  behaviour that a future reader is most likely to assume otherwise.
- Reusing the existing job queue means rollback inherits the same crash-safety,
  retry and multi-replica behaviour as deploy, with no new mechanism.

### Negative / trade-offs

- **Rollback is not prevention.** It cannot stop a bad migration from reaching
  production, only undo it afterwards; data mutated by a migration is not
  restored by reverting manifests. This is the gap a staging gate would close,
  and §12 keeps it open deliberately.
- **Two revisions of drift are possible** between what the ledger believes is
  running and what the cluster actually runs, if a report is lost (§5) or
  someone deploys outside Yggdrasil.
- **No deploy currently records the triggering commit.** The ledger's `ref` is
  populated from the job row, and deploy jobs are dispatched without one, so it
  is usually NULL — the "which commit caused this" column is structurally
  present but mostly empty today.
- The in-flight guard is check-then-enqueue, not atomic (§6).
- A rollback does not restore rotated secrets: project secrets are applied
  imperatively outside Helm (ADR 003 §16), so they are inputs to a release
  rather than part of it. Rolling back application code while keeping current
  credentials is the right default, but it is a real difference between "the
  state before" and "the state after undoing", and operators should know it.
- Rollback targets come from Yggdrasil's own ledger, so revisions applied
  outside Yggdrasil are invisible to the UI even though Helm knows about them.

### Follow-ups

- **Transactional/atomic in-flight guard** — a partial unique index on
  `jobs(project_id) WHERE kind IN ('deploy','rollback') AND status IN
  ('pending','running')` would close §6's window at the database rather than in
  the route.
- **Report retry / outbox** for `/internal/jobs/:id/deploy-result`, so a lost
  report cannot silently remove a revision from the rollback targets (§5).
- **Record the triggering commit** on deploy jobs so `project_deploys.ref` is
  meaningful (webhook and manual dispatch both currently omit it).
- **Audit the `deploy` trigger** for symmetry with §8, which would mean moving a
  row out of ADR 028's out-of-scope table.
- **History pagination** — the endpoint returns a bounded window with no cursor.
- **Live cluster telemetry** (`/infrastructure`, `roadmap/open-questions.md` #15)
  remains unbuilt and unrelated: this ADR reads Yggdrasil's own ledger, not the
  cluster.
- **Staging** stays deferred (§1). If real projects suffer data-mutating
  migration incidents that rollback cannot undo, that is the evidence that would
  justify revisiting it.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Staging branch + staging deployment gate** (the original framing of #9) | Considered and deferred (§1): a second environment per project, second secret set, promotion flow and second Ingress, to catch a narrower failure class than the question implies. Rollback is the weaker but much cheaper guarantee, and ADR 003 already committed to shipping it first. |
| **Synchronous Orchestrator call from the API** | Bypasses the queue that every other cluster-mutating operation uses (ADR 003 §18), giving the recovery path weaker crash-safety than the deploys it undoes, and blocking the API on a multi-minute Helm operation. |
| **`deploy` variant with a target revision** | Conflates a deliberately-authorized destructive action with routine automation in history, audit and the in-flight guard. Precedent is against it: `script_test_run` is a distinct kind rather than a `test_run` variant. |
| **Keep reporting only job status; read revisions from Helm history on demand** | Requires a cluster round-trip to answer a UI question, cannot distinguish a Yggdrasil deploy from an out-of-band one, and leaves nothing to roll back to if the release is uninstalled. |
| **Store the ledger in the Orchestrator's memory or logs** | The Orchestrator runs as multiple replicas (ADR 003 §20) and holds no persistent state by design; the API owns persistent state. |
| **Derive the current revision from release history at claim time** | Ambiguous under concurrency and dependent on storage-driver ordering; §3 stores what Helm reported instead. |
| **Auto-rollback on a failed deploy** | A failed `helm upgrade` does not necessarily leave a running-but-broken release, and automatic rollback of a *migration* can compound data damage. Recovery stays an explicit human action, matching ADR 015's "always requires an explicit human click to resume" precedent. |
| **Reuse the `deploy` job's status fields instead of a ledger table** | The `jobs` row is queue state with a different lifecycle (claimable, cancellable, deletable); the ledger must outlive it (§4). |

# ADR 021: Parallel feature builds — base sync and agent-resolved conflicts

**Status:** Accepted
**Date:** 2026-09-17
**Deciders:** Product session (open-question #5 review)
**Builds on:** [ADR 002](002-projects-features-tests.md) (features are the unit of
work; PRs are the review gate), [ADR 008](008-project-init-grill-and-submodule-repos.md)
(sub-repos are submodules, so a base sync moves their pointers too),
[ADR 010](010-feature-build-rpc-wiring.md) (the entrypoint writes ADR_MARKDOWN and
checks out FEATURE_BRANCH before Pi starts), [ADR 013](013-pr-merge-webhooks.md)
(merge/pull-request webhooks — the merge-side automation this decision
interoperates with)
**Does not touch:** ADR 006/011/012 (Pi RPC session machinery, the `queued`/`running`
gap, and retry semantics — a conflicted workspace is still an ordinary running job),
ADR 015 (the six-stage lifecycle — conflicts are discovered during Implementation,
not as a new stage), [ADR 018](018-multi-provider-model-config.md) (model
configuration; unrelated to which commit a branch starts from)

## Context

Two features can be built in parallel: ADR 002 gives each feature its own branch,
and nothing serializes `feature_build` jobs. Both branches start from whatever
`main` was at the moment each job began. Whichever merges first is fine; the second
one is now built on a base that no longer exists at the tip, so its PR arrives
conflicting. Today that is only discovered **at merge time** — by a human, in
GitHub, after the whole build has already run and been paid for.

`roadmap/open-questions.md` #5 records this as undecided. The obvious candidate
fix — a per-project lock so only one `feature_build` runs at a time — was
considered and rejected: it converts a merge-time annoyance into a scheduling
one (a ten-minute build blocks every other feature in the project), and it does
not actually solve the problem, because *sequential* builds still race against
any human merge that lands between them.

The chosen direction is to make the **build itself** responsible for starting
from a current base and for reconciling the difference when the base moved in a
way that conflicts, rather than making the job fail or serializing projects.

Two facts shape the design:

- The container already hands workspace failures to the agent deliberately. The
  entrypoint's clone check (ADR 006 item 6) exists precisely because an agent
  given an empty or wrong workspace improvises badly — it once `git init`ed a
  fresh repo and planned to push to it. The corollary also holds: an agent given
  a *correct but conflicted* workspace is in a position to fix it, and the
  implement skill already expects to make judgment calls rather than stop.
- A conflict is not an error condition the Orchestrator can resolve, and it is
  not a reason the feature is unbuildable. It is ordinary work of the kind the
  job exists to do — deciding how two changes should coexist.

## Decision

### Branch sync

1. **A `feature_build` run starts its branch from the tip of the remote default
   branch**, not from whatever commit the container's fresh clone happened to
   land on. The entrypoint resolves that base via `origin/HEAD` (falling back to
   `origin/main`) and creates the branch at it. Anything merged before this build
   began is therefore already in the branch, which removes the conflict case
   entirely for every feature whose competitor merged while it was queued.

2. **A retry continues the feature's existing branch.** If `origin/<feature-branch>`
   already exists, the run checks that out and merges the base into it, instead
   of restarting from the base. This is both correctness and a fix for an
   existing latent bug: the old code created a *fresh* branch from HEAD on every
   attempt, so a retry after a partially-pushed build silently discarded the
   earlier attempt's commits and then made the skill's final `git push` fail as
   non-fast-forward. The branch name is derived from the feature id
   (`yggdrasil/<feature-slug>-<id>`), so a retry finds it deterministically.

3. **Submodule pointers are refreshed after the checkout and after a clean
   merge**, since ADR 008 makes a project's sub-repos submodules of the primary
   repo and either step can move their pointers.

### Conflicts are the agent's work

4. **A merge conflict does not fail the job.** The merge is left in place — the
   conflicted tree, `.git/MERGE_HEAD`, and the conflict markers — and the run
   hands it to the agent:
   - `YGGDRASIL_MERGE_CONFLICTS=1` is exported into the job pod's environment.
   - `/workspace/.yggdrasil/merge-conflicts.md` is written, listing the
     conflicted paths and the steps to resolve them.

   The agent resolves them as **step 1 of the implement skill**, before reading
   the ADR and before implementing anything: edit each file keeping both intents
   where they are compatible, `git add`, `git commit` to complete the merge.

5. **The fatal/not-fatal split is preserved deliberately.** A failed **fetch**
   (or clone) still kills the job before Pi starts — the agent must not begin on
   a workspace whose base could not be verified, exactly as the existing clone
   check requires. A failed **checkout** is likewise fatal. But a merge that
   *fails without leaving unmerged paths* (an unresolvable base ref, a dirty
   tree, an untracked file in the way) is also treated as fatal rather than being
   misreported as a conflict, so a genuinely broken workspace never reaches the
   agent dressed up as a merge it can resolve.

### Why the agent rather than a hard failure

6. **The alternative — fail the build and let a human re-trigger it — is worse.**
   It spends nothing less than resolving does, and it discards a completed
   implementation over a textual conflict the agent is already in a position to
   understand: it has the ADR, the codebase, and both sides of the diff in front
   of it, and the conflicting change is usually described in the ADR corpus it
   was told to read. Failing also misrepresents the cause: the feature is not
   unbuildable, its base merely moved.

7. **Wrong resolutions are caught by the PR, not by this mechanism.** The
   agent's output is a **draft** PR (ADR 002/010), and a human reviews it before
   merge. The skill is explicitly told not to make a conflict disappear by
   reverting the other feature's work, and to name the resolved files in the PR
   description. This is the same backstop that already covers every other way an
   implementation can be wrong — no new review surface is introduced, and
   nothing here merges a PR automatically.

8. **Interoperates with ADR 013 without change.** ADR 013's `pull_request`
   (closed + merged) and `pull_request_review` webhooks observe the *outcome*;
   they do not care how the branch got its base. A conflicted-then-resolved
   branch merges and fires `merged` exactly like any other. No webhook, state, or
   API surface changes.

### The residual race, accepted

9. **The base can still advance after this sync and before the PR merges.** This
   deliberately does not close that window, and cannot without a merge queue or
   locking, which is rejected above. The window is now as narrow as the build
   itself instead of spanning from job dispatch, and the failure mode for
   whatever falls in it is unchanged and safe: GitHub reports the conflict at
   merge time, and re-running the build (ADR 012's retry, finding the existing
   branch per item 2) re-syncs and re-attempts. A future merge queue would be the
   real fix and is left as a follow-up rather than pre-built here.

## Consequences

### Positive

- The common parallel-build case is eliminated, not merely detected later: a
  feature whose competitor merged before this build began starts from a base that
  already includes it.
- A conflict no longer costs a whole build cycle plus a human re-trigger, and does
  not present itself as a failure of the feature.
- Retries no longer lose the previous attempt's commits, and no longer fail at
  the final push as non-fast-forward.
- No new moving parts: no lock, no queue, no scheduler, no new job kind, no API
  change.

### Negative / trade-offs

- **The agent can resolve a conflict wrongly** — plausibly by dropping the other
  side's intent. Mitigated by the draft-PR review gate and explicit skill
  instructions (item 7), not prevented by construction.
- **The run is longer and less predictable** when conflicts are present: the
  agent spends tokens on reconciliation before any feature work, and a
  pathological conflict could exhaust the turn budget. The job then fails like
  any other run (ADR 012 retry applies).
- **Conflicted intermediate states are visible in the pod but not in the
  product.** Nothing in the API or Web app distinguishes "this build resolved
  conflicts" from any other build today; the PR description is the only record.
  Surfacing it as an event would need a curated event nothing currently emits.
- The residual race in item 9 remains open by design.

### Follow-ups (out of scope here)

- ~~**A curated event (or job annotation) for "built on top of a base sync,
  resolved N conflicts"**, so the Web app can show it and a reviewer sees it
  before opening the PR.~~ **Done** (issue #27). The event is `merge_conflicts`,
  and it names the conflicted files rather than counting them — the list is what a
  reviewer acts on, and a count would leave them hunting through the diff.

  It is synthesized by the **Orchestrator**, not emitted by the pod and mapped in
  `rpc.Translate` as this follow-up imagined. Two reasons, both recorded in
  `orchestrator/internal/worker/mergeconflicts.go`: `Translate` translates *Pi's*
  vocabulary and this is not something Pi knows about (the entrypoint computed it
  before Pi was exec'd), and the alternative — having the entrypoint POST to the
  internal events endpoint — would hand every agent pod the shared internal bearer
  token, which reaches every `/internal/*` route.

  Ordering is the part worth noting: the marker is read lazily on the session's
  *first* curated event rather than when the pod reports Running, because
  `WaitForJobPod` returns before the entrypoint has finished merging. Pi cannot
  produce an event until the entrypoint exec'd it, so the read is ordered after
  the merge by the pod's own lifecycle rather than by a timeout.
- **A merge queue**, the only real fix for item 9.
- **Concurrent builds touching the same submodule** are still just a conflict for
  the agent to resolve; a policy for *which* side wins per submodule is not
  attempted.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Per-project single-build lock** (queue features, one `feature_build` at a time) | Turns a merge-time conflict into a scheduling cost for everyone in the project, and still races any human merge landing between two sequential builds. Rejected by the operator before implementation. |
| **Do nothing; let GitHub report the conflict at merge time** | The status quo, and the thing open question #5 exists to fix: the conflict is found only after the build is spent, and a human must re-trigger it. |
| **Rebase the feature branch onto the base at build start** | Rewrites already-pushed history, which would invalidate any PR/commit references and make a retry's push non-fast-forward. A merge preserves both sides without rewriting. |
| **Fail the job on conflict and auto-retry after a delay** | Discards a complete implementation to avoid a textual conflict, and an unattended retry loop cannot decide *how* the two changes should coexist — a human would have to specify the resolution anyway. |
| **Resolve conflicts in the Orchestrator (a merge tool, not the agent)** | The Orchestrator has no model of what either change intends; it would be guessing with less context than the agent has. |
| **Sync the base at PR-open time instead of build start** | The agent's commits and submodule pointers were already produced against a stale base, so by then the conflict is discovered in the same place as today — at merge. |

## Implementation

- `agent-images/base/entrypoint.sh` — base resolution, branch creation, the
  retry path's merge, the conflict marker and exported env var, and the
  fatal/not-fatal distinctions (items 1-5).
- `agent-images/feature_build/skills/implement/SKILL.md` — conflict resolution as
  step 1, with the two explicit prohibitions (no abort; no reverting the other
  side) and the PR-description requirement (items 4, 7).
- `agent-images/docs/concepts/skills.md` — the shared-convention note that a
  workspace may arrive mid-merge.

No API, database, Orchestrator Go, or Web change is required: the base sync and
the conflict hand-off both happen inside the job pod before Pi starts.

> **Meta-repo doc sync owed (parent-owned):** remove row #5 from
> `roadmap/open-questions.md` (and note it among the resolved questions there),
> and add the decision to `CONTEXT.md`. `roadmap/phases.md` needs no edit — it
> does not mention branch conflicts today.

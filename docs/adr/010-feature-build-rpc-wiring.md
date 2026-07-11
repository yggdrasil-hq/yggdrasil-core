# ADR 010: Extending Pi RPC wiring to `feature_build`

**Status:** Accepted
**Date:** 2026-07-12
**Deciders:** Product/design session (grill-me)
**Builds on:** [ADR 006](006-pi-rpc-orchestrator-integration.md) (Pi RPC integration in the Orchestrator, scoped to `spec_grill` only), [ADR 004](004-agent-base-containers.md) (agent base container images), [ADR 005](005-github-app-repository-access.md) (installation tokens)

## Context

ADR 006 wired `spec_grill` end to end but explicitly scoped itself to that one
job kind (its Context: *"Scope: `spec_grill` only. `feature_build`/`test_run`
reuse the same machinery in a later pass"*; its Follow-ups: *"Extending this
machinery to `feature_build` and `test_run`"*). This ADR is that later pass,
for `feature_build` only.

Symptom that surfaced the gap: with `FEATURE_BUILD_IMAGE` configured to a real
`agent-images` image, a dispatched `feature_build` job's pod exits cleanly
within about a minute — no error, no GitHub token or repo env vars on the
container. Root-caused (grill-me session, not yet an incident since no
`feature_build` job has ever succeeded) to two independent gaps that compound:

1. `buildAgentEnv` (`orchestrator/internal/worker/worker.go`) only calls
   `specGrillEnv` — the function that fetches `TARGET_REPOS`/`GITHUB_TOKEN` via
   `FetchFeatureSpec` — when `job.Kind == queue.KindSpecGrill`. A `feature_build`
   job never gets repos or a token.
2. `runInCluster`'s routing only sends `spec_grill` (with a real image
   configured) through the attach-driven `runSpecGrillJob` path (ADR 006 item
   11). Every other kind, including `feature_build` with a real image, still
   runs through the placeholder-era blocking `runAgentJob`/`k8s.RunJob`, which
   never attaches to the pod at all. Even with (1) fixed, nothing would ever
   send Pi a prompt — `pi --mode rpc` just sits with no RPC client and the Job
   is left to `waitForCompletion`'s polling, which was never going to see
   anything but a process idling forever or exiting for unrelated reasons.

Unlike ADR 006, the `agent-images` side for `feature_build` is **already
built** and was not part of the gap: `feature_build/skills/implement/SKILL.md`
(`allowed-tools: [submit_build_result]`) and the `submit_build_result` tool in
`extensions/yggdrasil-contract/src/index.ts` both already exist, written ahead
of the Orchestrator wiring. The skill file is explicit about what it assumes
the Orchestrator has already done and hasn't been true yet:

> "The Orchestrator has already cloned all linked repos and checked out the
> feature branch `yggdrasil/<feature-slug>-<id>` on the primary repo. Do not
> create this branch yourself."
> "The approved ADR markdown for this run is available at
> `/workspace/.yggdrasil/adr.md`."
> "If either assumption turns out wrong once the Orchestrator's job-dispatch
> implementation lands, that's a bug in this skill to fix, not something to
> work around silently."

This ADR makes both assumptions true. The skill also already establishes,
independent of this ADR, that `feature_build` runs unattended (*"this image
has no `ask_user` tool, so never stop to ask the user anything"*) — so unlike
`spec_grill`, there is no multi-turn/reply-waiting complexity to port.

Constraints:

- **Scope: `feature_build` only.** `test_run` is a further later pass —
  `report_test_step`/`submit_test_report` already exist in the contract
  extension too, but wiring them (including the non-terminal, per-subtask
  `report_test_step` relay) is not addressed here.
- Reuse ADR 006's machinery (attach-per-turn, curated event vocabulary,
  `apiclient` internal-endpoint pattern, event relay) rather than building a
  parallel mechanism — `feature_build` is a strict subset of what `spec_grill`
  already does (one turn, no reply-wait loop, different terminal tool).
- The installation token minted for `spec_grill` is deliberately
  `contents:read`-only (`api/src/features/internal-routes.ts`, ADR 005 §14/§16)
  because that run only explores and never writes. `feature_build` commits and
  opens a PR, so it needs a different, broader scope — this is a real
  divergence from `spec_grill`, not something the shared endpoint can ignore.

## Decision

### One internal endpoint, kind-aware

1. `GET /internal/projects/:projectId/features/:featureId/spec` (ADR 006 item
   5) grows an optional `kind` query param, which the Orchestrator now passes
   (it already knows `job.Kind` when it calls `FetchFeatureSpec`). This is the
   existing internal, bearer-token-only surface
   (`requireInternalApiToken`) — not user-facing — so a caller-supplied `kind`
   carries no privilege-escalation risk beyond what an internal service is
   already trusted with.
   - `kind=spec_grill` (or omitted, preserving the existing default):
     response and token scope unchanged from ADR 006 —
     `{title, featureType, repos, githubToken}`, token minted
     `contents:read`.
   - `kind=feature_build`: response additionally includes `adrMarkdown`
     (`feature.adr_markdown`, already persisted by ADR 006 item 14's
     `setSpecReady`) and `branch` (`yggdrasil/<feature.slug>-<feature.id>`,
     matching `job-dispatch.md`'s existing naming convention — `feature.slug`
     already exists, per `api/src/features/repository.ts`, so no new slugging
     logic is needed). The token is minted `contents:write` +
     `pull-requests:write` instead of `contents:read`, via the same
     `mintInstallationAccessToken` helper with a different permissions
     argument.
   - `repos` carries no `ref` for either kind, unchanged from ADR 006 §5: the
     branch to work on is a separate `branch` field, not a per-repo ref,
     since only the primary repo gets the feature branch (sub-repos clone
     their default branch, same as `spec_grill`).

### Orchestrator: widen the env-assembly gate, rename it

2. `buildAgentEnv`'s `if job.Kind == queue.KindSpecGrill` gate widens to
   `job.Kind == queue.KindSpecGrill || job.Kind == queue.KindFeatureBuild`.
   `specGrillEnv` is renamed (e.g. `agentRepoEnv`) and generalized:
   - Always passes `job.Kind` through to `FetchFeatureSpec` (item 1).
   - Always sets `TARGET_REPOS`/`GITHUB_TOKEN` as before.
   - When the response includes `adrMarkdown`/`branch` (i.e. `feature_build`
     only), additionally sets `ADR_MARKDOWN` and `FEATURE_BRANCH` job-pod env
     vars — same delivery mechanism as everything else here: plain job-pod
     env vars, not a Kubernetes Secret (ADR 004 §12, ADR 006 §6).

### `entrypoint.sh`: branch checkout and ADR file, gated on `FEATURE_BRANCH`

3. Inside the existing `if [ -n "${TARGET_REPOS:-}" ]` block (`base/
   entrypoint.sh`), after the primary repo clone succeeds and before the
   `git config --global --unset-all` cleanup line: if `FEATURE_BRANCH` is set,
   `git -C /workspace checkout -b "$FEATURE_BRANCH"`; if `ADR_MARKDOWN` is
   set, write it to `/workspace/.yggdrasil/adr.md` (creating the `.yggdrasil/`
   directory). Both are no-ops when absent, exactly like `TARGET_REPOS`
   itself — so `spec_grill` runs are unaffected. This satisfies both
   assumptions the `implement` skill already documented.
   - **Caught during implementation:** the `git config --global --unset-all`
     cleanup line itself had to become conditional, not just get two new
     steps inserted before it. It existed to strip the credential rewrite
     immediately after cloning so nothing that runs afterwards — including
     the agent, once Pi starts — can push with it, which is correct for
     `spec_grill` (never writes) but would have silently broken
     `feature_build`: `implement/SKILL.md` step 6 (`git push` + `gh pr
     create`) runs *after* Pi starts, i.e. after this line, and needs that
     same rewrite still live to authenticate. The unset is now itself gated
     on `FEATURE_BRANCH` being unset — skipped for exactly (and only) a
     `feature_build` run, so the rewrite survives for the whole session.

### Orchestrator: route `feature_build` through the attach-driven path too

4. `runInCluster`'s routing condition (`worker.go`) widens from checking only
   `cfg.Images[queue.KindSpecGrill]` to checking `cfg.Images[job.Kind]` for
   both `queue.KindSpecGrill` and `queue.KindFeatureBuild` — any job kind with
   a real image configured goes through the attach-driven path; without one,
   it still falls back to the placeholder-compatible `runAgentJob` (unchanged
   for `test_run` and any kind with no image configured yet).
5. `runSpecGrillJob`/`driveSpecGrillSession` (`specgrill.go`) are renamed to
   drop the `spec_grill`-specific naming (e.g. `runAgentRPCJob`/
   `driveAgentSession`) and take `job.Kind` to select the initial prompt
   builder. The turn loop itself (`runTurn`, attach-per-turn, `endTurnGrace`)
   is unchanged and untouched by kind — it already terminates on the first
   `Terminal()` curated event, so `feature_build`'s single-turn, no-reply-wait
   shape falls out of the existing loop for free: it never emits a non-
   terminal curated event (no `ask_user` tool is registered for its skill),
   so the loop's `WaitForReply` branch is simply never reached. No special-
   casing needed to skip it.
6. `buildInitialPrompt` grows a `feature_build` branch. Unlike `spec_grill`'s
   (which spells out each repo's local path, since the agent has no other way
   to know the clone layout), `feature_build`'s prompt can be short: point at
   `/root/.pi/agent/skills/implement/SKILL.md` as the governing skill — the
   skill file itself already states its own assumptions (ADR item 3) and
   steps, so the Orchestrator doesn't need to restate them.

### Curated event vocabulary: `submit_build_result`

7. `rpc.Translate`/`CuratedEvent` (`orchestrator/internal/rpc/curated.go`)
   grows a new `EventBuildResult` type, decoded from `tool_execution_end`'s
   `result.details.kind == "submit_build_result"` (mirroring exactly how
   `submit_adr` is decoded today), carrying `Status` (`"success"` |
   `"failure"`), `PRUrl`, and `Summary` from the tool call's own params.
   `Terminal()` returns true for it, like `submit_adr`.
8. In the session loop (item 5), an `EventBuildResult` with `Status ==
   "failure"` is treated exactly like `EventRunFailed` today —
   `driveAgentSession` returns an error carrying `Summary`, so
   `runClaimedJob` calls `q.Fail`, not `q.Complete`. `Status == "success"`
   returns `nil`, same as `submit_adr` does today, and the event (carrying
   `PRUrl`) is relayed via the existing `PostJobEvent` (ADR 006 item 8) —
   no new relay mechanism needed, just a new case in the API's
   `jobEventSchema` enum and `job_events.type` CHECK constraint (ADR 006 item
   13's precedent for adding `run_cancelled` applies identically here).

### API: feature state on a successful build

9. `syncFeatureState` (`api/src/jobs/internal-routes.ts`, ADR 006 item 14)
   grows a case for `submit_build_result` events: on `status: "success"`,
   transition the feature forward per `job-dispatch.md`'s existing state
   list (`running` → `in_review`) and persist the PR URL on the feature
   record (new column or reuse of an existing one — implementation detail,
   not a design fork); on `status: "failure"`, the existing `run_failed`
   handling already covers clearing any in-progress state, so no new branch
   is needed there beyond recognizing the event type.

### Explicitly deferred

10. **`test_run` wiring.** `report_test_step`/`submit_test_report` already
    exist in the contract extension (like `submit_build_result` did before
    this ADR) but are untouched here — `report_test_step` is non-terminal
    and per-subtask, which the current turn loop has no precedent for
    (every existing non-terminal event, `ask_user`, ends the *turn*, not
    just reports progress mid-turn), so it needs its own design pass.
11. **Crash recovery / reattachment**, same gap ADR 006 left open, now shared
    by two job kinds instead of one.
12. **Web app surface for `feature_build`'s live state.** ADR 006 item 15
    built `spec_grill`'s polling view; `feature_build` reusing the same
    `job_events` read side is likely but not designed here.

Implementation reference: `docs/concepts/job-dispatch.md`,
`docs/concepts/pi-agent.md`, `orchestrator/CLAUDE.md`, `agent-images/CLAUDE.md`.

## Consequences

### Positive

- `feature_build` becomes a real, demoable end-to-end flow: approved ADR in,
  implementation + self-verification + draft PR out — the second of the two
  job kinds needed for a usable core loop (`spec_grill` → `feature_build`).
- Confirms the `agent-images` side was built correctly ahead of time — the
  `implement` skill's own documented assumptions map directly onto this
  ADR's decisions with no rework needed on that side.
- Almost all of ADR 006's machinery (attach-per-turn transport, curated event
  relay, `apiclient` pattern, Job-deletion-on-completion) is reused unchanged;
  the actual new code is small: one endpoint branch, two new env vars, one
  `entrypoint.sh` block, one new curated event type, and a routing condition
  widened from one job kind to two.

### Negative / trade-offs

- The internal endpoint now mints two different token scopes depending on a
  caller-supplied `kind` — correct today because only the Orchestrator can
  call it, but it means the endpoint's security property ("never returns a
  write-scoped token") is no longer true unconditionally; anyone who can spoof
  the internal bearer token gets to choose the scope. No change in practical
  risk (that bearer token was already a full-trust boundary), but worth
  flagging for whoever eventually hardens the internal API surface.
- `runAgentRPCJob`/`driveAgentSession` (renamed from the `spec_grill`-specific
  names) now serve two job kinds with meaningfully different shapes (multi-
  turn-with-replies vs. single-turn) behind one function — readable today
  because the second shape is a strict subset, but a third job kind
  (`test_run`, with `report_test_step`'s mid-turn progress reporting) may not
  fit the same generalization cleanly and could force a real split later.
- No design change to ADR 006's known gaps (crash recovery, timeouts) — they
  now apply to twice the surface area without being any closer to solved.

### Follow-ups (out of scope for this ADR)

- `test_run` wiring (item 10).
- Everything ADR 006 already deferred (startup reconciliation, timeout/token-
  budget enforcement, WebSocket relay, registry auth for pulling
  `agent-images` into a real cluster) — unaddressed by either ADR.
- Hardening the internal API's trust model now that it mints scope-
  differentiated tokens (noted above).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Separate `/internal/.../build-spec` endpoint instead of a `kind` param on the existing one | Clearer separation (a caller literally cannot get a write-scoped token from the read-only-shaped route), but duplicates the existing endpoint's lookup/error-handling logic for a security property that doesn't add real protection — the internal bearer token is already a full-trust boundary between the Orchestrator and the API. |
| New `open_pr`-style contract tool instead of reusing `submit_build_result` | Rejected immediately once the codebase search turned up `submit_build_result` already built, already scoped via `allowed-tools`, and already handling the failure case — building a second tool would have duplicated it for no benefit. |
| Let `feature_build` support `ask_user` like `spec_grill` | The ADR the build implements was already through a full grill/interview pass; re-opening mid-build human interaction reintroduces the reply-wait/cancellation complexity ADR 006 built specifically for `spec_grill`'s interview shape, for a job kind whose own skill file already commits to running unattended. An agent that hits real ambiguity should make a documented judgment call in the PR, not stall a job. |
| entrypoint.sh fetches ADR markdown/branch itself via a direct API call, instead of the Orchestrator pre-fetching and injecting as env vars | Keeps job-pod env smaller, but gives the container a new direct dependency on reaching the API at startup — a dependency edge `TARGET_REPOS`/`GITHUB_TOKEN`'s existing env-var delivery (ADR 006 §6) deliberately avoided by having the Orchestrator do all API calls and hand the container plain values. |
| Have the Orchestrator create the feature branch itself (a pre-flight k8s exec/patch) instead of `entrypoint.sh` doing `git checkout -b` | Would keep pod startup free of any Orchestrator-side git operations, but the branch only makes sense once the repo is actually cloned inside the container — doing it from outside would mean either cloning twice (once to branch, once for the pod to use) or coupling the Orchestrator to the container's filesystem layout it doesn't otherwise touch. |

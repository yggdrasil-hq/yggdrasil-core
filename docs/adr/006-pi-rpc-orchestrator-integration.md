# ADR 006: Pi RPC integration in the Orchestrator

**Status:** Accepted
**Date:** 2026-07-09
**Deciders:** Product/design session (grill-me)
**Builds on:** [ADR 003](003-orchestrator-kubernetes.md) (Orchestrator Kubernetes compute), [ADR 004](004-agent-base-containers.md) (agent base container images)

## Context

Phase 1 needs `spec_grill` actually running end to end — today every job kind
still launches the placeholder `busybox:1.36` container
(`orchestrator/internal/worker/worker.go:29`), and even once a real
agent-images image (ADR 004) is wired in via `SPEC_GRILL_IMAGE`, nothing
drives it: `base/entrypoint.sh` execs `pi --mode rpc "$@"` as the container's
PID 1, but `k8s.RunJob` (`orchestrator/internal/k8s/jobrunner.go`) only
creates the Kubernetes Job and polls `Job.Status.Succeeded`/`Failed`
(`waitForCompletion`) — nothing ever writes to that process's stdin or reads
its stdout. A job launched today with a real image would just sit there.

Researching Pi's RPC mode directly (`packages/coding-agent/docs/rpc.md` in
`earendil-works/pi`, linked from pi.dev's docs index):

- **JSONL over stdin/stdout**, strict LF-only framing.
- A single `pi --mode rpc` process **persists across turns** — it does not
  exit after `agent_end`; it waits for the next `prompt`/`steer`/`follow_up`
  command. Session state (including tool-call history) lives in that one
  process for as long as it runs.
- Tool calls/results stream as `tool_execution_start/update/end` events and
  are fed back to the model automatically — no client action needed there.
- The client must **explicitly terminate the subprocess when done**; nothing
  inside RPC mode exits the process on its own.
- A dialog-shaped `extension_ui_request`/`extension_ui_response` sub-protocol
  exists for extension-driven prompts, separate from the
  `yggdrasil-contract` tool calls (ADR 004) this suite actually uses for
  `ask_user`/`submit_adr`.

Existing scaffolding already anticipates this flow but stops short of wiring
it:

- `features` already has `adr_markdown`, `awaiting_user_input`,
  `setSpecReady`/`setAwaitingUserInput`/`updateAdr`
  (`api/src/features/repository.ts`) — the grill-turn state machine was
  designed but never connected to a real event source.
- `projects/routes.ts` already calls `dispatchJob(..., kind: "spec_grill")`
  on feature creation — the *dispatch* side (ADR 003's Postgres-backed queue)
  already works; only "drive Pi once the Orchestrator claims the job" is
  missing.
- The API already has an internal-endpoint convention to extend:
  `projects/internal-routes.ts` (`/internal/projects/:id/slug`,
  `/internal/projects/:id/chart`) and `secrets/internal-routes.ts`, both
  guarded by `requireInternalApiToken` and consumed by
  `orchestrator/internal/apiclient`. No job-event or reply-delivery endpoint
  exists yet.
- `pi-agent.md`'s "exact RPC/SDK event taxonomy" and job-dispatch.md's "exact
  event schema" are both still open TODOs this ADR needs to resolve enough to
  build against.

Constraints:

- **Scope: `spec_grill` only.** `feature_build`/`test_run` reuse the same
  machinery in a later pass — no image or code changes for them here.
- **Backend only.** No Web app changes in this pass; verified via internal
  API calls and DB inspection, not a browser client.
- Small self-hosted team product (ADR 003/004) — prefer reusing existing
  plumbing (the `apiclient` pattern, the Postgres pool already used for the
  job queue, the `project_secrets` env-injection path) over inventing new
  infrastructure.
- `worker.Run`'s poll loop (`worker.go`) currently claims and runs exactly
  one job at a time, synchronously, in `processOne` — adequate for the
  sub-second placeholder container, not for a session that can sit open for
  minutes waiting on a human's grill reply.

## Decision

### The Orchestrator becomes internally concurrent, one goroutine per running job

1. A claimed job is dispatched via `go` instead of running inline in
   `processOne`, bounded by a concurrency cap (a semaphore sized by config,
   e.g. `MAX_CONCURRENT_JOBS`). The poll loop keeps claiming on its ticker
   while up to N jobs run in parallel on one replica. Multiple replicas
   remain safe exactly as before (`SKIP LOCKED`, ADR 003) — this only makes a
   single replica internally concurrent too, which a long-lived RPC session
   now requires.

### The Orchestrator drives Pi's RPC protocol directly, over an attached stdin/stdout stream — one attach call per turn, not one for the whole session

2. The pod is created with `stdin: true` (`k8s.JobSpec` grows this field).
   The job's goroutine opens a Kubernetes **attach** stream to the pod's main
   container — the same API `kubectl attach -i` uses
   (`client-go`'s `remotecommand.NewSPDYExecutor` against the pod's `attach`
   subresource) — and speaks Pi's JSONL RPC protocol over it directly in Go.
3. This is what makes `spec_grill`'s multi-turn `ask_user` loop possible
   without a new container per question: the same `pi --mode rpc` process
   (never restarted) receives many `prompt` round-trips over the run,
   matching the persist-across-turns behavior in Pi's own RPC docs. **But**
   each round-trip is its own **attach call**, not one attach call held open
   for the whole session:
   - `orchestrator/internal/rpc.Client` exposes `BeginTurn()` (opens a fresh
     `os.Pipe` and returns its read end as the next attach call's stdin),
     `Send` (writes one JSONL command to that pipe), and `EndTurn` (closes
     the pipe, letting that attach call return once the response has been
     read) — the `Events`/`Errs` channels persist across calls, since they're
     fed by `Client.Write` (passed as every attach call's stdout arg), so no
     event can be lost at a turn boundary.
   - `orchestrator/internal/worker.runTurn` is one attach call: `BeginTurn`,
     `Send` the prompt, read events until `rpc.Translate` produces a curated
     one, `EndTurn`, wait (bounded by `endTurnGrace`, 10s) for that attach
     call to actually return, then hand the curated event back to
     `driveSpecGrillSession`'s loop, which calls `runTurn` again for the next
     turn (fresh `BeginTurn`) rather than writing a second prompt into the
     same attach call.
   - **Why:** verified directly against a real k3s pod that client-go's
     `remotecommand` (`tools/remotecommand/v2.go`'s `copyStdin`, shared by
     both the SPDY and WebSocket executors) does not reliably deliver a
     *second* stdin write within one continuous attach call — the container
     demonstrably receives and echoes the first prompt but the second is
     never observed arriving, independent of `io.Pipe` vs `os.Pipe` on the Go
     side. One attach call per turn sidesteps this entirely: `Stdin: true`
     without `StdinOnce` (which defaults to `false`) keeps the container's
     own stdin open across separate attach sessions, so re-attaching for the
     next turn resumes the same live `pi --mode rpc` process exactly as the
     first attach's `Command: "prompt"` did.
4. **Rejected:** a pod-side wrapper program bridging Pi's stdio to the API
   over HTTP (see Alternatives) — keeps the RPC protocol logic in exactly one
   place (the Orchestrator, which already owns all pod lifecycle code) and
   avoids new inbound networking to job pods.

### Job payload resolved via a new internal API endpoint, keyed by feature_id

5. New `apiclient.FetchFeatureSpec(ctx, projectID, featureID)` →
   `GET /internal/projects/:projectId/features/:featureId/spec`, mirroring
   the existing `FetchProjectSecrets`/`FetchProjectChart`/
   `FetchProjectMetadata` (`orchestrator/internal/apiclient/client.go`),
   bearer-token authenticated via the existing `requireInternalApiToken`
   middleware. Keyed by both IDs (not `featureId` alone) to match the API's
   own `FeatureRepository.findById(projectId, featureId)`. Returns
   `{title, repos: [{cloneUrl, isPrimary}], githubToken}`. The `jobs` table
   stays bookkeeping-only (id/kind/status/feature_id/test_id) — no JSONB
   payload column, so the feature's actual content stays owned by
   `features` and is resolved server-side at claim time, same as the
   chart/secrets already are.
   - **Refinement over the original plan:** `githubToken` is minted fresh
     by this same endpoint (reusing the `mintInstallationAccessToken` helper
     already used by the chart-fetch/chart-scaffold paths) rather than
     delivered via `project_secrets`/`FetchProjectSecrets` as first
     sketched. Installation tokens are short-lived (~1h, ADR 005 §14) and
     minted per job — they don't fit `project_secrets`' model of a static,
     encrypted-at-rest value. `repos` also carries no `ref`: `spec_grill`
     has no specific branch to check out, so cloning just takes each repo's
     own default branch.

### Repo cloning moves into `base/entrypoint.sh`

6. `entrypoint.sh` gains a second pre-flight step before
   `exec pi --mode rpc`: read `TARGET_REPOS` (a JSON array built by the
   Orchestrator from `FetchFeatureSpec`'s `repos`) and `GITHUB_TOKEN` (that
   same call's freshly minted `githubToken` — injected as a job-pod env var
   the same *mechanical* way as `MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_ID`,
   ADR 004 §12, but sourced from `FetchFeatureSpec` each job rather than a
   static `project_secrets` row) and `git clone` each repo into
   `/workspace`. No pod-spec `initContainers`/volume changes — stays the
   single-container Job `k8s.RunJob` already creates.

### Curated event vocabulary, not raw RPC passthrough

7. The Orchestrator's RPC client watches the full raw event stream but only
   forwards a small, product-meaningful vocabulary to the API: `ask_user`
   (from the `yggdrasil-contract` tool call, ends the *turn*, not the run),
   `submit_adr` (ends the run), `run_failed` (synthesized locally when the
   attach stream itself ends unexpectedly). Internal Pi events
   (`compaction_start`, non-contract `tool_execution_*`, retry events, etc.)
   are not translated at all. Implemented as `rpc.Translate` + `CuratedEvent`
   (`orchestrator/internal/rpc/curated.go`), decoding only
   `tool_execution_end`'s `result.details.kind` — the
   `yggdrasil-contract` extension's own shape, decodable with full
   confidence since it's this suite's own code.
   - **Scope cut from the original plan:** `agent_text` (plain assistant
     message content, for live-typing the grill) is **not implemented**.
     Pi's own message-event shapes (`message_update`/`message_end`) aren't
     confirmed against a real integration, and guessing at them risked a
     curated event with the wrong fields. Deferred until agent-images
     produces real events to build this against.
   - Completion detection deliberately does **not** key off any event's own
     `terminate: true` — both `ask_user` and `submit_adr` set that flag (it
     tells Pi to end the *turn*, not the run); only the tool's identity
     (`details.kind`) distinguishes them. See item 11.
8. New `apiclient.PostJobEvent(ctx, jobID, event)` →
   `POST /internal/jobs/:id/events`, same bearer-token pattern. Implemented
   as a new `job_events` table + `JobEventRepository` +
   `POST /internal/jobs/:jobId/events` (`api/src/jobs/`).
   - **Scope cut from the original plan, partially resolved:** the API
     originally only **persisted** the event. A read side now exists (item
     15) so the Web app can show them; WebSocket relay to the Web app and
     notification creation are still **not implemented** — the Web app
     polls instead (item 15). A failed relay is logged and swallowed by the
     Orchestrator, not treated as a job failure: the job's actual outcome
     doesn't depend on this side channel succeeding.

### Mid-run replies delivered via Postgres LISTEN/NOTIFY

9. New `job_messages` table (`job_id`, `content`, `created_at`,
   `delivered_at`) — the reply direction only; `job_events` (item 8) already
   records the assistant side (the `ask_user` question itself), so no
   `role` column is needed here. When a human replies to an `ask_user`
   question (via a new user-facing, session-authenticated API endpoint —
   not the internal bearer-token surface), the API inserts a row and runs
   `NOTIFY job_replies, '<job_id>'`.
10. After relaying `ask_user` (item 7-8), `driveSpecGrillSession` calls
    `messages.Store.WaitForReply(ctx, jobID)`
    (`orchestrator/internal/messages/store.go`), which holds a dedicated
    `pgx` connection `LISTEN`ing on `job_replies`, filters for its own job
    ID, and claims the pending row (`FOR UPDATE SKIP LOCKED`, mirroring
    `internal/queue`'s own claim pattern) once notified. The returned
    content becomes the *next turn's* prompt — a fresh `runTurn`/attach call
    (item 3), not a second write into the turn that produced `ask_user`.
    - The feature's `awaiting_user_input` flag (`features/repository.ts`'s
      `setAwaitingUserInput`) is kept in sync with this: the internal
      `POST /internal/jobs/:jobId/events` handler
      (`api/src/jobs/internal-routes.ts`) looks up the event's job to find
      its `featureId` and sets the flag true on `ask_user`, false on
      `run_failed` (so a job that dies while still waiting on a reply
      doesn't leave it stuck true); the reply endpoint itself
      (`projects/routes.ts`, item 9) clears it back to false on the normal
      path, once a reply is actually queued. `submit_adr` needs no handling
      here — by the time a run reaches it, any prior `ask_user` has already
      been resolved by a reply. Best-effort: a failure syncing this flag
      doesn't fail the event-ingestion request itself, since the event was
      already durably persisted.

### Kubernetes Job status is no longer the completion signal

11. Per Pi's RPC docs, the process does not exit on its own after a
    terminating tool call — the client must explicitly terminate it.
    `k8s.RunJob`'s `waitForCompletion` (polls `Job.Status.Succeeded`/
    `Failed`) is replaced for RPC-driven jobs: `driveSpecGrillSession`
    (`orchestrator/internal/worker/specgrill.go`) decides completion from
    the RPC event stream (`CuratedEvent.Terminal()` — true for
    `submit_adr` and `run_failed`, false for `ask_user`), and
    `runSpecGrillJob` calls `k8s.DeleteJob` (`Foreground` propagation) once
    it returns, via a `defer` on a background context so cleanup still runs
    if the parent ctx itself is what ended the session. `deploy` jobs are
    unaffected — they still use Helm's own success/failure signal, not this
    path.
    - **Routing:** `runInCluster` only sends a `spec_grill` job through this
      attach-driven path when a real image is configured for it
      (`cfg.Images[queue.KindSpecGrill]`); otherwise it still falls back to
      the placeholder-compatible `runAgentJob`/`k8s.RunJob` path, since the
      placeholder script doesn't speak RPC at all and attaching to it would
      just hang or fail confusingly.
    - Verified against a real attached pod (no real Pi/agent-images image
      needed) using a `busybox sh -c` script that emits the
      `yggdrasil-contract` extension's exact `tool_execution_end` JSON shape
      — proves `submit_adr` ends the session, `ask_user` does not (the
      session sits waiting for a reply, per items 9-10), and an unexpected
      attach-stream end surfaces as `run_failed`.

### Cancellation

12. A human can stop a running `spec_grill` job via a new user-facing,
    session-authenticated endpoint, `POST
    /:projectId/features/:featureId/cancel` (`api/src/projects/routes.ts`) —
    mirroring the reply endpoint (item 9) in shape and auth surface.
    `JobRepository.cancel` (`api/src/jobs/repository.ts`) transitions the
    job `running` → `cancelled` (guarded in SQL, so a job that already
    finished on its own can't be clobbered) and runs
    `NOTIFY job_cancellations, '<job_id>'` — insert-then-notify, same
    ordering reasoning as `JobMessageRepository.create` (item 9).
13. `driveSpecGrillSession` holds a background goroutine for its entire
    session (not just while awaiting a reply, unlike item 10's watcher) on
    `queue.Queue.WatchCancellation(ctx, jobID)`
    (`orchestrator/internal/queue/queue.go`) — a `LISTEN job_cancellations`
    loop mirroring `messages.Store.WaitForReply`'s own pattern. The moment it
    fires, it cancels a session-scoped context, unblocking whichever of
    `runTurn` or `msgs.WaitForReply` is currently in progress:
    - **Mid-turn** (still attached): `runTurn`'s `ctx.Done()` case
      best-effort sends Pi the RPC `abort` command
      (`{"type":"abort"}` — Pi's RPC docs) before returning, giving it a
      chance to stop its current operation cleanly. This is a courtesy, not
      the real termination mechanism — `runSpecGrillJob`'s existing
      `k8s.DeleteJob` (item 11) runs regardless of why the session ended,
      and is what actually guarantees the pod stops.
    - **Between turns** (awaiting a reply): unblocks `msgs.WaitForReply`
      directly; nothing to abort since no attach is open.
    - Either way, the session reports a synthesized `EventRunCancelled`
      curated event (`Terminal() == true`, like `run_failed`) and returns
      `errJobCancelled`, so `runClaimedJob`'s log line says "cancelled," not
      "failed." `queue.Queue.Complete`/`Fail` are both guarded to only
      transition a `running` row — the actual DB outcome doesn't depend on
      this sentinel; it only makes the log accurate.
    - `run_cancelled` is a new entry in the curated event vocabulary (item
      7), so the API's `jobEventSchema` enum and `job_events.type` CHECK
      constraint (`api/src/db/migrations/006_job_events.sql`) both had to
      grow it too, or `PostJobEvent` would 400 every time a job is
      cancelled. `syncFeatureState` (item 10, renamed/extended by item 14)
      treats it exactly like `run_failed` — clearing `awaiting_user_input`,
      so a job cancelled while genuinely waiting on a human's reply doesn't
      leave the flag stuck true forever.

### Web app wiring (spec_grill's core loop)

14. **`submit_adr` now actually moves the feature forward.** Fixed a gap
    left by item 8: the internal events handler persisted every curated
    event but never reacted to `submit_adr` itself, so a feature stayed
    stuck on `draft` forever even after a successful grill.
    `syncAwaitingUserInput` (`api/src/jobs/internal-routes.ts`) is renamed
    `syncFeatureState` and extended: on `submit_adr` it calls
    `FeatureRepository.setSpecReady` (`draft` -> `spec_ready`, storing the
    submitted markdown, clearing `awaiting_user_input`) instead of touching
    the awaiting-input flag; `ask_user`/`run_failed`/`run_cancelled` still
    go through the item 10/13 path unchanged.
15. **Read side for job events, and the Web app's live grill view.** New
    `GET /:projectId/features/:featureId/events`
    (`api/src/projects/routes.ts`, session-authenticated) resolves the
    feature's most recent spec_grill job —
    `JobRepository.findLatestSpecGrillJob`, deliberately not limited to
    `running` like `findActiveSpecGrillJob` (item 9), so the conversation
    and its outcome stay visible after the job finishes, fails, or is
    cancelled — and returns `{ jobStatus, events }`
    (`JobEventRepository.listByJob`). Item 8's WebSocket-relay scope cut
    still stands: the Web app (`SpecGrillPanel`,
    `web/components/features/spec-grill-panel.tsx`) polls this endpoint
    every 2s instead, alongside the feature itself, for as long as
    `FeatureDetailClient` renders it (i.e. while the feature is `draft`).
    The reply (item 9) and cancel (item 12) endpoints already existed as
    API surface; this pass wires them into the same panel — a reply box
    shown while `awaiting_user_input && jobStatus === "running"`, a Cancel
    button while `jobStatus === "running"`, and a terminal banner for
    `run_failed`/`run_cancelled`. Verified manually end-to-end (reply →
    `submit_adr` → `spec_ready`, and cancel → `run_cancelled`) against MSW
    mocks — a real Pi image/model wasn't wired up in this pass (item 18).

### Explicitly deferred

16. **Crash recovery / reattachment.** If the Orchestrator process restarts
    while attached to a live `spec_grill` pod, that job is orphaned (pod
    keeps running, unattended) until someone notices and cancels/retries it.
    No startup reconciliation against already-`running` jobs in this pass.
17. **Timeout / token budget enforcement.** Already an open TODO in
    `pi-agent.md`, unaffected by this ADR. A stuck `ask_user` wait blocks its
    goroutine (bounded by the concurrency semaphore, not fatal to the
    Orchestrator process) but nothing cancels it automatically yet — a human
    can now cancel it manually (item 12), but nothing does so on a timeout.
18. **`feature_build`/`test_run` wiring, WebSocket relay, and a real
    Pi image/model.** Item 15 covers spec_grill's own live view end-to-end,
    but the other two job kinds don't yet reuse this attach/event-relay
    machinery — that's a later pass. The Web app still only polls (no
    WebSocket relay/notifications, item 8). This pass was also only
    verified against MSW mocks and the placeholder job path, not a real
    `SPEC_GRILL_IMAGE`/model — GHCR registry auth for pulling agent-images
    and model credentials are separate, not-yet-done setup steps.

Implementation reference: `docs/concepts/pi-agent.md`,
`docs/concepts/job-dispatch.md`, `orchestrator/CLAUDE.md`,
`agent-images/CLAUDE.md`.

## Consequences

### Positive

- `spec_grill` becomes a real, demoable end-to-end flow: feature title in,
  live grill conversation, ADR out — closing the biggest gap toward a usable
  application.
- Reuses existing plumbing throughout: the `apiclient` internal-endpoint
  pattern, the `project_secrets` env-injection path (ADR 004), the
  Orchestrator's existing Postgres pool (ADR 003), and the `features`
  table's already-scaffolded `awaiting_user_input`/ADR fields — no parallel
  infrastructure invented.
- Curated event vocabulary insulates the API/Web app from Pi's own
  (still-evolving) RPC event shapes.
- One clear owner of the RPC protocol (the Orchestrator) — no second
  implementation of the JSONL wire format inside `agent-images`.

### Negative / trade-offs

- The Orchestrator is no longer purely a "claim → fire-and-forget k8s Job →
  poll status" service for `spec_grill`: it now holds a live, stateful,
  in-memory connection (the attach stream + LISTEN connection) for the
  duration of a run, which can be minutes to hours. This is a real, if
  scoped, dilution of ADR 003's "stateless Orchestrator" framing — durable
  job/feature state still lives in Postgres and the pod, but a running
  conversation's *liveness* now depends on one specific Orchestrator replica
  staying up.
- Crash mid-grill orphans that job with no automatic recovery (deferred,
  item 16) — a real gap for anything beyond local/dev use.
- Kubernetes Job status stops being authoritative for RPC-driven job kinds,
  splitting "how do I know a job finished" into two different mechanisms
  (Helm/Job-status for `deploy`, RPC-event-stream for agent jobs) future
  maintainers need to know about.
- No timeout on a human's `ask_user` reply — a forgotten grill session holds
  a goroutine (and a pod, and a Postgres LISTEN connection) open
  indefinitely, bounded only by the concurrency semaphore.

### Follow-ups (out of scope for this ADR)

- Startup reconciliation / reattachment to already-running jobs after an
  Orchestrator restart.
- Timeout and token-budget enforcement (pre-existing `pi-agent.md` TODO).
- Extending this machinery to `feature_build` and `test_run` (no
  `ask_user`/multi-turn complexity, but the same attach/event-relay/teardown
  mechanics).
- WebSocket relay to the Web app and notification creation on job events
  (the Web app polls in the meantime).
- Registry auth for pulling private `agent-images` packages into a cluster
  (or making them public instead — both undesigned), and documenting how to
  configure a real `SPEC_GRILL_IMAGE` + model credentials for local dev.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Pod-side wrapper bridges Pi's stdio to the API over HTTP (replacing `entrypoint.sh`'s plain `exec`) | Decouples the pod from any one Orchestrator replica, but adds a second implementation of the RPC wire format (new code shipped in `agent-images`), a new auth story for a job pod calling the API directly, and — for replies — either inbound networking to the pod or the same polling problem, just moved. |
| Keep one job per Orchestrator replica, scale via more replicas | No code change, but a replica sits idle-except-for-one-job for the full duration of an attach, wasting most of its capacity; needs as many replicas as concurrent grills, which doesn't scale for a real multi-project team. |
| Widen the `jobs` table with a JSONB payload column instead of fetching feature spec via API | Saves one HTTP round trip at claim time, but duplicates data that already lives on the `features` record and can drift if the feature changes after the job is queued. |
| Raw RPC event passthrough to the API | Nothing lost, but the API/Web app take on an implicit dependency on Pi's exact (evolving) event shapes; every future Pi version bump risks silently changing what gets rendered. |
| Poll `job_messages` on the existing 2s cadence instead of Postgres LISTEN/NOTIFY | Simpler mental model (one polling pattern everywhere), but adds up to a few seconds of latency to what's meant to feel like a live conversation; Postgres is already the shared coordination point, so LISTEN/NOTIFY costs little extra. |
| Have `entrypoint.sh` exit the container itself on seeing the terminating tool call, keeping k8s Job status as the completion signal | Keeps `waitForCompletion`'s current shape, but duplicates event-parsing logic the Orchestrator's RPC client is already doing over the attach connection — two places would need to agree on what "done" means. |
| Build startup reconciliation (re-attach to already-running jobs) in this pass | Closes a real gap, but is meaningfully more code (matching a resumed session's state, deciding what to do if the pod is gone) for a first pass whose goal is proving the RPC path works at all. |
| Include a minimal Web UI for the live grill conversation in this pass | Would make the first demo fully clickable, but risks neither half landing — this is already a large multi-repo backend slice (concurrency model, new transport, new endpoints, new tables). |

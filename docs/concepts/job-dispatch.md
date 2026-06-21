# Concept: job dispatch (API → Orchestrator)

**Read this when:** you touch how the API hands work to the Orchestrator — the job
spec, the event stream back, or scheduled test runs.
**Skip if:** you're inside a single component and not crossing this boundary.

> **Authoritative job model:** ADR 002 (`docs/adr/002-projects-features-tests.md`).

## When a job is dispatched

| Trigger | Job kind |
|---------|----------|
| Feature created (title only) | `spec_grill` |
| User approves ADR and clicks Start build | `feature_build` |
| Test cron schedule fires | `test_run` |

The API builds a **job spec** and dispatches it to the Orchestrator. The Orchestrator
is stateless: everything it needs must be in the spec (or fetchable with the
injected token).

## Job kinds

### `spec_grill`

- Clone **all linked repos** (primary + sub-repos).
- Agent explores codebase, runs grill-me conversation with user.
- Output: ADR markdown → persisted on feature record in API.
- Feature transitions: `draft` → `spec_ready`.
- Container torn down on completion.

### `feature_build`

- Clone all linked repos; create branch `yggdrasil/<feature-slug>-<id>` on primary.
- Input: approved ADR from feature record.
- Agent implements, commits ADR to `docs/adr/NNN-<slug>.md` on feature branch,
  opens draft PR on primary repo.
- Optional preview tunnel during build.
- Feature transitions: `spec_ready` → `queued` → `running` → `in_review` → …

### `test_run`

- Clone all linked repos at ref **`main`**.
- Build app, expose **ephemeral preview tunnel**, tear down after run.
- Input: test markdown spec (`##` sections = subtasks).
- Agent executes steps in order; output **test report** artefact (per-step pass/fail,
  screenshots, optional screen recording).
- Skip dispatch if a previous run for the same test is still active.

## Job spec (common fields)

- Job kind: `spec_grill` | `feature_build` | `test_run`.
- Target repos (all linked) + ref / branch name as applicable.
- Short-lived scoped GitHub token (minted by API).
- Kind-specific payload (ADR, test markdown, build commands from project config).
- Pi config: model, extensions, tool allowlist, timeout, token budget.
- Callback/stream endpoint for events.

## Test scheduling

- Per-test cron: presets (hourly, every 6 hours, daily, weekly) or custom expression.
- Minimum interval: 1 hour.
- Overlapping runs for the same test: skipped.

## Events back to the API

The Orchestrator streams run events (status changes, logs, PR opened, preview URL
ready, grill messages, test step results, completion/failure). The API persists
them, stores artefact refs in object storage, emits **notifications**, and relays
to the Web app over WebSocket.

## TODO

- Transport (queue? HTTP? gRPC?) and delivery guarantees. See
  `roadmap/open-questions.md`.
- Exact event schema (align with Pi's event taxonomy — `concepts/pi-agent.md`).
- Idempotency / retry / dedupe for dispatch and events.

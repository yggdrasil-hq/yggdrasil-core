# Concept: job dispatch (API → Orchestrator)

**Read this when:** you touch how the API hands work to the Orchestrator — the job
spec, the event stream back, or scheduled test runs.
**Skip if:** you're inside a single component and not crossing this boundary.

> **Authoritative job model:** ADR 002 (`docs/adr/002-projects-features-tests.md`).
> **Compute substrate, queue transport, and per-project deployment model:**
> ADR 003 (`docs/adr/003-orchestrator-kubernetes.md`).

## When a job is dispatched

| Trigger | Job kind |
|---------|----------|
| Feature created (title only) | `spec_grill` |
| User approves ADR and clicks Start build | `feature_build` |
| Test cron schedule fires | `test_run` |
| PR merged to primary repo's `main` | `deploy` |
| Design session started (name + description) | `design_grill` |

The API builds a **job spec** and dispatches it to the Orchestrator via a
Postgres-backed durable queue (ADR 003). The Orchestrator's own process is
stateless: everything a run needs must be in the spec (or fetchable with the
injected token) — but `deploy` jobs update durable, per-project state that
lives in the target Kubernetes cluster (the project's primary deployment), not
in the Orchestrator itself.

## Job kinds

### `spec_grill`

- Clone the primary repo (`--recurse-submodules`, ADR 008 item 10; any linked
  sub-repo not yet wired as a submodule falls back to a sibling clone).
- Payload includes `featureType` (`"normal" | "project_init"`, ADR 008 item
  1) alongside the title — the Orchestrator's initial prompt names exactly
  one of the two `spec_grill` skills (`project-init` vs. `feature-grill`)
  per run, never left to model inference.
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
- Runs as a **temporary deployment** in the project's namespace (ADR 003) —
  separate from the project's always-on primary deployment, so tests never
  interfere with live project data.

### `design_grill`

- Same attach/RPC machinery as `spec_grill` (ADR 006), reused wholesale — see
  [ADR 014](../adr/014-design-grill-live-mockups.md).
- Clone all linked repos (uniform with other job kinds); only the primary
  repo is ever written to.
- Input: a name/slug + initial description, seeding the first turn.
- Agent iterates live, emitting a full file-snapshot event
  (`update_design_preview`, non-terminal) on every turn that changes files —
  no ephemeral deployment/preview tunnel; the Web app renders the latest
  snapshot client-side in a sandboxed iframe.
- On `submit_design` (terminal): commits `designs/<slug>/` to a branch and
  opens a PR on the primary repo — single-phase, no separate build job.
- **Write-scoped** installation token (`contents: write` +
  `pull-requests: write`), like `feature_build` — a new precedent for a
  second job kind (see `docs/CONTEXT.md`'s Container access tier entry).
- Only offered when the project is `ready` and has a design surface
  (`designs/` scaffolded by `project_init`, ADR 014 items 10-11).

### `deploy`

- Triggered when a PR merges to the primary repo's `main` branch (`push` webhook,
  `handlePushEvent`), **and** once, guaranteed, the moment a project first goes
  `ready` — from either the `pull_request` webhook or `POST
  /:projectId/complete-init` (ADR 013 addendum) — since that transition and the
  project's very first `main` push are usually the same merge, and `push`-driven
  dispatch alone can't be relied on to catch it (delivery order between the two
  webhooks for one merge isn't guaranteed).
- Applies the project's Helm chart (maintained in the primary repo) to the
  project's namespace — `helm upgrade --install`, imperative, no GitOps.
- Updates the project's **always-on primary deployment** (stateful — real
  database/volumes). No migration/rollback safety net yet (see ADR 003 open
  question #9).
- Also dispatchable manually via `POST /:projectId/deploy` ("Deploy now"),
  and its status (idle/in-progress/failed/completed) is shown on project
  home via `GET /:projectId/deploy` (ADR 013 addendum) — previously there
  was no frontend feedback for deploy at all.

## Job spec (common fields)

- Job kind: `spec_grill` | `feature_build` | `test_run`.
- Container image: resolved by the Orchestrator from one env var per job kind
  (`SPEC_GRILL_IMAGE` / `FEATURE_BUILD_IMAGE` / `TEST_RUN_IMAGE`), pointing at
  an image built by `agent-images/` (ADR 004) — replaces the placeholder
  `JOB_PLACEHOLDER_IMAGE` used today.
- Target repos (all linked) + ref / branch name as applicable.
- Short-lived **GitHub App installation token** (minted by API from project's
  installation). See [`github-app.md`](github-app.md).
- Kind-specific payload (ADR, test markdown, build commands from project config).
- Pi config: model (per-project `MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_ID` from
  `project_secrets`, decrypted server-side and injected as pod env vars — same
  path as the GitHub token; see ADR 004), extensions (the shared
  `yggdrasil-contract` extension, baked into the image), tool allowlist,
  timeout, token budget.
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

- ~~Exact event schema (align with Pi's event taxonomy —
  `concepts/pi-agent.md`).~~ **Resolved for `spec_grill` by ADR 006**
  (`docs/adr/006-pi-rpc-orchestrator-integration.md`): a curated vocabulary
  (`agent_text`/`ask_user`/`submit_adr`/`run_failed`), POSTed by the
  Orchestrator to `/internal/jobs/:id/events`. **Extended to `feature_build`
  by ADR 010** (`docs/adr/010-feature-build-rpc-wiring.md`): a single
  terminating `submit_build_result` event (no `ask_user`-equivalent — the
  implement skill runs unattended), plus `TARGET_REPOS`/`GITHUB_TOKEN`
  (write-scoped) and `ADR_MARKDOWN`/`FEATURE_BRANCH` job-pod env vars. Not
  yet extended to `test_run`.
- Idempotency / retry / dedupe for dispatch and events (delivery guarantees for
  the Postgres-backed queue itself are decided in ADR 003). **Partially
  resolved for `spec_grill`/`project_init` by ADR 012**
  (`docs/adr/012-spec-grill-retry-state-reset.md`): retry always dispatches a
  new job row (old one kept as history, never reused/mutated), and the
  feature's status is explicitly reset so the retried run re-enters the same
  driven state machine as a first attempt. Retry for other feature types /
  job kinds remains unspecified.
- Mid-run reply delivery (`ask_user` → human reply → back into a running job)
  is decided for `spec_grill` by ADR 006 (Postgres `LISTEN`/`NOTIFY` on a new
  `job_messages` table) but not yet implemented.

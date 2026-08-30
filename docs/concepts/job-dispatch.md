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
| Feature created (title only), or Implementation kicks back (ADR 015) | `spec_grill` |
| User approves ADR and clicks Start build, or human resumes from `returned` (ADR 015) | `feature_build` |
| Test cron schedule fires, or a feature reaches the Testing stage (ADR 015, Agentic group) | `test_run` |
| A feature reaches the Testing stage (ADR 015, Unit/Integration groups) | `script_test_run` |
| Testing stage passes (ADR 015) | `agentic_review` |
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
- Output: ADR markdown, plus an optional **Action Items** batch on the same
  `submit_adr` call (ADR 015 item 4) → persisted on feature record in API.
- Feature transitions: `draft` → `spec_ready`.
- Container torn down on completion.
- **Not yet implemented (ADR 015):** when dispatched as a kickback from a
  blocked `feature_build` (`request_action_item`, below), the payload also
  carries the previous approved ADR, a grill-transcript summary, and the
  kickback reason, so the run picks up from where it left off instead of
  re-exploring from scratch.

### `feature_build`

- Clone all linked repos; create branch `yggdrasil/<feature-slug>-<id>` on primary.
- Input: approved ADR from feature record.
- Agent implements, commits ADR to `docs/adr/NNN-<slug>.md` on feature branch,
  opens draft PR on primary repo.
- Optional preview tunnel during build.
- Feature transitions: `spec_ready` → `queued` → `running` → `in_review` → …
  (current); `spec_ready` → `queued` → `running` → `testing` → … (ADR 015
  target, not yet implemented).
- **Not yet implemented (ADR 015):** a new terminal tool,
  `request_action_item`, called instead of `submit_build_result` when the
  agent is blocked on something only a human/another job can supply
  (distinct from a generic crash, which is unchanged) — kicks the feature
  back to a fresh `spec_grill` run rather than `failed`.

### `test_run`

- Scheduled runs default to ref **`main`**; a feature-stage run persists the
  feature ref `yggdrasil/<feature-slug>-<id>`.
- Input includes the selected test's markdown, linked repositories, a
  read-scoped GitHub token, and the requested ref.
- The Orchestrator checks out the existing ref without creating a new branch,
  exposes a temporary deployment, and injects its preview URL.
- The agent executes `##` sections in order, emitting non-terminal
  `report_test_step` events and exactly one terminal `submit_test_report`.
- Feature-stage dispatch is one run per enabled test and is idempotent while
  active. Reports are persisted structurally; a failing report returns the
  feature with reason `test_failure`.

### `script_test_run`

Implemented by the B5 slice. This is a non-agent job: no Pi, skill,
attach/RPC, or contract tools.

- **Not agent-driven** — no Pi, no skill, no attach/RPC, no contract tools.
  A plain container running one of two optional scripts at a fixed path in
  the primary repo (structure standard, ADR 008 item 6): `test-unit.sh` /
  `test-integration.sh`. A script's mere presence is its enable/disable
    toggle — no separate project setting. The API dispatches one probe for each
    group; an absent script reports an empty successful group.
- The script runs the project's actual test framework and writes its result
  to a canonical path in a fixed minimal JSON schema,
  `.yggdrasil/test-report.json` (`passed`/`failed`/`skipped`/`total`,
  optional `coveragePercent`, `failingTests`). Yggdrasil only ever reads that
  file — it never parses jest/JUnit/lcov/or any framework-specific format.
- Dispatched automatically when a feature reaches the Testing stage, once for
  each group. The runner checks script presence after cloning the feature ref
  and posts the canonical report through the existing internal event endpoint.

### `agentic_review`

> **Not yet implemented.** Decided by [ADR 015](../adr/015-six-stage-feature-lifecycle.md);
> no job kind, image, skill, or curated-event handling exists yet.

- Same attach/RPC machinery as `spec_grill` (ADR 006), same precedent
  `design_grill` set in ADR 014. **Read-only** installation token
  (`contents: read`) — reviews a diff, doesn't write code.
- Dispatched automatically once all enabled Testing groups pass, if the
  project's `agentic_review_enabled` toggle (default on) is set.
- Input: all linked repos at the feature branch, the approved ADR, and the
  Testing stage's report(s).
- Output: new terminal tool `submit_review({verdict, comment})` — an
  **internal** verdict relayed as a curated event, not a real GitHub PR
  review (deliberately, to avoid colliding with ADR 013's
  `pull_request_review` webhook, which is the human Manual Review signal).
- `approved` → `in_review`. `changes_requested` → `returned`
  (`reason: agentic_review`).

### `design_grill`

Implemented as a project-scoped, job-backed session. The API exposes creation,
chat, cancellation, and event polling under `/projects/:projectId/designs`,
while the session's name, slug, and description remain on the job row until
the Design-persistence question is resolved.

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

- Job kind: `spec_grill` | `feature_build` | `test_run` | `deploy` |
  `design_grill` (ADR 014; implemented); `script_test_run` |
  `agentic_review` (ADR 015) — `agentic_review` remains decided but not yet
  implemented. `script_test_run` is
  the only job kind with no Pi/RPC involvement at all (alongside `deploy`).
- Container image: resolved by the Orchestrator from one env var per job kind
  (`SPEC_GRILL_IMAGE` / `FEATURE_BUILD_IMAGE` / `TEST_RUN_IMAGE` /
  `SCRIPT_TEST_RUN_IMAGE` / `AGENTIC_REVIEW_IMAGE` / `DESIGN_GRILL_IMAGE`),
  pointing at
  an image built by `agent-images/` (ADR 004) — replaces the placeholder
  `JOB_PLACEHOLDER_IMAGE` used today.
- Target repos (all linked) + persisted ref / branch name as applicable.
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
  (write-scoped) and `ADR_MARKDOWN`/`FEATURE_BRANCH` job-pod env vars. B4
  extends it to `test_run` with `report_test_step` and
  `submit_test_report`; the API stores both progress and aggregate results
  without parsing framework-specific output. Script jobs submit the same
  canonical report event after validating `.yggdrasil/test-report.json`.
  **Extended for the six-stage lifecycle by ADR 015 (Slices B1 and B5):** a
  `submit_build_result` success now lands a feature in `testing` (not
  `in_review`), and `submit_adr` carries an optional `actionItems` array
  (the Action Item batch, persisted at the `draft` → `spec_ready`
  transition). B4 now dispatches feature-ref `test_run` rows, and B5 adds
  feature-ref `script_test_run` rows; both participate in the Testing gate.
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

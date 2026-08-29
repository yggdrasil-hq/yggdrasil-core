# ADR 004: Agent base container images (Pi integration)

**Status:** Accepted
**Date:** 2026-07-08
**Deciders:** Product/design session (grill-me)

## Context

Phase 1 requires real Pi integration in the Orchestrator, but today every job
kind launches a literal placeholder image — `busybox:1.36`
(`orchestrator/internal/worker/worker.go:29,73-74`,
`orchestrator/internal/k8s/jobrunner.go:33,90`, env override
`JOB_PLACEHOLDER_IMAGE` in `orchestrator/cmd/server/main.go:61`). No real agent
image, skill-injection mechanism, or MCP/model config exists yet.

Prior state:

- `concepts/pi-agent.md` is DRAFT, seeded from a project brief. Several of its
  configuration knobs (Pi extensions, tool allowlist, model override) were
  marked TODO — extension format/sandboxing explicitly deferred to "Phase 4."
- `concepts/job-dispatch.md`'s job spec already lists "Pi config: model,
  extensions, tool allowlist, timeout, token budget" as a field, but nothing
  resolves *which image* to run per job kind, or how any of those knobs are
  actually populated.
- ADR 002 already established `spec_grill`, `feature_build`, and `test_run` as
  separate job kinds, each getting a **fresh, separate ephemeral container** —
  it explicitly rejected "one container pausing between spec and build."
- Researching Pi (pi.dev) directly: Pi has **no native MCP client** — its own
  docs say to build a Skill with a CLI tool, or write an extension, if MCP-like
  capability is needed. Pi does support **Skills** (a directory with
  `SKILL.md`, discovered from global/project paths or `--skill`) and
  **Extensions** (TypeScript modules with access to tools, commands, and
  events). Models are configured via `~/.pi/agent/models.json`
  (provider/model definitions, `apiKey` supports `$ENV_VAR` interpolation).
  RPC mode (`pi --mode rpc`, JSONL over stdin/stdout) exposes no tool-approval
  gate — tools execute autonomously once prompted, which already matches how
  `pi-agent.md` describes the Orchestrator driving Pi.
- No prior mention anywhere in this repo of MCP, of skills/extensions as a Pi
  concept, or of a reusable "base container" build artifact.

Constraints:

- The Orchestrator is stateless (ADR 003); per-job secrets are decrypted
  server-side and injected as plain env vars into the ephemeral job PodSpec —
  this is already how the short-lived scoped GitHub token is delivered
  (`orchestrator/internal/k8s/jobrunner.go:53-56`, `JobSpec.Env`), not via a
  Kubernetes `Secret` object.
- `project_secrets` (`api/src/db/migrations/005_project_secrets.sql`) plus
  `api/src/secrets/encryption.ts` (AES-256-GCM, envelope-style) already exist
  for arbitrary project-scoped env vars — new secrets should reuse this, not
  invent a second storage/encryption path (unlike `github_tokens.access_token`,
  which is a plaintext-at-rest gap, not a pattern to copy).
- Small self-hosted team product (ADR 003) — prefer not adding a new always-on
  runtime service if a build-time-only approach is sufficient.

## Decision

### New repo: `yggdrasil-agent-images`

1. A new submodule repo, `yggdrasil-hq/yggdrasil-agent-images`, added
   alongside `web/`, `api/`, `orchestrator/`, `landing/`, `docusaurus/`. It is
   **build-time only** — it produces and publishes container images to the
   registry ADR 003 already established. It is **not** a runtime service the
   Orchestrator calls over the network; there is no new API, no new failure
   mode beyond "image pull fails."
2. The repo gets its own `CLAUDE.md`, per this meta repo's convention.

### Image layout

3. A **common base layer** (Pi installed + the shared `yggdrasil-contract`
   extension, below) with **three per-job-kind Dockerfiles** built on top:
   `spec_grill`, `feature_build`, `test_run`. No image for `deploy` — that job
   kind runs `helm upgrade --install` (ADR 003), not Pi.
4. **Skills map one-to-one onto job kinds**, mirroring the container split
   ADR 002 already made:
   - `spec_grill` → a `grill-with-docs`-derived skill (adapted for Yggdrasil's
     flow — see below).
   - `feature_build` → an "implement" skill that takes the approved ADR from
     the job spec and builds it unattended (no user interruption — consistent
     with RPC mode already having no approval gate).
   - `test_run` → a "run-tests" skill that executes a markdown test spec's
     `##` steps in order.
5. **Playwright CLI** is installed in both the `feature_build` and `test_run`
   images (not `spec_grill`): `test_run`'s documented output already requires
   per-step screenshots/recordings (`job-dispatch.md`); `feature_build` gets it
   so the implementation agent can self-verify UI changes before opening its
   draft PR.
6. The Orchestrator resolves job kind → image via **one env var per job
   kind** (`SPEC_GRILL_IMAGE`, `FEATURE_BUILD_IMAGE`, `TEST_RUN_IMAGE`),
   replacing the single `JOB_PLACEHOLDER_IMAGE`. Bumped by hand on release —
   the same ritual already used for the other submodule pointers.

### MCP dropped in favor of Playwright CLI

7. Since Pi has no native MCP client and the only MCP-shaped capability
   currently needed is browser automation, MCP support is **out of scope for
   this pass**. The Playwright CLI is installed directly as a tool the
   relevant skills invoke — no MCP bridge/extension is built.

### Shared `yggdrasil-contract` extension

8. A single Pi **extension** (not just a skill), loaded in the common base
   layer, gives every job kind a structured, tool-call-based way to signal
   turn boundaries and completion instead of relying on prose parsing:
   - `ask_user(question)` / `submit_adr(markdown)` — `spec_grill`: ends a turn
     to await a user reply mid-grill, or submits the final ADR.
   - `submit_build_result(status, ...)` — `feature_build`: an explicit
     success/failure signal (e.g. "PR opened"), rather than inferring outcome
     from RPC's own `agent_end` event.
   - `report_test_step(...)` / `submit_test_report(...)` — `test_run`:
     structured per-step pass/fail plus screenshot/recording artifact
     references, instead of scraped prose.
   Each per-kind image restricts which of these tools are visible via the
   skill's `allowed-tools` frontmatter field, so e.g. `spec_grill` never sees
   `submit_build_result`.
9. **Rejected:** prose-convention sentinels (e.g. a magic string meaning
   "waiting for reply" vs. "fully done"). The ADR / build result / test report
   are the actual deliverables each job kind exists to produce, and a model
   drifting from a text convention would silently corrupt the state machine
   rather than fail loudly.

### Model configuration

10. Model interface is **OpenAI chat-completions-compatible only** for this
    pass (base URL + API key + model id) — matches Pi's `models.json`
    custom-provider shape (`"api": "openai-completions"`).
11. Configuration is **per-project**, not global: `MODEL_BASE_URL` /
    `MODEL_API_KEY` / `MODEL_ID` are stored as rows in the existing
    `project_secrets` table, encrypted at rest via the existing
    `api/src/secrets/encryption.ts` (AES-256-GCM) — no new table, no new
    crypto. This keeps `pi-agent.md`'s existing "default model per project,
    overridable per feature" commitment true.
12. Delivery follows the **same path already used for the GitHub token**: the
    API decrypts server-side when building the job spec, and injects the
    values as plain env vars on the ephemeral job PodSpec (`JobSpec.Env`) — not
    a Kubernetes `Secret` object, consistent with how ephemeral job secrets are
    handled today.
13. **Follow-up (tracked, out of scope here):** a `web/` settings page so a
    project can set its model provider/key/id directly, instead of only being
    reachable by writing `project_secrets` rows directly.

### `project_init` scaffolds a documentation convention

14. The templated `project_init` grill session ("bootstrap/adapt this codebase
    for Yggdrasil") now explicitly **scaffolds `docs/CONTEXT.md` and an empty
    `docs/adr/`** into the target project's repo. This gives every subsequent
    `spec_grill` run on that project a real corpus (terminology, prior
    decisions) to grill against, rather than starting from nothing — filling
    in what ADR 002's "project init ensures … conventions exist before other
    work" already implied without specifying.

## Consequences

### Positive

- Orchestrator gets real Pi images instead of the `busybox:1.36` placeholder;
  its stateless dispatch model is unchanged.
- Reuses existing secret-encryption and env-injection plumbing
  (`project_secrets`, the GitHub-token delivery path) instead of building new
  infrastructure for the model API key.
- The `yggdrasil-contract` extension makes turn/completion detection robust
  for all three job kinds via one shared mechanism, instead of three separate
  ad hoc text conventions.
- Per-job-kind images keep each container's footprint — and attack surface —
  matched to what its job kind actually needs; `spec_grill` stays lightweight
  with no unused browser binaries.
- `project_init` scaffolding a docs convention makes grill quality consistent
  across every managed project, rather than depending on whether a given user
  happened to already keep an ADR log.

### Negative / trade-offs

- Four Dockerfiles (common base + 3 kinds) instead of one placeholder image —
  more build/CI surface to maintain in the new repo.
- The `yggdrasil-contract` extension is new code in a still-experimental area
  — Pi's extension format/sandboxing was an open "Phase 4" TODO in
  `pi-agent.md` — its API surface will likely need to evolve once real runs
  surface gaps.
- `feature_build` now carries Playwright/browser weight for self-verification,
  a capability not in ADR 002's original build-job contract (implement, commit,
  open PR) — a new failure mode (browser launch/flakiness) inside the build
  job itself.
- Imposing `docs/CONTEXT.md` + `docs/adr/` onto every managed project's repo
  via `project_init` is opinionated — a team with its own existing
  documentation convention gets a second one bolted on.
- Per-job-kind image env vars are a manual bump ritual (same as other
  submodule pointers) — no automatic rollout when a new `agent-images` version
  ships.

### Follow-ups (out of scope for this ADR)

- `web/` settings UI for per-project model provider/key/model id.
- Exact `yggdrasil-contract` event schema/wire format back to the Orchestrator
  — should align with the still-open "exact RPC/SDK event taxonomy" TODO in
  `pi-agent.md`.
- Tool allowlist policy beyond scoping the contract extension's own tools —
  the broader "which packages/tools may Pi install" knob from `pi-agent.md`
  is unaffected by this ADR.
- ~~CI/release process for `yggdrasil-agent-images` (build, tag, push to the
  ADR-003 registry) is not designed here.~~ **Resolved:**
  `.github/workflows/build-images.yml` in `agent-images/` builds and pushes
  all four images on every push to `main`. Registry target turned out to need
  its own call, not deferred to ADR 003's per-install registries: those are
  for per-project app images living inside each install's own
  cluster/namespace, which centralized CI can't push into. `agent-images` is
  one shared, suite-maintained artifact instead, so CI publishes to
  `ghcr.io/yggdrasil-hq/yggdrasil-agent-images/*`, and every Orchestrator
  (self-hosted or managed) pulls directly from there. See
  `agent-images/docs/concepts/images.md`. ~~New open follow-up this raised:
  GHCR packages default to private, so self-hosted installs need a
  `read:packages` pull secret provisioned — not yet designed.~~ **Resolved:**
  documented in `docs/conventions/deploy.md`'s GHCR self-hosting section — a
  `read:packages`-scoped PAT, `docker login`, and an `imagePullSecret` for the
  Orchestrator's target cluster.
- Whether `feature_build`'s Playwright self-verification should gate PR
  creation (fail the build) or stay advisory — left to implementation.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| A runtime "config service" the Orchestrator calls at dispatch time to resolve image/skills/model config | Adds a new deployable, a new failure mode, and new auth for what per-project overrides can already do via existing `project_secrets` + env injection |
| One shared image with all skills/tools, dispatch picks the skill at runtime | Ships Playwright/browser weight and unused tools into `spec_grill` unnecessarily; larger attack surface per container than its job kind needs |
| Prose-convention signaling (sentinel strings) instead of a shared extension | Fragile — silently breaks if the model drifts from the convention; the ADR/build-result/test-report are the actual deliverables of each job kind and shouldn't be scraped from free text |
| Build an MCP-bridging extension to keep "MCP configurations" as originally scoped | Pi has no native MCP client; Playwright CLI (the one capability actually needed now) doesn't require it — added complexity with no present use case |
| Global (deployment-wide) model config via env vars only | Contradicts `pi-agent.md`'s existing "default per project, overridable per feature" commitment; per-project storage costs nothing extra since env-var injection is needed regardless |
| Plaintext model API key in `project-settings` | A DB dump or read-replica leak would expose every project's LLM credentials directly |
| Convention-agnostic grill skill (grill against whatever docs happen to exist, or none) | Inconsistent grill quality across projects; `project_init` already exists specifically to establish conventions before other work is allowed |
| Playwright only in `test_run`, not `feature_build` | Lighter `feature_build` image, but rejected in favor of letting the implementation agent self-verify UI changes before opening its PR |

Implementation reference: `docs/concepts/pi-agent.md`, `docs/concepts/job-dispatch.md`,
`agent-images/CLAUDE.md` (new repo, once scaffolded).

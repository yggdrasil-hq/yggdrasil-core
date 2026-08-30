# Concept: the Pi agent

**Read this when:** you need to understand the AI agent that does the actual
coding inside Orchestrator containers — how it's invoked, configured, or extended.
**Skip if:** you're working on UI/API plumbing that only references jobs/runs —
see `concepts/job-dispatch.md` instead.

> **Base container images, skills, and the shared extension:** ADR 004
> (`docs/adr/004-agent-base-containers.md`).

## What Pi is

**Pi** (pi.dev, by **Earendil Inc.**) is a minimal terminal-based coding agent.
It is the agent layer Yggdrasil orchestrates. Yggdrasil does not reimplement an
agent — it provisions an environment and drives Pi. Pi has **no native MCP
client** — per ADR 004, Yggdrasil does not build one; the one MCP-shaped
capability currently needed (browser automation) is installed as a plain
Playwright CLI tool instead.

## How Yggdrasil runs Pi

- The **Orchestrator** launches a per-job-kind container built from
  `agent-images/` (ADR 004) — `spec_grill`, `feature_build`, or `test_run` —
  each already containing Pi, its job-kind skill, and the shared
  `yggdrasil-contract` extension, then clones the target repo(s) with a
  short-lived scoped token.
- Pi runs in **RPC mode** (JSONL over stdin/stdout) so the Orchestrator can
  drive it programmatically and stream every event back to the API (and on to
  the Web app live). RPC mode has no built-in tool-approval gate — tools
  execute autonomously once prompted; container isolation (ADR 003's sandboxed
  RuntimeClass) is the security boundary, not an in-band confirmation flow.
  For `spec_grill`, the Orchestrator drives this by attaching directly to the
  pod's stdin/stdout (`kubectl attach`-style) and holding the connection open
  for the whole multi-turn session — see ADR 006
  (`docs/adr/006-pi-rpc-orchestrator-integration.md`).
- Users can **chat with / steer** the agent mid-run (Phase 2 capability) — for
  `spec_grill` this is required from the start, since grilling is inherently
  multi-turn (see "Skills and the shared extension" below).

## Skills and the shared extension (ADR 004)

- **Skills** are Pi's on-demand capability packages (a directory with
  `SKILL.md` + optional scripts). Skills map onto job kinds, with `spec_grill`
  the one exception carrying two (ADR 008): `project-init` (a project's very
  first `spec_grill` run — interviews purpose/tech-stack/repo-relationships,
  checks the target repo against Yggdrasil's structure standard) and
  `feature-grill` (every other feature, grill-with-docs-derived). The
  Orchestrator's initial prompt names exactly one per run. `feature_build` →
  an "implement" skill (unattended, no user interruption), `test_run` → a
  "run-tests" skill (executes a markdown spec's `##` steps). `design_grill`
  (ADR 014) gets a "design-grill" skill reusing `spec_grill`'s attach/RPC
  machinery with a write-scoped token and design-specific contract tools.
- A single shared Pi **extension**, `yggdrasil-contract`, is loaded in every
  image's common base layer. It exposes structured tool calls in place of
  prose-based turn/completion signaling: `ask_user`/`submit_adr` (`spec_grill`),
  `submit_build_result` (`feature_build`), `report_test_step`/
  `submit_test_report` (`test_run`). `update_design_preview`/`submit_design`
  (`design_grill`, ADR 014) are available in the shared extension. Each image restricts which of these are visible
  to its skill via `allowed-tools`.
- **Tool allowlist** — beyond scoping the contract extension's own tools per
  image, the broader "which packages/tools Pi may install inside the
  container" knob (below) is a separate, still-open question.

## Configuration knobs (see also `concepts/project-settings.md`)

- **Model** — OpenAI-chat-completions-compatible only, for now.
  `MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_ID`, stored encrypted, decrypted
  server-side by the API, and injected as job PodSpec env vars — the same
  delivery path already used for the scoped GitHub token (ADR 004). Currently
  implemented: editable in the Web app as a per-user account default
  (`user_secrets`) and an optional per-project override (`project_secrets`),
  resolved live at dispatch time — project first, then the owning user's
  default. Every dispatch site refuses to dispatch if neither resolves
  (ADR 007, `docs/adr/007-per-user-default-model-configuration.md`).
  **Not yet implemented:** ADR 016 retires the per-user `user_secrets` tier
  entirely in favor of an Organization-level default (`project_secrets` →
  the project's org's config) — see
  `docs/adr/016-organization-rbac-and-cluster-routing.md`.
- **Tool allowlist** — which packages/tools Pi may install inside the
  container. Still TODO beyond the contract extension's own `allowed-tools`
  scoping.
- **Timeout & token budget** — max run duration and optional token cap per job.
  Still TODO.

## Open / TODO

- ~~Exact RPC/SDK event taxonomy Pi emits, and the `yggdrasil-contract`
  extension's own event schema back to the Orchestrator (ADR 004
  follow-up).~~ **Resolved for `spec_grill` by ADR 006**
  (`docs/adr/006-pi-rpc-orchestrator-integration.md`): the Orchestrator
  attaches to the pod's stdin/stdout and drives Pi's RPC protocol directly,
  translating the raw event stream into a small curated vocabulary
  (`agent_text`/`ask_user`/`submit_adr`/`run_failed`) before relaying to the
  API — `agent_text` (live-typing) is implemented, not deferred. **Extended
  to `feature_build` by ADR 010** (`submit_build_result`, `run_started` by
  ADR 011), and to `design_grill` by ADR 014 (`update_design_preview` and
  `submit_design`).
- Tool allowlist and timeout/token-budget enforcement mechanism — still
  open; ADR 006 explicitly defers this (a stuck `ask_user` wait has no
  automatic timeout yet).
- Failure/retry semantics when Pi errors or exceeds budget.
- Crash recovery: if the Orchestrator restarts mid-run, the job's pod is
  orphaned with no reattachment — deferred by ADR 006.
- ~~CI/release process for `agent-images` (build, tag, push) — not yet
  designed.~~ **Resolved:** `agent-images/.github/workflows/build-images.yml`
  builds and pushes the base + 3 per-job-kind images to GHCR on every push to
  `main` (ADR 004).
- Design persistence remains open (ADR 014 item 13); the current design
  session is represented by its job and curated snapshot events.

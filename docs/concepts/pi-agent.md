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
- Users can **chat with / steer** the agent mid-run (Phase 2 capability) — for
  `spec_grill` this is required from the start, since grilling is inherently
  multi-turn (see "Skills and the shared extension" below).

## Skills and the shared extension (ADR 004)

- **Skills** are Pi's on-demand capability packages (a directory with
  `SKILL.md` + optional scripts). Skills map **one-to-one onto job kinds**:
  `spec_grill` → grill-with-docs-derived skill, `feature_build` → an
  "implement" skill (unattended, no user interruption), `test_run` → a
  "run-tests" skill (executes a markdown spec's `##` steps).
- A single shared Pi **extension**, `yggdrasil-contract`, is loaded in every
  image's common base layer. It exposes structured tool calls in place of
  prose-based turn/completion signaling: `ask_user`/`submit_adr` (`spec_grill`),
  `submit_build_result` (`feature_build`), `report_test_step`/
  `submit_test_report` (`test_run`). Each image restricts which of these are
  visible to its skill via `allowed-tools`.
- **Tool allowlist** — beyond scoping the contract extension's own tools per
  image, the broader "which packages/tools Pi may install inside the
  container" knob (below) is a separate, still-open question.

## Configuration knobs (see also `concepts/project-settings.md`)

- **Model** — OpenAI-chat-completions-compatible only, for now. Configured
  **per project**: `MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_ID` stored encrypted
  in `project_secrets`, decrypted server-side by the API, and injected as job
  PodSpec env vars — the same delivery path already used for the scoped GitHub
  token (ADR 004). A `web/` settings page for editing these directly is a
  tracked follow-up; today they're only reachable by writing `project_secrets`
  rows.
- **Tool allowlist** — which packages/tools Pi may install inside the
  container. Still TODO beyond the contract extension's own `allowed-tools`
  scoping.
- **Timeout & token budget** — max run duration and optional token cap per job.
  Still TODO.

## Open / TODO

- Exact RPC/SDK event taxonomy Pi emits, and the `yggdrasil-contract`
  extension's own event schema back to the Orchestrator (ADR 004 follow-up).
- Tool allowlist and timeout/token-budget enforcement mechanism.
- Failure/retry semantics when Pi errors or exceeds budget.
- CI/release process for `agent-images` (build, tag, push) — not yet designed.

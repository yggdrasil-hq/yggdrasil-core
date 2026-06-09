# Concept: the Pi agent

**Read this when:** you need to understand the AI agent that does the actual
coding inside Forge containers — how it's invoked, configured, or extended.
**Skip if:** you're working on UI/API plumbing that only references jobs/runs —
see `concepts/job-dispatch.md` instead.

> Status: DRAFT — seeded from the project brief. Pi-specific internals were in a
> section not fully captured; fill in from pi.dev docs and mark assumptions.

## What Pi is

**Pi** (pi.dev, by **Earendil Inc.**) is a minimal terminal-based coding agent.
It is the agent layer Yggdrasil orchestrates. Yggdrasil does not reimplement an
agent — it provisions an environment and drives Pi.

## How Yggdrasil runs Pi

- The **Forge** injects Pi into an ephemeral container along with configured
  tools, then clones the target repo with a short-lived scoped token.
- Pi runs in **RPC / SDK mode** so the Forge can drive it programmatically and
  stream every event back to the Backend (and on to the Frontend live).
- Users can **chat with / steer** the agent mid-run (Phase 2 capability).

## Configuration knobs (see also `concepts/project-settings.md`)

- **Model** — default per project; overridable per feature/run.
- **Pi extensions** — custom TypeScript extension modules uploaded by users.
- **Tool allowlist** — which packages/tools Pi may install inside the container.
- **Timeout & token budget** — max run duration and optional token cap per job.

## Open / TODO

- Exact RPC/SDK surface and event taxonomy Pi emits. TODO.
- Extension module format, sandboxing, and upload flow. TODO (Phase 4).
- Failure/retry semantics when Pi errors or exceeds budget. TODO.

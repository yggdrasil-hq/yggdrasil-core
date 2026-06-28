# Component: Orchestrator

**Read this when:** you need a high-level orientation on the execution layer
before diving into the `orchestrator/` submodule.
**Authoritative source:** `orchestrator/CLAUDE.md` (the submodule). Bridge page —
keep short, link, don't duplicate.

- **Submodule path:** `orchestrator/`
- **GitHub repo:** `yggdrasil-hq/yggdrasil-orchestrator`
- **Status:** added
- **Key property:** **stateless between runs.** Receives a job spec, executes,
  reports back. Owns no durable state.

## Responsibility (per run)

1. Provision an ephemeral Docker container.
2. Inject the Pi coding agent (see `concepts/pi-agent.md`) and configured tools.
3. Clone the target GitHub repo with a short-lived installation token.
4. Create a feature branch `yggdrasil/<feature-slug>-<id>`.
5. Open a draft PR immediately.
6. Run Pi in RPC/SDK mode, streaming all events back to the API.
7. Optionally tunnel a preview URL for web-app projects.
8. Tear down the container and archive artefacts when done.

## Talks to

- **API** — receives job specs, streams events/results back. See
  `concepts/job-dispatch.md`.
- **GitHub** — clone, branch, PR (using the injected installation token).

## Deep docs (in the submodule, once added)

- `orchestrator/CLAUDE.md` — router for the orchestrator repo
- `orchestrator/docs/` — container lifecycle, Pi RPC integration, tunneling,
  artefact archival, resource limits

> TODO: fill in once the orchestrator repo is scaffolded. Several open questions
> here — see `roadmap/open-questions.md` (self-hosted compute, env injection,
> resource limits).

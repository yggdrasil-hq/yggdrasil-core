# Component: agent base container images

**Read this when:** you need a high-level orientation on Pi's container images
before diving into the `agent-images/` submodule.
**Authoritative source:** `agent-images/CLAUDE.md` (the submodule). Bridge page —
keep short, link, don't duplicate.

- **Submodule path:** `agent-images/`
- **GitHub repo:** `yggdrasil-hq/yggdrasil-agent-images`
- **Status:** Dockerfiles, skills, and the shared extension are scaffolded and
  build cleanly. CI builds and pushes all four images to GitHub Container
  Registry on every push to `main` — registry pull-secret provisioning for
  self-hosted installs is an open follow-up (GHCR packages default to
  private)
- **Design rationale:** ADR 004 (`docs/adr/004-agent-base-containers.md`)

## Responsibility

Build-time only — publishes container images to GitHub Container Registry,
**not** the per-install registry ADR 003 established (that one is for
per-project app images living inside each install's own cluster; this is one
shared, suite-maintained artifact instead). No runtime service; the
Orchestrator resolves an image tag per job kind via env var
(`SPEC_GRILL_IMAGE` / `FEATURE_BUILD_IMAGE` / `TEST_RUN_IMAGE`) and never
calls this repo directly.

1. A common base layer: Pi installed + the shared `yggdrasil-contract`
   extension (structured tool calls for turn/completion signaling, replacing
   prose-convention parsing).
2. Three per-job-kind images on top of that base, each with the one skill that
   maps to its job kind:
   - `spec_grill` → grill-with-docs-derived skill.
   - `feature_build` → unattended "implement" skill + Playwright CLI.
   - `test_run` → "run-tests" skill + Playwright CLI.
3. A `models.json` template reading `MODEL_BASE_URL` / `MODEL_API_KEY` /
   `MODEL_ID` from the environment — populated per-project by the Orchestrator
   at job-pod creation time (see `concepts/pi-agent.md`).

## Talks to

- **GitHub Container Registry** (`ghcr.io/yggdrasil-hq/yggdrasil-agent-images/*`)
  — this repo's CI publishes images here, not to ADR 003's per-install
  registry.
- **Orchestrator** — pulls images by tag directly from GHCR; no other
  coupling.

## Deep docs (in the submodule)

- `agent-images/CLAUDE.md` — router for this repo
- `agent-images/docs/` — image layout, skills, the shared extension, model
  config template

See ADR 004 (`docs/adr/004-agent-base-containers.md`) for the full design and
its trade-offs/follow-ups.

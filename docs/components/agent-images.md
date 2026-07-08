# Component: agent base container images

**Read this when:** you need a high-level orientation on Pi's container images
before diving into the `agent-images/` submodule.
**Authoritative source:** `agent-images/CLAUDE.md` (the submodule). Bridge page —
keep short, link, don't duplicate.

- **Submodule path:** `agent-images/`
- **GitHub repo:** `yggdrasil-hq/yggdrasil-agent-images`
- **Status:** Dockerfiles, skills, and the shared extension are scaffolded
  (untested — no CI build has run against them, and no image has been pushed
  to a registry yet)
- **Design rationale:** ADR 004 (`docs/adr/004-agent-base-containers.md`)

## Responsibility

Build-time only — publishes container images to the registry ADR 003
established. No runtime service; the Orchestrator resolves an image tag per
job kind via env var (`SPEC_GRILL_IMAGE` / `FEATURE_BUILD_IMAGE` /
`TEST_RUN_IMAGE`) and never calls this repo directly.

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

- **Container registry** (ADR 003) — this repo's CI publishes images here.
- **Orchestrator** — pulls images by tag; no other coupling.

## Deep docs (in the submodule)

- `agent-images/CLAUDE.md` — router for this repo
- `agent-images/docs/` — image layout, skills, the shared extension, model
  config template

See ADR 004 (`docs/adr/004-agent-base-containers.md`) for the full design and
its trade-offs/follow-ups.

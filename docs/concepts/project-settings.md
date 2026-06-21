# Concept: project & per-feature settings

**Read this when:** you touch configuration — project-level defaults or
per-feature/run overrides for the agent.
**Skip if:** you're not dealing with config.

> **Project/repo model:** ADR 002 (`docs/adr/002-projects-features-tests.md`).

## Levels

1. **Project level** — defaults applied to every feature and test in the project.
2. **Per-feature / per-run** — individual features can override the model and
   some settings for a single run.

## Repositories

- **Primary repository** — coordination root; branches and PRs open here.
- **Linked sub-repositories** — cloned alongside primary on every job (`spec_grill`,
  `feature_build`, `test_run`). All linked repos require OAuth `repo` scope.
- Every feature and test run uses **all linked repos** — no per-feature repo picker.

## Project status

| Status | Meaning |
|--------|---------|
| `initializing` | `project_init` feature not yet merged; features and tests blocked. |
| `ready` | Init complete; normal features and tests allowed. |

## Known settings (project level)

| Setting | Purpose | Overridable per feature? |
|---------|---------|--------------------------|
| **Model** | Default LLM the Pi agent uses. | Yes |
| **Build / start commands** | How to build and expose preview (discovered during project init). | No |
| **Pi extensions** | Custom TypeScript extension modules uploaded for the project. | TODO |
| **Tool allowlist** | Packages/tools the agent may install in the container. | TODO |
| **Timeout** | Max run duration per job. | TODO |
| **Token budget** | Optional token cap per job. | TODO |

## TODO

- Confirm the full settings list — e.g. environment variables.
- Define precedence rules when project and feature settings conflict.
- Secure injection of project-level env vars into containers — open question.

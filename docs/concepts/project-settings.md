# Concept: project & per-feature settings

**Read this when:** you touch configuration — project-level defaults or
per-feature/run overrides for the agent.
**Skip if:** you're not dealing with config.

> Status: DRAFT — seeded from the brief. Some settings were in a section not
> fully captured; mark `TODO` and confirm before relying on specifics.

## Levels

1. **Project level** — defaults applied to every feature in the project.
2. **Per-feature / per-run** — individual features can override the model and
   some settings for a single run.

## Known settings (project level)

| Setting | Purpose | Overridable per feature? |
|---------|---------|--------------------------|
| **Model** | Default LLM the Pi agent uses. | Yes |
| **Pi extensions** | Custom TypeScript extension modules uploaded for the project. | TODO |
| **Tool allowlist** | Packages/tools the agent may install in the container. | TODO |
| **Timeout** | Max run duration per job. | TODO |
| **Token budget** | Optional token cap per job. | TODO |

## TODO

- Confirm the full settings list (the brief's settings section was partially
  captured) — e.g. environment variables, repo targeting for multi-repo
  projects (see `roadmap/open-questions.md`).
- Define precedence rules when project and feature settings conflict.
- Secure injection of project-level env vars into containers — open question.

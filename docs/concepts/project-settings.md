# Concept: project & per-feature settings

**Read this when:** you touch configuration — project-level defaults or
per-feature/run overrides for the agent.
**Skip if:** you're not dealing with config.

> **Project/repo model:** ADR 002 (`docs/adr/002-projects-features-tests.md`).
> **Hosting, secrets injection mechanism:** ADR 003 (`docs/adr/003-orchestrator-kubernetes.md`).
> **Account default model config, resolution order, dispatch-site gating:** ADR 007
> (`docs/adr/007-per-user-default-model-configuration.md`).

> **Proposed rework, not implemented:** `design/projects/detail/settings/*`
> splits project settings into per-route pages (General / Secrets / Models,
> currently one page in `web/`) and adds an org tier above Account
> (`design/settings/organization/*`) that Providers/Models/Secrets would
> inherit from, superseding ADR 007. See `docs/CONTEXT.md`'s "Proposed"
> section.

## Levels

0. **Account default** — a user's personal fallback **model configuration**
   (`MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_ID`), set once in Account settings.
   Resolved live at job-dispatch time for any of the user's projects that don't
   set their own — not copied in at project creation (ADR 007).
1. **Project level** — defaults applied to every feature and test in the project.
   For model configuration specifically: either none of the three keys are set
   (project fully inherits the account default) or all three are (fully
   custom) — no partial per-key override (ADR 007).
2. **Per-feature / per-run** — individual features can override the model and
   some settings for a single run.

## Repositories

- **Primary repository** — coordination root; branches and PRs open here.
- **Linked sub-repositories** — cloned alongside primary on every job (`spec_grill`,
  `feature_build`, `test_run`). All linked repos must be granted on the project's
  **GitHub App installation** (ADR 005).
- Every feature and test run uses **all linked repos** — no per-feature repo picker.

## Project status

| Status | Meaning |
|--------|---------|
| `initializing` | `project_init` feature not yet merged; features and tests blocked. |
| `ready` | Init complete; normal features and tests allowed. |

`github_access_warning` (set when installation access breaks) blocks new jobs — see
[`github-app.md`](github-app.md). `model_config_warning` (set when a dispatch site can't
resolve a model configuration, e.g. a `test_run` cron fire after the account default was
cleared) works the same way — action queue item "Fix model configuration" (ADR 007).

## Known settings (project level)

| Setting | Purpose | Overridable per feature? |
|---------|---------|--------------------------|
| **Model** | Default LLM the Pi agent uses. | Yes |
| **Build / start commands** | How to build and expose preview (discovered during project init). | No |
| **Pi extensions** | Custom TypeScript extension modules uploaded for the project. | TODO |
| **Tool allowlist** | Packages/tools the agent may install in the container. | TODO |
| **Timeout** | Max run duration per job. | TODO |
| **Token budget** | Optional token cap per job. | TODO |

`design/allocations/api` mocks this as an org-admin-set monthly token cap
per project (distinct from the consumption *reporting* on `design/usage`) —
proposed, not implemented; see `docs/roadmap/open-questions.md` #15.

## TODO

- Confirm the full settings list — e.g. environment variables.
- Define precedence rules when project and feature settings conflict.

Secure injection of project-level env vars is decided (ADR 003): encrypted at
rest in the API's PostgreSQL, decrypted in-memory by the API, pushed by the
Orchestrator into a per-project Kubernetes `Secret` at deploy time.

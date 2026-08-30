# Concept: project & per-feature settings

**Read this when:** you touch configuration — project-level defaults or
per-feature/run overrides for the agent.
**Skip if:** you're not dealing with config.

> **Project/repo model:** ADR 002 (`docs/adr/002-projects-features-tests.md`).
> **Hosting, secrets injection mechanism:** ADR 003 (`docs/adr/003-orchestrator-kubernetes.md`).
> **Organization-level model config/secrets/cluster, resolution order,
> dispatch-site gating:** ADR 016
> (`docs/adr/016-organization-rbac-and-cluster-routing.md`) — decided,
> **not yet implemented**; retires ADR 007 (per-user default) outright.

> **Proposed rework, not implemented:** `design/projects/detail/settings/*`
> splits project settings into per-route pages (General / Secrets / Models,
> currently one page in `web/`) — layout-only, no ADR needed. The org tier
> above it (`design/settings/organization/*`) that Providers/Models/Secrets
> inherit from is decided by ADR 016, also not yet implemented.

## Levels

0. **Organization level** *(ADR 016, not yet implemented)* — every project's
   Organization holds the fallback **model configuration**
   (`MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_ID`) and org-level secrets.
   Resolved live at job-dispatch time for any project under that org that
   doesn't set its own — not copied in at project creation. Replaces ADR 007's
   per-user account default entirely (no per-user tier exists once this
   ships).
1. **Project level** — defaults applied to every feature and test in the project.
   For model configuration specifically: either none of the three keys are set
   (project fully inherits the org's) or all three are (fully custom) — no
   partial per-key override. For generic secrets, a project-level key shadows
   an org-level key of the same name.
2. **Per-feature / per-run** — individual features can override the model and
   some settings for a single run.

**Currently implemented** (until ADR 016 ships): level 0 is a **per-user**
account default (ADR 007), not an org one — see that ADR for the mechanics
actually live today.

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
cleared) works the same way — action queue item "Fix model configuration" (ADR 007,
retired by ADR 016 once that ships, same warning concept re-homed to org-level config).

*(Not yet implemented, ADR 016):* an **Organization** also has its own status
gate — `pending_cluster` → `ready` — blocking all project creation under it
until a Kubernetes cluster is configured. See
[`016-organization-rbac-and-cluster-routing.md`](../adr/016-organization-rbac-and-cluster-routing.md).

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

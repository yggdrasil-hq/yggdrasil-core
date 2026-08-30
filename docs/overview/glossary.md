# Glossary

**Read this when:** you encounter a Yggdrasil term and want a one-line
definition. This is a lookup table, not a narrative — read only the row you need.

| Term | Meaning |
|------|---------|
| **Yggdrasil** | The whole AI-orchestrated software-development suite. |
| **Web** | The React/Next.js web app users interact with. |
| **API** | REST + WebSocket API; source of truth for all persistent state. |
| **Orchestrator** | Execution layer (stateless process) that runs jobs in Kubernetes and hosts each project's primary deployment. See ADR 003. |
| **Primary deployment** | A project's single always-on, stateful Kubernetes deployment tracking `main`; auto-redeploys on merge. See ADR 003. |
| **Temporary deployment** | An ephemeral, per-run Kubernetes deployment backing a `spec_grill`, `feature_build`, or `test_run` job; torn down after. See ADR 003. |
| **Pi** | The minimal terminal-based coding agent (pi.dev, by Earendil Inc.) that does the actual coding inside a container. See `concepts/pi-agent.md`. |
| **Project** | A managed codebase: one **primary repository** plus optional **linked sub-repositories**, plus agent configuration. See ADR 002. |
| **Primary repository** | The repo where Yggdrasil opens branches/PRs and anchors project identity. |
| **Linked sub-repository** | An additional repo cloned alongside the primary on every job. |
| **Feature** | A unit of work for the agent to build. Two phases: spec grill → ADR → build. See `concepts/feature-lifecycle.md` and ADR 002. |
| **Feature ADR** | The spec artifact generated during `spec_grill`; stored in the API until build commits it to the repo. |
| **Project init** | Auto-created `project_init` feature; hard-gates the project until merged. |
| **Test** | A scheduled verification scenario (markdown spec) run by the agent against an ephemeral `main` preview. Separate from features. |
| **Test subtask** | A `##` section in a test's markdown spec; not a separate DB entity. |
| **Test report** | Output of a test run: per-step pass/fail, screenshots, optional screen recording. |
| **Action queue** | Per-project list of items blocking progress until a human acts. |
| **Notification** | Global, cross-project informational event (in-app only in v1). |
| **Feature slug** | URL/branch-safe identifier derived from a feature; used in branch names `yggdrasil/<feature-slug>-<id>`. |
| **Job / job spec** | The unit of work the API dispatches to the Orchestrator, plus the data describing it. See `concepts/job-dispatch.md`. |
| **Run** | A single execution of a job in the Orchestrator (one container lifecycle). |
| **Draft PR** | The GitHub pull request the Orchestrator opens immediately when a run starts. |
| **Preview tunnel** | An optional public URL exposing a running web-app build from inside the container. |
| **Artefact** | Output saved after a run (logs, reports, recordings) in object storage. |
| **Test suite** | *(Deprecated term — use **Test**.)* See ADR 002. |
| **Pi extension** | A custom TypeScript module uploaded to extend the Pi agent. |
| **Tool allowlist** | Packages/tools the agent is permitted to install inside the container. |
| **Token budget** | Optional cap on tokens (and a timeout) per job. |
| **Meta repo / parent repo** | This repo — docs + submodules, no application code. |
| **Session** | Server-side login state referenced by an HttpOnly cookie set by the API. See `concepts/authentication.md`. |
| **GitHub App installation** | Org/user grant of repo access to the Yggdrasil GitHub App. See `concepts/github-app.md`. |
| **Job-scoped GitHub credential** | Short-lived installation token injected into one Orchestrator run. |
| **GitHub App bot** | GitHub identity (`yggdrasil[bot]`) that authors commits and PRs. |
| **Project installer** | Yggdrasil user who completed the App install for a project (audit). |
| **GitHub access warning** | Project flag when installation access breaks; blocks jobs. |
| **pending_username** | Onboarding state after GitHub signup — user must confirm username before using the app. |
| **Organization** *(decided, ADR 016, not implemented)* | Entity above Project, replacing `owner_user_id` ownership (ADR 002). A user can belong to several; every user gets a personal one auto-created at signup. See `docs/CONTEXT.md`. |
| **Membership / Role** *(decided, ADR 016, not implemented)* | Five org-wide roles (Admin/Developer/Designer/Product Manager/Tester), one per membership, applying across every project in that org. Capability grants are adjustable seed data. |
| **Action item** *(decided, ADR 015; resolution mechanics partial)* | A requirement raised by `spec_grill` alongside the ADR (env var/secret/test request, `design_grill` handoff, new blocking subtask feature) that must resolve before Implementation can start. See `docs/CONTEXT.md`. |
| **Agentic Review** *(decided, ADR 015, not implemented)* | A new job kind, gated between Testing and Manual Review, where an agent reviews another agent's diff against its ADR — read-only access, internal-only verdict. Per-project toggle, default on. See `docs/CONTEXT.md`. |
| **Allocation** *(proposed, not implemented)* | Org-admin-configured cap: infra (per-project Kubernetes ResourceQuota) or API (per-project provider access + monthly token cap). See `roadmap/open-questions.md` #15. |

> Missing a term? Add a row (alphabetical-ish by importance) when you introduce
> new vocabulary, per `conventions/documentation-guide.md`.

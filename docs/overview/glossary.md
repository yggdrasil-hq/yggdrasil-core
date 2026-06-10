# Glossary

**Read this when:** you encounter a Yggdrasil term and want a one-line
definition. This is a lookup table, not a narrative — read only the row you need.

| Term | Meaning |
|------|---------|
| **Yggdrasil** | The whole AI-orchestrated software-development suite. |
| **Web** | The React/Next.js web app users interact with. |
| **API** | REST + WebSocket API; source of truth for all persistent state. |
| **Orchestrator** | Stateless execution layer that runs jobs in containers. |
| **Pi** | The minimal terminal-based coding agent (pi.dev, by Earendil Inc.) that does the actual coding inside a container. See `concepts/pi-agent.md`. |
| **Project** | A managed codebase (one or more GitHub repos) plus its configuration. |
| **Feature** | A unit of work a user describes for the agent to build. Has a lifecycle/state machine. See `concepts/feature-lifecycle.md`. |
| **Feature slug** | URL/branch-safe identifier derived from a feature; used in branch names `yggdrasil/<feature-slug>-<id>`. |
| **Job / job spec** | The unit of work the API dispatches to the Orchestrator, plus the data describing it. See `concepts/job-dispatch.md`. |
| **Run** | A single execution of a job in the Orchestrator (one container lifecycle). |
| **Draft PR** | The GitHub pull request the Orchestrator opens immediately when a run starts. |
| **Preview tunnel** | An optional public URL exposing a running web-app build from inside the container. |
| **Artefact** | Output saved after a run (logs, reports, recordings) in object storage. |
| **Test suite** | A configured set of tests that can be scheduled (cron) and run by the Orchestrator. |
| **Test report** | Generated output of a test run, with optional screen recording. |
| **Pi extension** | A custom TypeScript module uploaded to extend the Pi agent. |
| **Tool allowlist** | Packages/tools the agent is permitted to install inside the container. |
| **Token budget** | Optional cap on tokens (and a timeout) per job. |
| **Meta repo / parent repo** | This repo — docs + submodules, no application code. |

> Missing a term? Add a row (alphabetical-ish by importance) when you introduce
> new vocabulary, per `conventions/documentation-guide.md`.

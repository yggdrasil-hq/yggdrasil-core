# Open questions (not yet decided)

**Read this when:** you hit a design decision that feels undecided, or you're
about to make an assumption in one of these areas. **Do not silently resolve
these — surface them.**

| # | Question | Affects |
|---|----------|---------|
| 1 | **Self-hosted vs. managed Orchestrator compute** — will users bring their own servers? | Orchestrator, job-dispatch transport, billing |
| 2 | **GitHub App** — installation model, org-level repo access, webhooks (Phase 1 auth uses a **GitHub OAuth App** for identity and user tokens; see ADR 001). | API, job-dispatch |
| 3 | **Multi-repo project handling** — which repo does the agent target for a given feature? | API, project-settings, job-dispatch |
| 4 | **Secure injection of project-level env vars** into containers. | Orchestrator, project-settings, security |
| 5 | **Branch conflicts** when two features are developed in parallel. | Orchestrator, feature-lifecycle |
| 6 | **Container resource limits** and cost visibility for users. | Orchestrator, billing/UX |
| 7 | **Agent chat wire path** — Web → API vs orchestrator subdomain vs direct preview WebSocket to Pi in container. | Orchestrator, API, Web, nginx |
| 8 | **Dynamic preview upstream registration** — how orchestrator registers `/preview/<id>` (dev) and `*.preview.*` (prod) with nginx. | Orchestrator, deploy/nginx |

## How to use this list

- If your task touches one of these, treat the area as **unspecified**: propose,
  flag the assumption, and (if resolved) update this list + the relevant doc.
- Add new open questions here as they arise; remove a row when decided and record
  the decision in the appropriate `concepts/` or `conventions/` doc.

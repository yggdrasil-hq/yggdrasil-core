# Open questions (not yet decided)

**Read this when:** you hit a design decision that feels undecided, or you're
about to make an assumption in one of these areas. **Do not silently resolve
these — surface them.**

| # | Question | Affects |
|---|----------|---------|
| 5 | **Branch conflicts** when two features are developed in parallel. | Orchestrator, feature-lifecycle |
| 7 | **Agent chat wire path** — Web → API vs orchestrator subdomain vs direct preview WebSocket to Pi in container. | Orchestrator, API, Web, nginx |
| 9 | **Primary deployment migration/rollback safety net** — ADR 003 shipped auto-deploy-on-merge with no safety net; likely needs a staging branch + staging deployment gate before promoting to primary. | Orchestrator, feature-lifecycle, project-settings |
| 10 | **Multi-cluster credential routing** for an enterprise bringing its own cluster while using hosted managed SaaS (ADR 003 assumes one cluster per Orchestrator instance for MVP). | Orchestrator, billing |
| 11 | **spec_grill polling → WebSocket migration** — replace the Web app's 2s REST polling of `GET /features/:id/events` with a WebSocket-based live relay for real interactivity (agent "thinking" states, streaming tokens, instant delivery); relates to #7's wire-path question but is specifically about leaving polling, not which topology to use. Cross-ref `api/CLAUDE.md`'s "WebSocket (planned)" line. | Web, API |
| 12 | **Design persistence** — whether a `design_grill` design becomes a persisted DB entity (its own table, lifecycle, list/browse view, mirroring Feature/Test) or `designs/` stays a pure repo convention with no row in Yggdrasil's own database. ADR 014 ships the job kind without resolving this. | API, Web, `docs/adr/014-design-grill-live-mockups.md` |

> Questions #1, #4, #6, #8 were resolved by
> [ADR 003](../adr/003-orchestrator-kubernetes.md) and removed from this list.

## How to use this list

- If your task touches one of these, treat the area as **unspecified**: propose,
  flag the assumption, and (if resolved) update this list + the relevant doc.
- Add new open questions here as they arise; remove a row when decided and record
  the decision in the appropriate `concepts/` or `conventions/` doc.

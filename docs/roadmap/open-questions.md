# Open questions (not yet decided)

**Read this when:** you hit a design decision that feels undecided, or you're
about to make an assumption in one of these areas. **Do not silently resolve
these — surface them.**

| # | Question | Affects |
|---|----------|---------|
| 5 | **Branch conflicts** when two features are developed in parallel. | Orchestrator, feature-lifecycle |
| 7 | **Agent chat wire path** — Web → API vs orchestrator subdomain vs direct preview WebSocket to Pi in container. | Orchestrator, API, Web, nginx |
| 9 | **Primary deployment migration/rollback safety net** — ADR 003 shipped auto-deploy-on-merge with no safety net; likely needs a staging branch + staging deployment gate before promoting to primary. `design/deployments` and its project-level equivalent mock a Staging row against this exact question — still unresolved, least-grounded of the three rows shown. | Orchestrator, feature-lifecycle, project-settings |
| 11 | **spec_grill polling → WebSocket migration** — replace the Web app's 2s REST polling of `GET /features/:id/events` with a WebSocket-based live relay for real interactivity (agent "thinking" states, streaming tokens, instant delivery); relates to #7's wire-path question but is specifically about leaving polling, not which topology to use. Cross-ref `api/CLAUDE.md`'s "WebSocket (planned)" line. | Web, API |
| 12 | **Design persistence** — whether a `design_grill` design becomes a persisted DB entity (its own table, lifecycle, list/browse view, mirroring Feature/Test) or `designs/` stays a pure repo convention with no row in Yggdrasil's own database. ADR 014 ships the job kind without resolving this. | API, Web, `docs/adr/014-design-grill-live-mockups.md` |
| 15 | **Token usage tracking + resource allocation caps** — no per-job token count, session-analytics, or per-project spend/resource quota concept exists anywhere today. `design/usage`, `design/analytics`, and `design/allocations/{infra,api}` mock consumption reporting and admin-set caps at org/project/account level. | API, Orchestrator, Web |
| 17 | **Per-message grill resume/restart** — `design/projects/detail/features/detail/spec` adds "Resume/Restart from here" on individual transcript messages, below ADR 006's mid-run-reply and ADR 012's job-level-retry granularity. Would need new API surface and Orchestrator/Pi contract. | Orchestrator, API |

> Questions #1, #4, #6, #8 were resolved by
> [ADR 003](../adr/003-orchestrator-kubernetes.md) and removed from this list.
> Question #14 (six-stage feature lifecycle) was resolved by
> [ADR 015](../adr/015-six-stage-feature-lifecycle.md) and removed from this
> list — decided and implemented. Questions #10 (multi-cluster credential
> routing), #13 (Organization/RBAC entity), and #16 (org-level provider/
> secret config) were all resolved together by
> [ADR 016](../adr/016-organization-rbac-and-cluster-routing.md) and removed
> from this list — decided and implemented.

## How to use this list

- If your task touches one of these, treat the area as **unspecified**: propose,
  flag the assumption, and (if resolved) update this list + the relevant doc.
- Add new open questions here as they arise; remove a row when decided and record
  the decision in the appropriate `concepts/` or `conventions/` doc.

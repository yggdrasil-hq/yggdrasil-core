# Open questions (not yet decided)

**Read this when:** you hit a design decision that feels undecided, or you're
about to make an assumption in one of these areas. **Do not silently resolve
these — surface them.**

| # | Question | Affects |
|---|----------|---------|
| 5 | **Branch conflicts** when two features are developed in parallel. | Orchestrator, feature-lifecycle |
| 7 | **Agent chat wire path** — Web → API vs orchestrator subdomain vs direct preview WebSocket to Pi in container. | Orchestrator, API, Web, nginx |
| 9 | **Primary deployment migration/rollback safety net** — ADR 003 shipped auto-deploy-on-merge with no safety net; likely needs a staging branch + staging deployment gate before promoting to primary. `design/deployments` and its project-level equivalent mock a Staging row against this exact question — still unresolved, least-grounded of the three rows shown. | Orchestrator, feature-lifecycle, project-settings |
| 10 | **Multi-cluster credential routing** for an enterprise bringing its own cluster while using hosted managed SaaS (ADR 003 assumes one cluster per Orchestrator instance for MVP). `design/settings/organization/cluster` proposes answering this at the org level (in-app multi-cluster config replacing the instance-level `KUBECONFIG_HOST_PATH` env var) — needs its own ADR before being built. | Orchestrator, billing |
| 11 | **spec_grill polling → WebSocket migration** — replace the Web app's 2s REST polling of `GET /features/:id/events` with a WebSocket-based live relay for real interactivity (agent "thinking" states, streaming tokens, instant delivery); relates to #7's wire-path question but is specifically about leaving polling, not which topology to use. Cross-ref `api/CLAUDE.md`'s "WebSocket (planned)" line. | Web, API |
| 12 | **Design persistence** — whether a `design_grill` design becomes a persisted DB entity (its own table, lifecycle, list/browse view, mirroring Feature/Test) or `designs/` stays a pure repo convention with no row in Yggdrasil's own database. ADR 014 ships the job kind without resolving this. | API, Web, `docs/adr/014-design-grill-live-mockups.md` |
| 13 | **Organization/RBAC entity** — `design/settings/organization/members` treats projects as belonging to an Organization, not `owner_user_id` (ADR 002), with five proposed roles (Admin/Developer/Designer/Product Manager/Tester) and a best-effort capability matrix. Would require rewriting ADR 007's "no team/org entity yet" premise too. See `docs/CONTEXT.md`'s "Proposed" section. | API, Web, ADR 002, ADR 007 |
| 14 | **Six-stage feature lifecycle** — `design/projects/detail/features/detail/*` proposes Spec → Action Items → Implementation → Testing → Agentic Review → Manual Review, replacing ADR 002 / `feature-lifecycle.md`'s three-phase model, with a new return-to-Implementation loop on failure. Introduces Action Items (env var/secret/test requests, `design_grill` handoff, blocking subtask features) and a wholly new Agentic Review gate/job kind. | API, Web, Orchestrator, ADR 002 |
| 15 | **Token usage tracking + resource allocation caps** — no per-job token count, session-analytics, or per-project spend/resource quota concept exists anywhere today. `design/usage`, `design/analytics`, and `design/allocations/{infra,api}` mock consumption reporting and admin-set caps at org/project/account level. | API, Orchestrator, Web |
| 16 | **Org-level provider/model/secret config** — `design/settings/organization/providers` and `.../secrets` propose superseding ADR 007's per-user-default model wholesale with admin-managed, org-owned config that projects/users inherit from. Depends on #13 (no Organization entity exists). | API, Web, ADR 007 |
| 17 | **Per-message grill resume/restart** — `design/projects/detail/features/detail/spec` adds "Resume/Restart from here" on individual transcript messages, below ADR 006's mid-run-reply and ADR 012's job-level-retry granularity. Would need new API surface and Orchestrator/Pi contract. | Orchestrator, API |

> Questions #1, #4, #6, #8 were resolved by
> [ADR 003](../adr/003-orchestrator-kubernetes.md) and removed from this list.

## How to use this list

- If your task touches one of these, treat the area as **unspecified**: propose,
  flag the assumption, and (if resolved) update this list + the relevant doc.
- Add new open questions here as they arise; remove a row when decided and record
  the decision in the appropriate `concepts/` or `conventions/` doc.

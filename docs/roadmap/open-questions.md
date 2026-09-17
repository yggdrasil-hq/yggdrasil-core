# Open questions (not yet decided)

**Read this when:** you hit a design decision that feels undecided, or you're
about to make an assumption in one of these areas. **Do not silently resolve
these — surface them.**

| # | Question | Affects |
|---|----------|---------|
| 7 | **Agent chat wire path** — Web → API vs orchestrator subdomain vs direct preview WebSocket to Pi in container. | Orchestrator, API, Web, nginx |
| 11 | **spec_grill polling → WebSocket migration** — replace the Web app's 2s REST polling of `GET /features/:id/events` with a WebSocket-based live relay for real interactivity (agent "thinking" states, streaming tokens, instant delivery); relates to #7's wire-path question but is specifically about leaving polling, not which topology to use. Cross-ref `api/CLAUDE.md`'s "WebSocket (planned)" line. | Web, API |

> Questions #1, #4, #6, #8 were resolved by
> [ADR 003](../adr/003-orchestrator-kubernetes.md) and removed from this list.
> Question #14 (six-stage feature lifecycle) was resolved by
> [ADR 015](../adr/015-six-stage-feature-lifecycle.md) and removed from this
> list — decided and implemented. Questions #10 (multi-cluster credential
> routing), #13 (Organization/RBAC entity), and #16 (org-level provider/
> secret config) were all resolved together by
> [ADR 016](../adr/016-organization-rbac-and-cluster-routing.md) and removed
> from this list — decided and implemented. Also since resolved and removed:
> #5 (parallel-feature branch conflicts →
> [ADR 021](../adr/021-parallel-feature-branch-conflicts.md)), #9 (primary
> deployment migration/rollback safety net →
> [ADR 022](../adr/022-deployment-rollback.md)), #12 (design persistence →
> [ADR 020](../adr/020-design-persistence.md)), and #15 (token usage tracking
> + resource allocation caps → [ADR 023](../adr/023-token-usage-tracking.md),
> with the caps half explicitly deferred to issue #18), and #17 (per-message
> grill resume/restart → [ADR 024](../adr/024-per-message-grill-resume.md),
> shipped as an approximate transcript rewind with the true Pi-level fork left
> as a follow-up).

## How to use this list

- If your task touches one of these, treat the area as **unspecified**: propose,
  flag the assumption, and (if resolved) update this list + the relevant doc.
- Add new open questions here as they arise; remove a row when decided and record
  the decision in the appropriate `concepts/` or `conventions/` doc.

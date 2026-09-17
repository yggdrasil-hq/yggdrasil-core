# Open questions (not yet decided)

**Read this when:** you hit a design decision that feels undecided, or you're
about to make an assumption in one of these areas. **Do not silently resolve
these — surface them.**

| # | Question | Affects |
|---|----------|---------|

> **All questions are resolved.** Questions #1, #4, #6, #8 were resolved by
> [ADR 003](../adr/003-orchestrator-kubernetes.md); #14 (six-stage feature
> lifecycle) by [ADR 015](../adr/015-six-stage-feature-lifecycle.md); #10
> (multi-cluster credential routing), #13 (Organization/RBAC entity) and #16
> (org-level provider/secret config) together by
> [ADR 016](../adr/016-organization-rbac-and-cluster-routing.md); #5
> (parallel-feature branch conflicts) by
> [ADR 021](../adr/021-parallel-feature-branch-conflicts.md); #9 (primary
> deployment migration/rollback safety net) by
> [ADR 022](../adr/022-deployment-rollback.md); #12 (design persistence) by
> [ADR 020](../adr/020-design-persistence.md); #15 (token usage tracking +
> resource allocation caps) by [ADR 023](../adr/023-token-usage-tracking.md)
> and [ADR 030](../adr/030-resource-allocation-caps.md); and #17 (per-message
> grill resume/restart) by [ADR 024](../adr/024-per-message-grill-resume.md).
>
> The last two — **#7 (agent chat wire path)** and **#11 (`spec_grill` polling →
> WebSocket)** — were resolved together by
> [ADR 019](../adr/019-live-event-relay.md): the wire path is
> **Web → API WebSocket** on the existing session cookie (not an orchestrator
> subdomain, not a direct socket to Pi in the container), and the 2s poll is
> **replaced, not removed** — it drops to a 30 s safety interval while the relay
> is live and returns to 2 s if the socket never comes up or gives up.
>
> Keep this list as the register it is: add a row when a new question is opened,
> and when a row is resolved record the decision in an ADR and delete the row
> here.

## How to use this list

- If your task touches one of these, treat the area as **unspecified**: propose,
  flag the assumption, and (if resolved) update this list + the relevant doc.
- Add new open questions here as they arise; remove a row when decided and record
  the decision in the appropriate `concepts/` or `conventions/` doc.

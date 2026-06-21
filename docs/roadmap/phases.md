# Roadmap — build order

**Read this when:** you need to know what's being built now, what's deferred, or
which phase a feature belongs to.
**Skip if:** you don't need scheduling/scope context.

> Status: Phase 1 in progress. Auth design accepted (ADR 001); implementation
> starting. Other features remain planned.

## Phase 1 — Foundation

Auth (see `concepts/authentication.md`), GitHub OAuth, project CRUD, feature CRUD, basic Pi integration in the
Orchestrator, basic agent logging.

## Phase 2 — Team & Preview

RBAC, team invitations, live preview tunnel, agent chat/steering, full feature
state machine (`concepts/feature-lifecycle.md`), auto PR creation.

## Phase 3 — Testing

Test suite manager, cron scheduling, Orchestrator test runner, report generation,
screen recording, test history UI.

## Phase 4 — Polish

Pi extension uploads, per-feature model override, token budgets, notification
preferences, audit (logging/trails).

> When working a feature, note its phase so out-of-phase scope is flagged rather
> than silently built.

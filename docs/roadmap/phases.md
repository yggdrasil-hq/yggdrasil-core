# Roadmap — build order

**Read this when:** you need to know what's being built now, what's deferred, or
which phase a feature belongs to.
**Skip if:** you don't need scheduling/scope context.

> Status (2026-08-30): Phase 1 is complete. Phase 2 is partially built (see
> below). Phase 3 (testing) and the rest of Phase 4 haven't started. ADR 014
> (`design_grill`) was decided out of the original phase plan and isn't built
> yet either — see `docs/CONTEXT.md`'s ADR 014 entry.

## Phase 1 — Foundation ✅ done

Auth (see `concepts/authentication.md`), GitHub App repo access
(`concepts/github-app.md`), project CRUD, feature CRUD, Pi RPC integration in
the Orchestrator (`spec_grill` and `feature_build`, ADRs 006/010/011/012),
webhook-driven `deploy`/`merged`/`changes_requested` automation (ADR 013).

## Phase 2 — Team & Preview — partially built

- ✅ Agent chat/steering — implemented for `spec_grill` (live `ask_user`
  turns, `agent_text` streaming) via the attach/RPC machinery (ADR 006).
- ✅ Full feature state machine (`concepts/feature-lifecycle.md`) and auto PR
  creation — both implemented (`feature_build` opens draft PRs; webhooks
  drive `merged`/`changes_requested`).
- ✅ `queued`/`running` build-progress UI (ADR 011).
- ⬜ RBAC, team invitations — not started (no team/org entity exists yet,
  per this doc's glossary). Proposed shape now sketched in
  `design/settings/organization/` — not decided, see `docs/CONTEXT.md`.
- ⬜ Live preview tunnel for ephemeral job runs — designed in ADR 003 but not
  implemented in `orchestrator/` (no preview/temporary-deployment code
  exists).
- ⬜ `design_grill` (ADR 014) — decided but not implemented in any of
  `orchestrator/`, `agent-images/`, or `web/`.

## Phase 3 — Testing — not started

Test suite manager, cron scheduling, Orchestrator test runner, report generation,
screen recording, test history UI. `test_run`'s job kind exists as a stub
routed through the placeholder job path (`worker.go`'s `runAgentJob`), not
the RPC-driven path `spec_grill`/`feature_build` use.

## Phase 4 — Polish — not started

Pi extension uploads, per-feature model override, token budgets, notification
preferences, audit (logging/trails). Per-user default model configuration
(ADR 007) and per-project override already exist, ahead of this phase.
Token budgets' proposed shape is sketched in `design/allocations/api`;
consumption reporting (`design/usage`, `design/analytics`) is a related but
distinct, equally unbuilt feature — not decided, see `docs/CONTEXT.md`.

> When working a feature, note its phase so out-of-phase scope is flagged rather
> than silently built.

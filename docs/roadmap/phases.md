# Roadmap — build order

**Read this when:** you need to know what's being built now, what's deferred, or
which phase a feature belongs to.
**Skip if:** you don't need scheduling/scope context.

> Status (2026-08-31): Phase 1 is complete. Phase 2 is partially built (see
> below). Phase 3 (testing) and the rest of Phase 4 haven't started. ADR 014
> (`design_grill`) and ADR 015 (six-stage feature lifecycle) are implemented;
> ADR 016 (Organization/RBAC/org-level config/cluster routing) was decided out
> of the original phase plan and is implemented as well — see
> `docs/CONTEXT.md`'s ADR 014/015/016 entries. For ADR 015/016 specifically,
> [`adr-015-016-build-plan.md`](adr-015-016-build-plan.md) breaks the actual
> build into ordered, independently-shippable slices.

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
- ✅ **Organization, RBAC, team invitations** (ADR 016) — implemented
  (Track A of `docs/roadmap/adr-015-016-build-plan.md`): Organization entity
  replaces `owner_user_id` on projects (`organization_id`), five org-wide
  roles with an adjustable capability matrix, shareable-link invites (no
  email), org-level provider/secret config (retires ADR 007), and per-org
  Kubernetes cluster routing (supersedes ADR 003 §3-4, removes the
  `KUBECONFIG_HOST_PATH` instance-wide default). See
  `docs/adr/016-organization-rbac-and-cluster-routing.md`.
- ⬜ Live preview tunnel for ephemeral job runs — designed in ADR 003 but not
  implemented in `orchestrator/` (no preview/temporary-deployment code
  exists).
- 🚧 `design_grill` (ADR 014) — the job-backed API, Orchestrator RPC path,
  agent image/skill, and minimal Web live-preview session are implemented.
  Design browse/history and re-open flows remain deferred with the
  Design-persistence question.
- ✅ **Six-stage feature lifecycle** (ADR 015: Spec → Action Items →
  Implementation → Testing → Agentic Review → Manual Review) — Track B of
  `docs/roadmap/adr-015-016-build-plan.md` is implemented. This includes the
  four Action Item resolution mechanics, feature-branch agentic/script
  testing, Agentic Review, unified `returned` transitions, and Manual Review
  UI. See `docs/concepts/feature-lifecycle.md` for the state model.

## Phase 3 — Testing — not started

Future testing-product work remains: test suite manager, cron scheduling,
screen recording, and test history UI. ADR 015's feature-stage
`test_run`/`script_test_run` paths are already implemented, including
feature-branch reports and the Testing tab.

## Phase 4 — Polish — not started

Pi extension uploads, per-feature model override, token budgets, notification
preferences, audit (logging/trails). Per-user default model configuration
(ADR 007) and per-project override already exist, ahead of this phase — ADR
007 is retired by ADR 016 (Phase 2, see above) once that ships, replaced by
an Organization-level default; per-project override is unaffected.
Token budgets' proposed shape is sketched in `design/allocations/api`;
consumption reporting (`design/usage`, `design/analytics`) is a related but
distinct, equally unbuilt feature — not decided, see `docs/CONTEXT.md`.

> When working a feature, note its phase so out-of-phase scope is flagged rather
> than silently built.

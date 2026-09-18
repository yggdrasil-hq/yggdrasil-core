# Roadmap — build order

**Read this when:** you need to know what's being built now, what's deferred, or
which phase a feature belongs to.
**Skip if:** you don't need scheduling/scope context.

> Status (2026-09-18): Phases 1-4 are functionally complete. Phase 3's screen
> recording landed (ADR 029) and Phase 4's last two items — Pi extension uploads
> (ADR 025) and allocation caps (ADR 030) — landed too. ADR 014 (`design_grill`)
> and ADR 015 (six-stage feature lifecycle) are implemented, and Phase 2's two
> former gaps landed as well: design persistence (ADR 020) and the live preview
> tunnel (ADR 003 §10/§15/§17). ADR 016 (Organization/RBAC/org-level config/
> cluster routing) was decided out of the original phase plan and is implemented
> — see `docs/CONTEXT.md`'s ADR entries. For ADR 015/016 specifically,
> [`adr-015-016-build-plan.md`](adr-015-016-build-plan.md) breaks the build into
> ordered, independently-shippable slices.
>
> What remains is the residual scope and the follow-ups surfaced *by* this work,
> tracked as issues #19 (feature-branch image build), #20 (preview access
> control), #21 (schedule-interval validation), #22 (`screenshotPath` dead
> pointer) and the test-suite manager's residual semantics — not unbuilt planned
> phases. Every open question is resolved; ADR 019 closed the last two (#7, #11).

## Phase 1 — Foundation ✅ done

Auth (see `concepts/authentication.md`), GitHub App repo access
(`concepts/github-app.md`), project CRUD, feature CRUD, Pi RPC integration in
the Orchestrator (`spec_grill` and `feature_build`, ADRs 006/010/011/012),
webhook-driven `deploy`/`merged`/`changes_requested` automation (ADR 013).

## Phase 2 — Team & Preview — partially built

- ✅ Agent chat/steering — implemented for `spec_grill` (live `ask_user`
  turns, `agent_text` streaming) via the attach/RPC machinery (ADR 006), now
  **relayed over a WebSocket** with token-level streaming (ADR 019). The REST
  poll remains as the fallback and as the only state path.
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
- ✅ Live preview tunnel for ephemeral job runs — implemented (ADR 003
  §10/§15/§17): per-job temporary deployments + Ingress at
  `<project-slug>-<kind>-<id>.preview.<domain>`, a `job_previews` registry, the
  §17 three-preview-per-project cap enforced at queue claim, and fail-closed
  teardown with a TTL sweep. **Two limits worth knowing:** a preview serves the
  project's app as its chart currently declares it, not the branch under
  construction (no feature-branch image pipeline exists yet — tracked as issue
  #19), and previews are publicly reachable gated only by an unguessable host
  (issue #20).
- ✅ `design_grill` (ADR 014) — the job-backed API, Orchestrator RPC path,
  agent image/skill, minimal Web live-preview session, **and** design
  browse/history + re-open flows (ADR 020, which resolved the design-persistence
  question by indexing designs in a `designs` table while keeping the artifact
  in git).
- ✅ **Six-stage feature lifecycle** (ADR 015: Spec → Action Items →
  Implementation → Testing → Agentic Review → Manual Review) — Track B of
  `docs/roadmap/adr-015-016-build-plan.md` is implemented. This includes the
  four Action Item resolution mechanics, feature-branch agentic/script
  testing, Agentic Review, unified `returned` transitions, and Manual Review
  UI. See `docs/concepts/feature-lifecycle.md` for the state model.

## Phase 3 — Testing — partially built

✅ **Cron scheduling** for `test_run` — implemented (ADR 026): a Test entity's
`scheduleCron` now fires, multi-replica safe via a transactional `SKIP LOCKED`
claim, in UTC, with blocked projects skipped without advancing `last_run_at`.

✅ **Test run history UI** — implemented (ADR 026, issue #16): the Test detail
page lists past runs with status/duration/counts and expands to the report,
failing tests and steps.

✅ **Screen recording** — implemented (ADR 029, issue #17): a `test_run`'s
browser checks are captured with Playwright video and the artifact is read out
of the pod before deletion, with a 25 MB cap and 30-day retention; expired
recordings tombstone to "no longer available" rather than rendering as a broken
player.

⬜ Remaining: the test suite **manager** semantics beyond what exists (issue #3's
residual scope).

ADR 015's feature-stage `test_run`/`script_test_run` paths are separately
implemented, including feature-branch reports and the Testing tab.

## Phase 4 — Polish — in progress

✅ Auditing (logging/trails) — implemented (ADR 028): an org-scoped append-only
`audit_events` table written by explicit `recordAudit()` calls at 41 mutation
sites, with an admin-only read view at `/settings/organization/audit`.

✅ Per-feature model override — implemented as an amendment to ADR 018: a third,
narrowest resolution tier (feature → project → organization) mirroring the
project tier's catalog-selection and custom-triplet paths. Now wired end to end:
the Orchestrator forwards a job's `featureId` to the internal job-spec endpoint,
so a feature's own model actually reaches the job pod.

✅ Notification preferences — implemented (ADR 027): per-user rows keyed by
(organization, notification kind) plus a per-project mute, applied at creation
time with a default of notify. UI in account and project settings.

✅ Token usage tracking + consumption reporting — implemented (ADR 023): the
Orchestrator issues Pi's own `get_session_stats` at session end and reports
tokens/cost/duration per job; `/usage`, `/analytics` and their project-scoped
counterparts render real aggregates instead of ADR 017 mock data. The
**enforcement** half (caps, quotas) is explicitly deferred to issue #18.

✅ Primary deployment rollback — implemented (ADR 022): Helm revisions are
captured per deploy into an append-only ledger, with a non-agent `rollback` job
kind and real deploy history + rollback on the Web deployments page. Resolves
open question #9; a staging gate was considered and deferred.

✅ Pi extension uploads — implemented (ADR 025): org-scoped upload, stored per
file in the API, reviewed from the detail read, mounted read-only into job pods,
opt-in per project with an explicit risk acknowledgement, a kill switch, and an
audit entry per mutation. This is arbitrary code running beside a live GitHub
token and the model key; the ADR says so.

✅ Resource allocation caps — implemented (ADR 030): a monthly token cap per
project (metering against the org's own provider key) and an admin-configurable
per-project Kubernetes quota, enforced in the Orchestrator. `/infrastructure`'s
live cluster telemetry remains a mock — no mechanism for it is decided.

Per-user default model configuration (ADR 007) and per-project override already
exist, ahead of this phase — ADR 007 is retired by ADR 016 (Phase 2, see above),
replaced by an Organization-level default; per-project override is unaffected.
This makes **Phase 4 functionally complete** apart from the follow-ups filed
separately (#19-#34). Those are all *after* the phases, not unbuilt phase work:

- **#19-#22** — found during the burn-down: a feature-branch image pipeline
  (previews currently show the chart, not the branch), preview access control,
  schedule-interval validation, and `screenshotPath`'s dead pointer.
- **#23-#34** — recorded as follow-ups inside ADR 019-#030 while they were being
  implemented. The substantive ones: coalescing the relay's deltas (#23) and its
  verification in a real multi-replica deployment (#32), deploy/rollback
  hardening (#26), and pulling agent images on a fresh install (#29).

Each ADR's own "Follow-ups" section remains the design record for what was
deferred and why; the notes that are *not* filed as issues are the ones that are
undecided rather than pending — an alternative nobody has chosen, or a decision
that needs to be made before work can start. Those stay in the ADRs deliberately,
so the tracker holds committed work rather than a list of possibilities.

> When working a feature, note its phase so out-of-phase scope is flagged rather
> than silently built.

# ADR 028: Audit logging / trails

**Status:** Accepted
**Date:** 2026-09-17
**Deciders:** Product session (Phase 4 polish review)
**Builds on:** [ADR 016](016-organization-rbac-and-cluster-routing.md) (the
Organization entity is the tenancy boundary, and its org-admin routes are the
authorization pattern reused here), [ADR 002](002-projects-features-tests.md)
(project/feature lifecycle being recorded), [ADR 015](015-six-stage-feature-lifecycle.md)
(the feature stages whose transitions are recorded), [ADR 018](018-multi-provider-model-config.md)
(model configuration being recorded; item 7's blunt admin check is reused, not replaced)
**Does not touch:** ADR 006/010/011/012 (job dispatch and Pi RPC — the trail observes
mutations, it does not participate in them), ADR 013 (webhook-driven feature
transitions — recorded here as `feature.*`/`github.*` events, behavior unchanged),
`design/` (no wireframe exists for this surface — see item 11)

## Context

`roadmap/phases.md` Phase 4 lists "audit (logging/trails)" as unbuilt, and
`yggdrasil-hq/yggdrasil-core#8` tracks it. Today the API has **no** record of who
changed what: `notifications` is a per-user inbox (and is only written for a
handful of events, at the acting user's own row), and `job_events` records what an
*agent* did inside one job run. Neither answers an admin's question after the fact
— "who deleted this project's repository link, who rotated the org's provider key,
who changed that member's role" — because neither is org-scoped, append-only, or
complete with respect to human mutations.

Two properties drive the design. First, an audit row is only useful if it is
**domain-meaningful**: `org.role_changed` with a target user id, not
`PATCH /organizations/:id/members/:userId`. A generic express middleware wrapping
every mutating route cannot produce that — it sees a URL and a status code, not
"which member's role changed to what". Second, an audit row is only trustworthy if
it is **immutable and complete**, so the table is append-only with no update or
delete path anywhere in the codebase, and no retention/pruning policy.

## Decision

### Storage

1. **A new `audit_events` table** (migration `029_audit_events.sql`), scoped to an
   Organization (ADR 016 item 4 makes Organization the tenancy boundary, so it is
   the only scope a trail can be read at):

   | Column | Type | Notes |
   |---|---|---|
   | `id` | UUID PK | |
   | `organization_id` | UUID NOT NULL FK → `organizations` | `ON DELETE CASCADE` |
   | `project_id` | UUID NULL FK → `projects` | `ON DELETE SET NULL` |
   | `actor_user_id` | UUID NULL FK → `users` | `ON DELETE SET NULL`; null for non-human actors |
   | `actor_kind` | VARCHAR(16) NOT NULL | `CHECK IN ('user','system','webhook','job')` |
   | `action` | VARCHAR(128) NOT NULL | dotted verb, e.g. `project.created` |
   | `target_type` | VARCHAR(64) NULL | e.g. `feature`, `organization_secret` |
   | `target_id` | UUID NULL | |
   | `metadata` | JSONB NOT NULL DEFAULT `'{}'` | structured, non-sensitive context |
   | `ip` | VARCHAR(64) NULL | client address, captured per request |
   | `created_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | |

2. **`project_id` and `actor_user_id` are `ON DELETE SET NULL`, not `CASCADE`** —
   deleting a project or a user must not erase the record that it existed and was
   acted on, which is the entire point of a trail. The deleted project's name is
   copied into `metadata` by the delete call site so the event stays legible.
   `organization_id` cascades because an org-scoped trail cannot outlive its org
   (and there is no org-deletion endpoint today).

3. **Indexes**: `(organization_id, created_at DESC)` and
   `(project_id, created_at DESC)` — exactly the two read shapes in item 7. No
   index on `action`: the action filter is a prefix (`LIKE`) match, which a btree
   cannot serve anyway, and the org+date index already bounds the scan.

4. **No retention or pruning policy — rows are kept indefinitely.** There is no
   expiry column, no cleanup job, and no delete path. If volume ever becomes a
   problem, partitioning by `created_at` is the escape hatch, not deletion.

### Write path

5. **Explicit `recordAudit()` calls at the mutation sites themselves**, never a
   blanket middleware over all mutating routes (see Context for why). The pieces:

   - `api/src/audit/actions.ts` — the registry of every action string the API can
     record (`AUDIT_ACTIONS`), so there is one spelling per action and call sites
     reference a constant rather than a literal.
   - `api/src/audit/request-context.ts` — `auditContextMiddleware`, mounted once
     app-wide in `app.ts` *before every router* (including the GitHub webhook
     router, which is mounted before `express.json`), captures `ip` + user-agent
     into `res.locals`; `auditContextFrom(res)` reads them back. `req.ip` is the
     real client address because `app.set("trust proxy", 1)` is already set.
   - `api/src/audit/record.ts` — `PostgresAuditRecorder.record(res, input)`, the
     `AuditRecorder` interface route handlers depend on (so tests fake it like any
     other repository).
   - **The user-agent rides in `metadata.actorUserAgent`**, because this ADR's
     decided column set has an `ip` column and no user-agent column. Capturing it
     and dropping it would be dead code; a second column would widen the decided
     schema.
   - **An audit write never fails the originating request.** `record()` catches
     every error and logs it. The mutation has already committed by then, and
     turning a successful mutation into a 500 because the trail failed to write
     would be strictly worse than a gap in the trail. This is a deliberate,
     recorded weakness (see Consequences); the fix, if ever needed, is an
     outbox/transactional write, listed as a follow-up.
   - **`metadata` must never carry sensitive material**: no secret values, no
     provider API keys, no kubeconfig contents, no invite tokens. Call sites record
     the *key name* (`{ key: "DATABASE_URL" }`) or the fact of the change only. The
     trail is readable by every org admin and kept forever, so a leaked credential
     here would be both permanent and broadly visible.

### Coverage

6. **Every meaningful mutation the API already authorizes is instrumented.** One
   row per call site:

   | Route | Action | Actor |
   |---|---|---|
   | `POST /projects` | `project.created` | user |
   | `POST /projects` (scaffold failure) | `project.chart_scaffold_failed` | user |
   | `PATCH /projects/:projectId` | `project.updated` | user |
   | `DELETE /projects/:projectId` | `project.deleted` | user |
   | `POST /projects/:projectId/repositories` | `project.repository_linked` | user |
   | `DELETE /projects/:projectId/repositories/:repositoryId` | `project.repository_unlinked` | user |
   | `POST /projects/:projectId/complete-init` | `project.marked_ready` | user |
   | `POST /projects/:projectId/features` | `feature.created` | user |
   | `PATCH /projects/:projectId/features/:featureId` (`approveAdr`) | `feature.adr_approved` | user |
   | `PATCH /projects/:projectId/features/:featureId` (`startBuild`) | `feature.build_started` | user |
   | `POST /projects/:projectId/features/:featureId/cancel` | `feature.cancelled` | user |
   | `POST /projects/:projectId/features/:featureId/restart` | `feature.restarted` | user |
   | `POST /projects/:projectId/features/:featureId/retry-grill` | `feature.grill_retried` | user |
   | `POST /projects/:projectId/features/:featureId/restart-from-message` | `feature.grill_restarted_from_message` | user (ADR 024) |
   | `POST /projects/:projectId/features/:featureId/retry-build` | `feature.build_retried` | user |
   | `POST /projects/:projectId/features/:featureId/resume` | `feature.resumed` | user |
   | `PUT /projects/:projectId/secrets` | `project_secret.updated` | user |
   | `DELETE /projects/:projectId/secrets/:secretId` | `project_secret.deleted` | user |
   | `PUT /projects/:projectId/job-model-overrides/:jobKind` | `project_model_override.set` | user |
   | `DELETE /projects/:projectId/job-model-overrides/:jobKind` | `project_model_override.cleared` | user |
   | `POST /projects/:projectId/designs` | `design.session_started` | user |
   | `POST /projects/:projectId/designs/:sessionId/cancel` | `design.session_cancelled` | user |
   | `POST /organizations` | `org.created` | user |
   | `PATCH /organizations/:organizationId` | `org.updated` | user |
   | `POST /organizations/:organizationId/invites` | `org.invite_created` | user |
   | `DELETE /organizations/:organizationId/invites/:inviteId` | `org.invite_revoked` | user |
   | `POST /organizations/invites/:token/accept` (new member only) | `org.member_joined` | user |
   | `PATCH /organizations/:organizationId/members/:userId` | `org.role_changed` | user |
   | `DELETE /organizations/:organizationId/members/:userId` | `org.member_removed` | user |
   | `PUT /organizations/:organizationId/cluster` | `org.cluster_set` | user |
   | `DELETE /organizations/:organizationId/cluster` | `org.cluster_removed` | user |
   | `PUT /organizations/:organizationId/secrets` | `org.secret_set` | user |
   | `DELETE /organizations/:organizationId/secrets/:secretId` | `org.secret_deleted` | user |
   | `POST /organizations/:organizationId/providers` | `model_provider.created` | user |
   | `PUT /organizations/:organizationId/providers/:providerId` | `model_provider.updated` | user |
   | `DELETE /organizations/:organizationId/providers/:providerId` | `model_provider.deleted` | user |
   | `POST /organizations/:organizationId/models` | `model.created` | user |
   | `PUT /organizations/:organizationId/models/:modelId` | `model.updated` | user |
   | `DELETE /organizations/:organizationId/models/:modelId` | `model.deleted` | user |
   | `PUT /organizations/:organizationId/job-model-defaults/:jobKind` | `job_model_default.set` | user |
   | `DELETE /organizations/:organizationId/job-model-defaults/:jobKind` | `job_model_default.cleared` | user |
   | `PUT /organizations/:organizationId/allocations/projects/:projectId/token-cap` | `project_token_cap.set` | user (ADR 030) |
   | `PUT /organizations/:organizationId/allocations/projects/:projectId/quota` | `project_resource_quota.set` | user (ADR 030) |
   | `POST /github/installations/:installationId/sync` | `github.repos_synced` | user (one row per affected org) |
   | webhook `installation` (created/unsuspend/deleted/suspend) | `github.installation_updated` | webhook (one row per affected org) |
   | webhook `installation_repositories` | `github.repositories_updated` | webhook (one row per affected org) |
   | `POST /projects/:projectId/rollback` | `deploy.rolled_back` | user |
   | `POST /organizations/:organizationId/extensions` | `extension.uploaded` (`metadata.replaced` distinguishes a new revision of an existing slug) | user (ADR 025) |
   | `PATCH /organizations/:organizationId/extensions/:extensionId` | `extension.activation_changed` | user (ADR 025) |
   | `DELETE /organizations/:organizationId/extensions/:extensionId` | `extension.deleted` | user (ADR 025) |
   | `PATCH /projects/:projectId/uploaded-extensions-enabled` | `project.uploaded_extensions_changed` | user (ADR 025) |

   Only **successful** mutations produce rows: `recordAudit` runs after the
   mutation has committed, on the success path (item 5's ordering is what makes
   "records nothing when the request is rejected" a testable property).

7. **Explicitly out of scope, with reasons** — none of these are silently skipped:

   | Not instrumented | Why |
   |---|---|
   | `POST /projects/:id/features/:id/messages` (mid-run grill reply) | Conversational content, already persisted verbatim as a `user_message` `job_event` — the actual record of the reply. Copying transcripts into a second, broadly-readable store adds no audit value. |
   | Action Item resolution (`/resolve`, `/auto-resolve`, `/:itemId/subtask`) | Meaningful but lower-value than the enumerated categories, and `/auto-resolve` is opportunistic (a read sweeps it) so it would emit noise. Follow-up. |
   | Test entity CRUD (`POST`/`PATCH /projects/:id/tests`) | Belongs with the standalone Testing product (`#3`), which is unbuilt; instrumenting CRUD ahead of it would record a surface that issue is about to change. |
   | Manual `deploy` trigger (`POST /projects/:id/deploy`) | The `deploy` job row plus ADR 013's deploy-status feedback already record this; the trail adds a duplicate with no actor detail the job row lacks. **Note the deliberate asymmetry with `POST /projects/:id/rollback`, which *is* audited** (`deploy.rolled_back`, added by [ADR 022](022-deployment-rollback.md) §8): a rollback is a destructive action whose actor is not recoverable from the job row, whereas the routine trigger is neither. Auditing the trigger too, for symmetry, remains an open follow-up rather than an oversight. |
   | Any read (`GET`) | The trail records mutations, not access. Read-auditing is a different feature with different volume characteristics and was not decided. |
   | `/internal/*` Orchestrator-driven writes | These are the Orchestrator reporting job outcomes, each already recorded in `job_events`. The `job` actor kind exists in the schema for whichever future write has no `job_events` equivalent. |
   | Ephemeral preview lifecycle (ADR 003 §15) | Previews are created and destroyed as a side effect of running a job — there is no user action to attribute and no separate actor: the job row and the `job_previews` registry already say what happened. This is why the preview registry callbacks (`POST /internal/jobs/:id/preview[/teardown]`) carry no `recordAudit` call despite being new mutations, and why the Web app deliberately offers no manual preview teardown control (a user-initiated one *would* need an action here). |
   | Installation-level GitHub events with **no linked project** | There is no org to scope them to: ADR 016 item 3 deliberately decouples installs from Organizations, and `organization_id` is NOT NULL. An installation that gains a project starts being recorded from its next event. |
   | Extension *reads*, including the source-serving detail route (`GET /organizations/:id/extensions/:extensionId`) | Covered by "Any read", and deliberately not carved out: ADR 025's detail read exists so an admin can review code before enabling it, and recording "someone looked at the source" would add volume without answering a question the trail is for. The extension mutations themselves are recorded (see the coverage table above). |
   | A job *loading* an uploaded extension | `/internal/*` Orchestrator-driven and already explained above. The question "which revision ran in this job" is answered instead by ADR 025 item 13's digest, which the job pod logs itself — a place it is actually needed, since the trail does not know what a container did. |
   | Failed or unauthorized attempts | Out of scope by construction (item 6): only committed mutations are recorded. |

### Read path

8. **`GET /organizations/:organizationId/audit`** (`api/src/audit/routes.ts`),
   newest first, with query params: `projectId`, `actorUserId`, `action` (prefix),
   `from`, `to`, `limit` (default 50, max 200), `offset`. Response:
   `{ events, total, limit, offset }` — `total` is the count under the *same*
   filters, so the UI can page without guessing. `from`/`to` accept anything
   `Date.parse` understands (a bare `2026-09-01` from a date input as well as a
   full ISO timestamp). The list and count queries share one WHERE-clause builder
   (`buildAuditWhere`) so they cannot drift, and each event is joined with the
   actor's username/display name and the project's name at read time rather than
   denormalized into the row (names change; history should not).

9. **Admin-only, reusing the existing gate verbatim** — the same
   `roleForUser(orgId, user) !== "admin"` check every other org-admin surface uses
   (`organizations/routes.ts`'s cluster/secrets routes; ADR 018 item 7 documents the
   same choice). Deliberately **not** a new `audit_view` capability in ADR 016's
   `role_capabilities` matrix: adding one would be a new permission concept, and
   the matrix is not wired into enforcement anywhere else yet either.

10. **Visible to admins only.** A member-visible "my own activity" trail is
    deferred — it needs a second, row-filtered read path and a decision about
    whether an actor may see their own entries when they concern other members.
    A non-admin gets the API's 403 today.

### Web

11. **A read-only audit page at `/settings/organization/audit`**
    (`web/app/settings/organization/audit/page.tsx` +
    `web/components/settings/organization/org-audit-settings.tsx`), inside the
    existing sidebar-first organization-settings IA (ADR 016/A5's
    `OrgSettingsLayout` + `HubLayout`, with an "Audit" entry in the org-settings nav
    group). Filters for project/actor/action-family/date range, paging via
    `offset`, and a 403 rendered as its own message rather than an empty table.
    **Known ADR 017 drift:** `design/` has no
    `design/settings/organization/audit/index.html` — this page is built from its
    siblings' shell and primitives, and a wireframe should be added in a future
    `design/` pass so the source-of-truth-for-IA claim stays true.

12. **API-side only.** The Orchestrator records nothing; audit rows are written by
    the API for API-authorized mutations. Agent activity inside a job pod remains
    `job_events`' concern (ADR 006).

## Consequences

### Positive

- After-the-fact accountability for exactly the mutations that matter: roles,
  invites, secrets, provider keys, cluster config, project/feature lifecycle —
  org-scoped, newest-first, filterable, append-only.
- Domain-meaningful rows (`org.role_changed` + target user + new role) rather than
  HTTP-shaped noise, because the call site names the action.
- Append-only with no retention policy, `SET NULL` on project/user deletion, and a
  strict "no sensitive material in `metadata`" rule make the trail a durable
  record rather than a second copy of mutable state.
- Reuses ADR 016's existing authorization and route patterns outright: no new
  permission concept, no new middleware framework, no new UI shell.

### Negative / trade-offs

- **A failed audit write is swallowed** (item 5). A trail that can silently drop
  entries is weaker than one backed by an outbox or a shared transaction with the
  mutation. Accepted deliberately: the alternative turns a successful mutation into
  a failed request. The mitigation is that failures are logged loudly to stderr.
- **41 explicit call sites to maintain.** A new mutating route can be added without
  an audit row and nothing will fail — there is no compile-time or test-time
  enforcement that a mutation is instrumented. Coverage is held by the table in
  item 6 plus review discipline, and items 6/7 (including the "no linked project"
  GitHub gap) are the honest statement of what is and isn't covered.
- **`metadata` is free-form JSONB per action**, so the trail's shape varies by
  action and consumers must know the action to interpret it. A rigid typed payload
  per action would be more rigorous and much more code.
- **Indefinite retention** with no pruning means unbounded growth (bounded in
  practice by the per-org index and the 200-row page cap, not by storage).
- **No user-agent column** — it is folded into `metadata.actorUserAgent`, so
  filtering by user-agent is a JSONB predicate rather than an indexed column.
- **Admin-only** means a non-admin member cannot see who changed their own role or
  removed them from an org; the API returns 403 rather than their slice of history.

### Follow-ups (out of scope here)

- **Transactional/outbox writes** so a mutation and its audit row cannot diverge
  (the item-5 trade-off's actual fix).
- **Member-visible own-trail** read path (item 10).
- **The out-of-scope call sites** in item 7 as their features land — Action Item
  resolution, design sessions once #2/#13 decide persistence, test CRUD with #3.
- **A `design/settings/organization/audit/` wireframe** to close the ADR 017 drift
  recorded in item 11.
- **Retention/export** (CSV download, date-bounded export) if admins ask for it;
  not decided, and no retention limit exists to pair with it.
- **A platform-wide (cross-org) trail** for a future instance-admin role — there is
  no such role today, and this ADR deliberately stops at org scope.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Blanket express middleware over all mutating routes | Cannot produce a domain-meaningful action name or target id (it sees a URL and a status code), and would emit one row per HTTP call rather than per meaningful change |
| Reuse `job_events` (or `notifications`) as the trail | `job_events` is per-job-run and agent-authored; `notifications` is a per-user inbox written for a handful of events — neither is org-scoped, append-only, or complete for human mutations |
| Orchestrator-side audit | The Orchestrator only sees API-authorized jobs; org/role/secret/provider mutations never reach it |
| Fail the request when the audit write fails | Turns a successful mutation into a 500 and can leave the system in a state the user believes failed — strictly worse than a logged gap |
| `ON DELETE CASCADE` on `project_id`/`actor_user_id` | Deleting a project or user would erase the history of it having existed, defeating the trail |
| Prune rows after N days | An audit trail whose entries disappear on a timer answers no question anyone asks it; partitioning is the volume answer |
| A new `audit_view` capability in `role_capabilities` | A new permission concept for one admin-only page; the matrix is not wired into enforcement elsewhere yet (ADR 016/018 both leave that as a follow-up) |
| Read-auditing (record `GET`s too) | A different feature with different volume characteristics; not decided, and would swamp the mutation trail |

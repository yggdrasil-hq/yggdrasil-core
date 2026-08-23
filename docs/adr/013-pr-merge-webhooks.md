# ADR 013: PR-merge and review-status webhook events

**Status:** Accepted
**Date:** 2026-08-23
**Deciders:** User request, implemented directly (no grill session)
**Amends:** [ADR 005](005-github-app-repository-access.md) §19 ("No PR-merge
webhooks in Phase 1 — feature lifecycle advances manually in Yggdrasil"), which
this ADR reverses for the `merged` and `changes_requested` transitions only.

## Context

A user merged a `feature_build` PR on GitHub directly and asked why the
feature's status in Yggdrasil never updated. Investigation confirmed this
wasn't a bug: `docs/concepts/feature-lifecycle.md`'s `in_review → merged` and
`in_review → changes_requested` transitions were both real states with no
code path that ever set them from a real PR event. ADR 005 explicitly scoped
PR-merge webhooks out of Phase 1 as a deliberate cut, not an oversight — but
having merged the underlying PR, the lifecycle now has a state
(`in_review`) with no way out except the unrelated `POST
/:projectId/complete-init` (project_init only) or an unguarded generic
`updateStatus` call nothing was making.

The webhook endpoint itself (`POST /webhooks/github`, ADR 005 §5) was already
signature-verified and routing on `x-github-event`; it just had no
`pull_request` or `pull_request_review` case.

## Decision

1. **`pull_request` webhook, `action: "closed"` with `merged: true`** → look
   up the feature by its stored `pr_url` (new `FeatureRepository.findByPrUrl`,
   global lookup — PR URLs are unique) and set `status = 'merged'`. If the
   feature is `featureType: "project_init"` and its project is still
   `initializing`, also call `projects.markReady` — mirroring what
   `complete-init` already does manually, so a merged project_init PR
   completes project setup automatically instead of leaving that one path
   still manual.
   - A PR **closed without merging** is deliberately left alone — that
     doesn't necessarily mean the feature was abandoned, and there's no
     lifecycle state that means "PR closed, unmerged" today. Left for a
     future ADR if it turns out to matter in practice.
2. **`pull_request_review` webhook, `action: "submitted"` with
   `review.state: "changes_requested"`** → look up the feature by PR URL and,
   **only if it's currently `in_review`**, set `status = 'changes_requested'`.
   The `in_review` guard prevents a stale or duplicate review event from
   clobbering a feature that has already moved on (merged, or re-queued by a
   later build attempt).
3. Both handlers are pure functions (`handlePullRequestEvent`,
   `handlePullRequestReviewEvent` in `api/src/github/webhook-routes.ts`),
   exported and unit-tested the same way `handlePushEvent` already was —
   no new route, no new auth model, same signature verification.
4. **Admin action required, not automatic**: GitHub only delivers events an
   App is subscribed to. The App already has the **Pull requests: Read &
   write** permission (ADR 005 §3), which is a prerequisite, but the
   instance admin must also check **Pull request** and **Pull request
   review** under **Permissions & events → Subscribe to events** in the
   App's GitHub settings. Existing installations do not need to be
   reinstalled — GitHub starts delivering the newly-subscribed events
   immediately once the App registration is updated.

## Addendum: guaranteeing the first `deploy` job (same session)

While implementing the above, a second, related gap surfaced: **no code path
ever guaranteed a project's first `deploy` job actually fired.** ADR 003
already decided every project gets an always-on primary deployment
("preview env" in the user's own words — this repo's `primary` and
`preview` name the same thing, not two environments), redeployed via a
`deploy` job whenever `main` changes (`docs/concepts/job-dispatch.md`). In
practice:

- `handlePushEvent` (the only thing that ever dispatches `deploy`) only
  fires it when `project.status === "ready"` **at the time the `push`
  webhook is processed**.
- A project's very first `main` push *is* its `project_init` PR merging —
  the same merge that flips the project from `initializing` to `ready`.
- That flip happened in two places (the `pull_request` handler added above,
  and the pre-existing manual `POST /:projectId/complete-init`), and
  **neither ever dispatched `deploy`**. Worse, for the webhook path, GitHub
  delivers `pull_request` and `push` as independent, unordered HTTP
  requests for the same merge — if `push` is processed first, it reads
  `status: "initializing"`, no-ops, and GitHub never redelivers it. The
  project could sit "ready" with nothing ever actually running.

Fix: both places that call `projects.markReady` now also dispatch a
`deploy` job immediately afterward, in the same handler — not left to race
against (or depend on) the sibling `push` webhook:

- `handlePullRequestEvent` (`api/src/github/webhook-routes.ts`), project_init branch.
- `POST /:projectId/complete-init` (`api/src/projects/routes.ts`).

Ordinary (non-`project_init`) merges to `main` are unaffected — by the time
those happen the project has been `ready` for a while already, so
`handlePushEvent`'s existing status check isn't racing against anything.

`resolveChart` (`orchestrator/internal/worker/worker.go`) already falls back
to a placeholder chart if the project's real one hasn't been scaffolded yet,
so this first deploy has something to run even in that edge case.

## Addendum: deploy status feedback + manual trigger (same session)

Guaranteeing the first `deploy` job surfaced a second, pre-existing gap:
nothing on the frontend ever showed a project's deploy status, and there
was no manual way to kick off a `deploy` job for a project that's already
`ready` — the only trigger was a `push` to `main`. Added:

- `JobRepository.findLatestByProjectAndKind(projectId, kind)`
  (`api/src/jobs/repository.ts`) — the project-level counterpart to the
  existing feature-scoped `findLatestJob`; `deploy` jobs carry no
  `feature_id`.
- `GET /:projectId/deploy` — the project's latest `deploy` job's
  `status`/`lastError`/`startedAt`/`completedAt`. No `events` array (unlike
  the feature events endpoint): `deploy` jobs run synchronously in the
  Orchestrator (`runDeploy`) with no curated event stream, so status +
  last_error is the whole picture.
- `POST /:projectId/deploy` — manual "Deploy now", guarded the same way
  `retry-build` guards a duplicate build: 409s if the project isn't `ready`
  yet, or if a deploy is already `pending`/`running`.
- `DeployStatusPanel` (`web/components/projects/deploy-status-panel.tsx`),
  shown on project home for a `ready` project — polls `GET .../deploy`
  every 3s and renders idle / in-progress (with elapsed time) / failed
  (with `lastError`) / completed (with a relative "Xm ago" and an "Open
  deployment ↗" link), plus the "Deploy now" button.
- The link is `https://<project-slug>.apps.<APPS_BASE_DOMAIN>[:APPS_HTTPS_PORT]`
  (ADR 003 §15's URL scheme), computed server-side by the API from
  `config.appsBaseDomain`/`config.appsHttpsPort` — the former independently
  configured from, but required to match, the Orchestrator's own
  `APPS_BASE_DOMAIN`; the latter API-only, empty in prod-shaped envs (see
  `docs/conventions/deploy.md`). Always present in the response
  (deterministic from the slug), but only rendered as a link once `status
  === "completed"` confirms something is actually running there.
- **Local dev addendum:** neither the domain nor the ingress port was
  actually reachable from the host before this — `APPS_BASE_DOMAIN`'s
  placeholder default resolved nowhere, and the bundled k3s cluster's
  Traefik ingress wasn't published to the host at all. Fixed by publishing
  it (`deploy/docker-compose.dev.yml`'s `k3s` service,
  `DEV_APPS_HTTP_PORT`/`DEV_APPS_HTTPS_PORT`, default `8090`/`8443`) and
  defaulting local `.env.example`s to `APPS_BASE_DOMAIN=127.0.0.1.nip.io`
  (nip.io: public wildcard DNS to `127.0.0.1`, no `/etc/hosts` editing) +
  `APPS_HTTPS_PORT=8443`. Full recipe:
  `orchestrator/docs/overview/setup.md`'s "Reaching a project's deployment
  locally".

## Consequences

### Positive

- Closes the exact gap the user hit: merging a PR on GitHub now updates
  Yggdrasil without a manual step.
- `project_init` projects can complete via a real PR merge, not only the
  `complete-init` button.
- Reviewer-requested changes now surface as `changes_requested` in the
  action queue (`projects/overview.ts` already had this wired up — it just
  never received real data).

### Negative / trade-offs

- Requires an out-of-band GitHub App settings change (event subscription)
  that this codebase cannot verify or enforce — a `docs/concepts/github-app.md`
  checklist item is the only guard against "I deployed this and nothing
  happens."
- PR closed-without-merge still has no lifecycle representation; scope
  intentionally left open rather than guessed at.
- No reconciliation path: if a webhook delivery is lost (GitHub outage,
  Yggdrasil downtime at delivery time), the feature silently stays
  `in_review` forever, same as before this ADR — GitHub does retry failed
  deliveries for a period, but there's no polling fallback if that window
  is missed.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Poll GitHub PR status periodically | Webhooks already exist and are signature-verified for this exact purpose; polling adds cost and latency for no benefit |
| Match feature by branch name instead of PR URL | PR URL is already stored (`setInReview`) and is globally unique; branch name needs a repo scope to disambiguate for no gain |
| Auto-advance on `pull_request_review` `state: "approved"` too | No lifecycle state means "approved, not yet merged"; `in_review` already covers it until the merge webhook fires |

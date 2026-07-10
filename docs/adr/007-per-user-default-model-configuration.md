# ADR 007: Per-user default model configuration

**Status:** Accepted
**Date:** 2026-07-10
**Deciders:** Product/design session (grill-with-docs)
**Amends:** [ADR 002](002-projects-features-tests.md) (action queue table, project creation flow)

## Context

Project creation (`POST /projects`) dispatches the `project_init` feature's `spec_grill`
job immediately (ADR 002 §5), with no check that the project has a resolvable model
configuration — `MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_ID`, stored encrypted in
`project_secrets` (`docs/concepts/pi-agent.md`). The create-project wizard never prompts
for these, so a new project's init grill starts with no working model backend and gets
stuck.

Model configuration today is project-only: every new project starts from zero and can
only be configured after the fact, on the project settings page. There is no team/org
entity yet — ADR 002's follow-ups defer RBAC to Phase 2 — projects are individually
owned via `owner_user_id`.

## Decision

1. **Scope: per-user default, not per-instance.** Each user has their own default model
   configuration. Unlike the GitHub App (genuinely one per self-hosted instance, ADR 005),
   there is no shared instance-wide model config — a multi-user instance has one default
   per user.
2. **Storage:** new `user_secrets` table, structurally identical to `project_secrets`
   (generic encrypted key/value, `UNIQUE(user_id, key_name)`), reusing the existing
   encryption module.
3. **Resolution is a live fallback, not a snapshot.** At every dispatch site, the API
   resolves each of `MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_ID` by checking
   `project_secrets` first, falling back to the owning user's `user_secrets`. Updating the
   user default immediately changes behavior for every project that never overrode it — no
   per-project copy is made at project-creation time.
4. **All-or-nothing bundle.** The three keys are one unit: a project has zero of them set
   at the project level (fully inheriting) or all three (fully custom). Partial per-key
   overrides are not supported, ruling out a custom key silently paired with a stale
   inherited base URL.
5. **Gate enforced at every dispatch site**, not just project creation: `POST /projects`,
   `POST /projects/:id/features`, `PATCH .../features/:id` (`startBuild`), and the
   `test_run` cron dispatcher all resolve model config before dispatching and refuse to
   proceed if it doesn't resolve.
   - Synchronous requests (project/feature creation, start build) return **400** with an
     actionable message.
   - `test_run`'s cron path has no request to fail against: it sets a new
     **`model_config_warning`** project flag (mirrors `github_access_warning`, ADR 005),
     emits a notification and a **"Fix model configuration"** action-queue item, and skips
     the run. Cleared the next time resolution succeeds.
6. **Wizard UX:** create-project gets a third step, `agent`, after `repos`: "use my
   default" (shown/pre-selected only when a default exists) vs. "configure a different
   agent for this project" (all three fields, required together). A first-time user with
   no default yet sees only the custom option, plus a "also save this as my account
   default" checkbox, checked by default.
7. **Project settings page:** the existing "Model configuration" card gains an
   inherited/custom toggle reflecting whether the project currently holds its own
   `project_secrets` rows. Switching to custom reveals the three fields; switching back to
   default deletes the project's rows so it falls back live again.
8. **Retry path for stuck `project_init`:** new
   `POST /projects/:projectId/features/:featureId/retry-grill`, scoped to
   `featureType === "project_init"` features in `failed`/`draft` with no active job.
   Re-resolves model config and re-dispatches `spec_grill`. General re-grilling of normal
   features stays out of scope — already an open ADR 002 follow-up, not conflated with this
   fix.

### ADR 002 amendments

- Action queue table gains a **"Fix model configuration"** row, same tier as "Fix GitHub
  access".
- `POST /projects` now validates a resolvable model configuration before creating the
  project or dispatching `spec_grill`.

Implementation reference: `docs/concepts/project-settings.md`, `docs/concepts/pi-agent.md`.

## Consequences

### Positive

- Closes the actual bug: no `spec_grill` can be dispatched without a working model
  backend.
- One place to rotate a key across every project still on "use default".
- Consistent with the existing `github_access_warning` pattern for proactive drift
  detection.

### Negative / trade-offs

- Live fallback means a project's behavior can change without anyone touching that
  project directly — breaking or rotating your default breaks every project still
  inheriting it.
- All-or-nothing bundle is less flexible than per-key overrides (can't share a base URL
  across projects while varying just the model ID).
- Per-user scope means an instance with several active users has several independent
  defaults to keep track of, not one shared config to administer.

### Follow-ups (out of scope)

- General re-grilling/retry for normal (non-init) features.
- Per-instance shared model configuration (would need a team/org entity first).
- Validating credentials actually work (test-call button) at save time.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Per-instance shared config | No team/org entity exists yet; would let any user see/change every other user's default |
| Snapshot copy at project creation | Diverges silently from the account default; a revoked key needs fixing in N places instead of one |
| Per-field override (mix-and-match) | Risks a custom key silently paired with a stale inherited base URL pointing elsewhere |
| Client-side wizard gate only | API stays dispatchable without config from any other caller — doesn't fix the bug at its root |
| Silent skip on test_run failure | No visible signal; a test could silently stop running with nobody noticing |
| Generic retry-grill for any feature | Conflates this fix with ADR 002's already-deferred general re-grilling question |

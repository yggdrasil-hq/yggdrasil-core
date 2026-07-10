# ADR 005: GitHub App for repository access

**Status:** Accepted  
**Date:** 2026-06-28  
**Deciders:** Product/design session (grill-with-docs)  
**Amends:** [ADR 001](001-authentication.md) (GitHub OAuth scope model), [ADR 002](002-projects-features-tests.md) (project linking)

## Context

Phase 1 originally used a **GitHub OAuth App** for both user identity and repository
access — progressive scopes (`read:user` first, `repo` when linking repos). User OAuth
tokens backed job-scoped credentials; **acting user** and **project linker** determined
whose grant powered each job.

Problems with that model:

- Org repos often need an org admin to grant access; user OAuth tokens are personal and
  fragile (revoked, expired, user leaves team).
- Planning around a future pivot to GitHub Apps created duplicate concepts and schema
  pressure.
- Open question #2 (GitHub App install model) blocked a clean repo-access design.

Constraints:

- Self-hosted deployment — each instance registers its own GitHub integrations.
- Small teams (2–10); projects may share one GitHub org across multiple Yggdrasil
  projects.
- Orchestrator is stateless — job specs carry short-lived credentials (see
  `docs/concepts/job-dispatch.md`).
- Identity design from ADR 001 (username/password, GitHub login, sessions) stays.

## Decision

### Split identity from repository access

1. **GitHub OAuth App** (per instance) — **identity only**: login, signup, account
   linking with `read:user` scope. No `repo` scope; no progressive scope upgrade.
2. **GitHub App** (per instance) — **repository access only**: org/user installation,
   installation access tokens for jobs, installation webhooks.

Both registrations are required at instance setup. See `docs/concepts/github-app.md`.

### GitHub App registration (per instance)

3. Instance admin creates a GitHub App with:
   - **Metadata:** Read
   - **Contents:** Read & write
   - **Pull requests:** Read & write
4. Credentials: app ID, private key (PEM), webhook secret. Env vars on the API.
5. Webhook URL: `POST /api/webhooks/github`. Callback URL for install flow.

### Installation model

6. GitHub allows **one installation per (app, org/account)**. Multiple Yggdrasil
   projects on the same org **share** that installation; each project picks its own
   primary + sub-repos from the installation's granted repo list.
7. Install grants **selected repositories only** (least privilege). Adding repos later
   requires re-configuring the installation on GitHub ("Configure" link in UI).
8. All linked repos for a project must belong to the **same installation** (same
   org/account). Cross-org sub-repos are out of scope for Phase 1.

### Project creation flow

9. Order: **name → install/configure → repo picker → create**.
10. If no installation exists for the target org/account → redirect to GitHub App
    install URL.
11. If installation already exists (another project on same org) → skip install; offer
    "Configure" if needed repos are not yet granted.
12. Non-org-admins may be blocked by GitHub — Yggdrasil fails gracefully with
    instructions and a shareable install URL for an org admin.
13. **GitHub identity link is optional** for project creation. Password-only users can
    create projects if they complete the install while logged into GitHub in the
    browser. Record **project installer** (Yggdrasil user who completed the flow) for
    audit.

### Job credentials and authorship

14. API mints **installation access tokens** (~1 hour TTL) as **job-scoped GitHub
    credentials** at dispatch time. No user OAuth `repo` tokens.
15. Commits and PRs appear as the **GitHub App bot** (`yggdrasil[bot]`), not the acting
    user. Acting user is tracked in Yggdrasil for audit/UX only.
16. **Container access tier**: `spec_grill` / `test_run` are read-only by Orchestrator
    tool allowlist; `feature_build` gets write tools. **Amended 2026-07-11:**
    `spec_grill`'s installation token is now also minted scoped to `contents: read`
    (`mintInstallationAccessToken`'s `permissions` param) — enforcement is no longer
    tool-allowlist-only for that job kind, since its bash tool is unrestricted and a
    write-capable token there was a real gap (a confused agent attempted `git init` +
    a planned push when it lost track of its own read-only repo). `test_run` still
    gets a full-permission token pending its own dispatch implementation; scope it the
    same way when that lands. `feature_build`'s token is unaffected.

### Webhooks (installation lifecycle only)

17. Handle `installation` and `installation_repositories` events.
18. On revoked access or removed repos → set **GitHub access warning** on affected
    projects. Jobs fail fast; action queue shows "Fix GitHub access" with
    re-install/configure link. Cleared when access is restored.
19. **No PR-merge webhooks in Phase 1** — feature lifecycle advances manually in
    Yggdrasil.

### ADR 001 amendments

20. Remove progressive `repo` scope and `intent=upgrade` OAuth flow.
21. `github_tokens` (if stored) hold identity-only grants (`read:user`); not used for
    repo operations.

Implementation reference: `docs/concepts/github-app.md`.

## Consequences

### Positive

- No future pivot — repo access model is final for Phase 1.
- Scheduled `test_run` jobs no longer depend on a linker's personal OAuth grant.
- Org admins control repo access via standard GitHub App install UX.
- Installation webhooks keep Yggdrasil's repo list in sync with GitHub.

### Negative / trade-offs

- **Two GitHub registrations** per instance (OAuth App + GitHub App) — more setup docs.
- **Bot authorship** on GitHub — human attribution only inside Yggdrasil.
- **Selected repos** — adding sub-repos requires a GitHub configure trip.
- **Same-org constraint** — cross-org sub-repos need a future escape hatch.
- Installation tokens still carry write permissions for `test_run` (not yet
  dispatched for real) and, previously, `spec_grill` — see item 16's 2026-07-11
  amendment for why `spec_grill` moved to a `contents: read`-scoped token instead of
  relying on operational enforcement alone.

### Follow-ups (out of scope)

- User-to-server tokens for human attribution on commits/PRs.
- PR-merge webhooks to auto-advance feature lifecycle.
- Cross-org sub-repos (install-per-repo model).
- Pre-check org admin before install redirect (UX polish).

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| OAuth user tokens for repo access (status quo) | Personal tokens fragile; org access awkward; deferred pivot tax |
| User-to-server tokens for all writes | Extra token lifecycle; deferred — bot authorship sufficient for Phase 1 |
| All repos on org at install | Over-broad permissions; rejected for least privilege |
| One installation per Yggdrasil project | GitHub only allows one install per org — impossible |
| Shared marketplace GitHub App | Callbacks/webhooks can't point at multiple self-hosted instances |
| No webhooks (discover failures at job time) | Silent drift when admin removes repos; action queue needs proactive signal |
| GitHub link required for project creation | No security benefit; blocks password-only users unnecessarily |

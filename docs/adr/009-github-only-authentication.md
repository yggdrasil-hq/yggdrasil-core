# ADR 009: GitHub-only authentication (remove username/password)

**Status:** Accepted
**Date:** 2026-07-11
**Amends:** ADR 001 (authentication and user identity)
**Deciders:** Product decision (direct request)

## Context

ADR 001 shipped two signup/login paths — username/password and GitHub OAuth —
plus linking, disconnecting, password rate-limiting, and an "unlinked GitHub on
login" interstitial. In practice this doubled the auth surface (routes, DB
columns, UI states) for a self-hosted, small-team tool where every user already
has a GitHub account. There are no real users on any instance yet, so this is a
pre-launch simplification, not a migration.

## Decision

1. **GitHub OAuth is the only sign-in method.** Drop username/password signup,
   login, password rules, password rate limiting, and password change/set.
2. **Single OAuth flow, no `intent` parameter.** `GET /api/auth/github` starts
   OAuth; the callback looks up the user by `github_id`: found → log in (session
   + refresh stored token); not found → auto-provision (same hybrid
   `pending_username` onboarding as before, still gated by
   `/onboarding/confirm-username`). This collapses the old `login`, `signup`,
   and `link` intents into one flow — there is no other account to link to or
   disconnect from.
3. **`users.github_id` / `github_login` are required, not nullable.** Every user
   has exactly one identity: their GitHub account.
4. **No account linking/unlinking UI.** Settings → Connections is removed. The
   only settings left for identity are display name and logout.
5. **Rate limiting on login is removed.** It existed to blunt password brute
   force; there is no password to brute-force. OAuth itself is rate-limited by
   GitHub.
6. **"Remember me" is removed.** It was a password-login affordance; GitHub
   sessions keep the existing default (24h) TTL used by the old GitHub path.
7. **Avatars unchanged:** still DiceBear `thumbs` seeded by username, not the
   GitHub profile photo.

## Consequences

### Positive

- One auth surface instead of two: fewer routes, fewer DB columns, fewer UI
  states, no password hashing/storage/rate-limiting code.
- No "no password recovery" warning needed anywhere — GitHub owns account
  recovery.
- Removes the login-page "GitHub not linked, sign in to link or create new
  account" interstitial entirely.

### Negative / trade-offs

- **Hard dependency on GitHub.** An instance is unusable if `GITHUB_CLIENT_ID`/
  `GITHUB_CLIENT_SECRET` are not configured, or if GitHub OAuth is down.
- **No non-GitHub fallback** for teams that can't or won't use GitHub identity
  (out of scope for this product; GitHub is already required for repo access).

### Follow-ups

- None planned. If a non-GitHub identity path is ever needed, it should be a
  new ADR rather than resurrecting the removed password code.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Keep both paths, simplify only the UI | The complexity is in the auth surface (routes, columns, rate limiting), not just the forms |
| Migrate existing password users to GitHub-only | No real users yet; nothing to migrate |
| Keep password as an admin/emergency-only login | Adds a whole second code path for a case that hasn't come up |

## Related

- Supersedes the password/GitHub-OAuth split in [ADR 001](001-authentication.md)
  (still the record of the original decision and rationale for open
  registration, no email, sessions, and GitHub App vs. OAuth split — all of
  which still hold).
- Implementation reference: [`../concepts/authentication.md`](../concepts/authentication.md)
- Repository access (GitHub App, unaffected by this change): [ADR 005](005-github-app-repository-access.md)

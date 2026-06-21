# ADR 001: Authentication and user identity

**Status:** Accepted  
**Date:** 2026-06-21  
**Deciders:** Product/design session (grill-me)

## Context

Phase 1 requires authentication for the self-hosted Yggdrasil suite. Users must be
able to sign up and sign in with **username/password** or **GitHub OAuth**. Password
users must be able to connect GitHub later; GitHub-only users must be able to add a
password later.

Constraints from product:

- **No email** — no verification, no password reset via email. Users must be warned
  that losing their password means losing the account.
- **Open registration** on a self-hosted instance (anyone who can reach the URL).
- Small-team, self-hosted deployment behind nginx (`/app` + `/api` on one origin in
  dev).
- GitHub is needed for identity now and for repo access later (Orchestrator runs).
  Open question #2 (GitHub App vs OAuth App) blocked a full auth design.

## Decision

### Sign-up and identity

1. **Two signup paths:** username/password at `/signup`, or GitHub OAuth.
2. **Username rules:** permanent after onboarding; `[a-z0-9_-]`, 3–32 characters;
   globally unique per instance. **Display name** is separate and editable.
3. **GitHub signup (hybrid onboarding):** after OAuth, auto-provision with GitHub
   login as the default username. User must pass through
   `/onboarding/confirm-username` (hard gate — account in `pending_username` state)
   before accessing the rest of the app.
4. **Password rules:** minimum 8 characters; no complexity requirements; optional
   strength hint in UI; prominent no-recovery warning on signup and set-password.
5. **Avatars:** DiceBear **`thumbs`** style, seeded with **username** — always, even
   when GitHub is linked (GitHub profile photos are not shown).

### Sessions

6. **HttpOnly session cookie** issued by the API; sessions stored server-side in
   **PostgreSQL** (no JWT in localStorage).
7. **Idle timeout:** 24 hours by default; 30 days when “Remember me” is checked.
   “Remember me” defaults to **unchecked**. Logout deletes the current session.
8. **Password change / first-time set** revokes all other sessions; current session
   stays valid.

### GitHub OAuth

9. **Phase 1:** **GitHub OAuth App** for login, signup, linking, and token storage.
   DB schema and API boundaries must allow a **GitHub App** later (org installs,
   webhooks) without migrating users.
10. **API owns the OAuth flow:** `GET /api/auth/github?intent=…` → GitHub →
    `GET /api/auth/github/callback` → API sets session cookie → redirect to Web.
11. **Progressive scopes:** `read:user` for login/signup/link; `repo` only when
    connecting a repo to a project or upgrading scopes in Settings.
12. **Linking:** password users connect GitHub from Settings while authenticated.
    Hard reject if GitHub is already linked to another user.
13. **Unlinked GitHub on login page:** offer choice — create a new account **or**
    sign in with password first to link (prevents accidental duplicate accounts).
14. **Disconnect GitHub:** allowed only if the user has a password set (never leave
    an account with zero login methods).

### Security and UX

15. **Rate limiting** on login: 10 failed attempts per username per 15 minutes; 30
    per IP per 15 minutes; generic “Invalid username or password” responses.
16. **Web routes:** separate `/login` and `/signup`; `/settings/account` for profile,
    security, and GitHub connection.
17. **Route protection:** Next.js middleware redirects unauthenticated users to
    `/login?next=…`; `AuthProvider` loads the current user for the app shell.

Implementation reference (API routes, flows, data model sketch):
`docs/concepts/authentication.md`.

## Consequences

### Positive

- No email infrastructure; auth ships quickly for self-hosted teams.
- Session cookies on a shared origin are simple for REST and WebSocket.
- Progressive GitHub scopes reduce consent friction at signup.
- Schema ready for GitHub App without rewriting identity.

### Negative / trade-offs

- **No password recovery** — support burden falls on admins / account loss.
- **Open registration** — instances exposed to the internet can accumulate
  unwanted accounts (mitigation deferred; no invite-only gate in Phase 1).
- **No account merge** — duplicate accounts from user error require manual cleanup.
- **OAuth App user tokens** for repo access may be insufficient for org-level GitHub
  App installs — GitHub App work remains in open questions.

### Follow-ups (out of scope for this ADR)

- GitHub App for org repos, webhooks, installation tokens (see open questions #2).
- Team invites and RBAC (Phase 2).
- “Logout all devices” as an explicit UI action (session revocation on password
  change covers the security case).
- Custom avatar upload.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Email + verification + password reset | Explicit product choice to avoid email hassle |
| JWT in localStorage | XSS token theft; harder WebSocket auth |
| First-user bootstrap / closed registration | Chosen open registration instead |
| GitHub App from day one | Too much scope before auth ships; OAuth App sufficient for Phase 1 identity |
| `repo` scope on every OAuth | Heavy consent before users understand why |
| Auto-create account on unlinked GitHub login | Creates duplicate accounts for password users |
| Account merge on GitHub conflict | Complex; deferred |
| GitHub profile photo as avatar | Product chose consistent DiceBear thumbs for all users |
| Permanent username with no confirm step | Hybrid confirm screen preserves ability to fix bad GitHub defaults |

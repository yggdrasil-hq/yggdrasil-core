# Authentication

**Read this when:** you implement or modify login, sessions, GitHub OAuth
(identity), onboarding, or account settings in the API or Web app.
**Skip if:** you only need the rationale — see
[`../adr/009-github-only-authentication.md`](../adr/009-github-only-authentication.md)
(and [`../adr/001-authentication.md`](../adr/001-authentication.md) for the
still-standing parts: no email, open registration, sessions, avatars).
For repository access, see [`github-app.md`](github-app.md) (ADR 005).

> **Status:** Accepted (ADR 001, amended by ADR 005 and ADR 009). This doc is
> the implementation reference. GitHub OAuth is the **only** sign-in method —
> there is no username/password path.

## Summary

| Topic | Choice |
|-------|--------|
| Signup / login | GitHub OAuth only |
| Email | Not used |
| Registration | Open (anyone who can reach the instance) |
| Session | HttpOnly cookie, PostgreSQL-backed, API-issued |
| GitHub OAuth | Identity only (`read:user`); no `repo` scope |
| Repo access | GitHub App — see [`github-app.md`](github-app.md) |
| Avatar | DiceBear `thumbs`, seed = username |

## User model (sketch)

```
users
  id, username (unique, immutable after onboarding)
  display_name
  onboarding_state: pending_username | active
  github_id (unique, required)
  github_login (required)
  created_at, updated_at

sessions
  id, user_id, expires_at, remember_me, created_at, last_seen_at

github_tokens (encrypted, optional)
  user_id, access_token, refresh_token?, scopes[]  -- read:user only
  updated_at
```

## Flow

There is a single OAuth flow — no `intent` parameter, no separate signup/login/
link paths.

1. Web → `GET /api/auth/github` (optional `return_to` query param).
2. API creates a CSRF `state` (`oauth_states` table, 10 min TTL), redirects to
   GitHub with `read:user` scope.
3. `GET /api/auth/github/callback` — API exchanges the code, fetches the GitHub
   user, and looks up by `github_id`:
   - **Found** → refresh the stored token, create a session, redirect (to
     `/onboarding/confirm-username` if still `pending_username`, else to
     `return_to` or home).
   - **Not found** → auto-provision a new user (`pending_username`, username
     defaulted from the GitHub login, deduped if taken), store the token,
     create a session, redirect to `/onboarding/confirm-username`.
4. `POST /api/auth/onboarding/confirm-username` — confirm or change the
   username (one time); sets `onboarding_state = active`. Middleware blocks
   all other routes until active.

Re-connecting GitHub (e.g. from the "create project" flow, if the stored token
goes stale) reuses this exact same flow — it's just a login that happens to
update the token.

## API surface

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/auth/github` | — | Start OAuth (`return_to` optional) |
| GET | `/api/auth/github/callback` | — | OAuth callback |
| POST | `/api/auth/logout` | session | End session |
| GET | `/api/auth/me` | session | Current user |
| POST | `/api/auth/onboarding/confirm-username` | session | Finish onboarding |
| PATCH | `/api/settings/account` | session | Update display name |

Session cookie: `Path=/`, `HttpOnly`, `SameSite=Lax`, `Secure` in production.

## Web routes

| Route | Purpose |
|-------|------|
| `/login` | "Continue with GitHub" button only |
| `/onboarding/confirm-username` | Hard gate for `pending_username` |
| `/settings/account` | Profile (display name) and logout |

**Protection:** Next.js middleware on app routes → `/login?next=…` if no session.
`AuthProvider` calls `GET /api/auth/me` for shell user state.

## UI sections (`/settings/account`)

1. **Profile** — display name; DiceBear thumbs avatar (username seed); shows
   the linked GitHub login (informational, not editable). Logout.

There is no Security or Connections section — there is nothing to set/change
(password) or link/disconnect (GitHub is the identity, not an optional add-on).

## Avatars

Use `@dicebear/collection` **`thumbs`** style with **username** as seed
(`@dicebear/core`), not the GitHub profile photo.

## Related docs

- Decision + rationale: [`../adr/009-github-only-authentication.md`](../adr/009-github-only-authentication.md),
  [`../adr/001-authentication.md`](../adr/001-authentication.md)
- Repository access: [`github-app.md`](github-app.md) → [`../adr/005-github-app-repository-access.md`](../adr/005-github-app-repository-access.md)
- API implementation notes: `api/docs/concepts/authentication.md`
- Web implementation notes: `web/docs/concepts/authentication.md`

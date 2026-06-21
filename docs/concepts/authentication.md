# Authentication

**Read this when:** you implement or modify login, signup, sessions, password
management, GitHub OAuth, or account settings in the API or Web app.
**Skip if:** you only need the rationale — see [`../adr/001-authentication.md`](../adr/001-authentication.md).

> **Status:** Accepted (ADR 001). This doc is the implementation reference.

## Summary

| Topic | Choice |
|-------|--------|
| Signup / login | Username+password **or** GitHub OAuth |
| Email | Not used |
| Password recovery | None — warn users at signup |
| Registration | Open (anyone who can reach the instance) |
| Session | HttpOnly cookie, PostgreSQL-backed, API-issued |
| GitHub (Phase 1) | OAuth App; progressive scopes; schema ready for GitHub App |
| Avatar | DiceBear `thumbs`, seed = username |

## User model (sketch)

```
users
  id, username (unique, immutable after onboarding)
  display_name
  password_hash (nullable — GitHub-only users)
  onboarding_state: pending_username | active
  github_id (nullable, unique)
  github_login (nullable)
  created_at, updated_at

sessions
  id, user_id, expires_at, remember_me, created_at, last_seen_at

github_tokens (encrypted)
  user_id, access_token, refresh_token?, scopes[], updated_at
```

Password hashing: argon2 or bcrypt (pick one in implementation).

## Flows

### Password signup

1. `POST /api/auth/signup` — username, password, display_name (optional).
2. Validate username rules; show no-recovery warning in UI before submit.
3. Create user (`onboarding_state = active`), hash password, create session, set cookie.
4. Redirect to app home.

### Password login

1. `POST /api/auth/login` — username, password, remember_me (default false).
2. Rate-limited; generic error on failure.
3. Create session (24h or 30d idle TTL), set cookie.
4. Redirect to `next` query param or home.

### GitHub signup

1. Web → `GET /api/auth/github?intent=signup`.
2. OAuth with `read:user` scope only.
3. Callback: if `github_id` new → create user (`pending_username`), store token,
   session, redirect to `/onboarding/confirm-username`.
4. `POST /api/auth/onboarding/confirm-username` — confirm or change username (one
   time); set `onboarding_state = active`.
5. Middleware blocks all routes except onboarding until active.

### GitHub login

1. Web → `GET /api/auth/github?intent=login`.
2. If `github_id` linked → session → redirect home.
3. If not linked → redirect to Web interstitial: **create new account** (→ signup
   intent) **or** sign in with password to link in Settings.

### Link GitHub (Settings)

1. Authenticated user → `GET /api/auth/github?intent=link`.
2. OAuth with `read:user`; reject if `github_id` belongs to another user.
3. Store token; update `github_id` / `github_login`.

### Upgrade to `repo` scope

When connecting a repo or from Settings → `GET /api/auth/github?intent=upgrade` (or
dedicated upgrade endpoint) requesting `repo`. Store updated token + scopes.

### Disconnect GitHub

`DELETE /api/settings/github` — only if `password_hash` is set. Clear token and
GitHub fields.

### Set / change password

- **Set** (GitHub-only, no password): `POST /api/settings/password` with new password
  only.
- **Change**: current + new password.
- Revoke all sessions except current.

## API surface (Phase 1)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/signup` | — | Password signup |
| POST | `/api/auth/login` | — | Password login |
| POST | `/api/auth/logout` | session | End session |
| GET | `/api/auth/me` | session | Current user |
| POST | `/api/auth/onboarding/confirm-username` | session | Finish GitHub onboarding |
| GET | `/api/auth/github` | optional | Start OAuth (`intent=login\|signup\|link\|upgrade`) |
| GET | `/api/auth/github/callback` | — | OAuth callback |
| PATCH | `/api/settings/account` | session | Update display name |
| POST | `/api/settings/password` | session | Set or change password |
| DELETE | `/api/settings/github` | session | Disconnect GitHub (guarded) |

Session cookie: `Path=/`, `HttpOnly`, `SameSite=Lax`, `Secure` in production.

## Web routes (Phase 1)

| Route | Purpose |
|-------|---------|
| `/login` | Password login + GitHub; remember me (default off) |
| `/signup` | Password signup + GitHub; no-recovery warning |
| `/onboarding/confirm-username` | Hard gate for `pending_username` |
| `/settings/account` | Profile, security, GitHub connection |

**Protection:** Next.js middleware on app routes → `/login?next=…` if no session.
`AuthProvider` calls `GET /api/auth/me` for shell user state.

## UI sections (`/settings/account`)

1. **Profile** — display name; DiceBear thumbs avatar (username seed).
2. **Security** — set/change password; logout.
3. **Connections** — GitHub status, connect, disconnect (guarded).

## Avatars

Use `@dicebear/collection` **`thumbs`** style with **username** as seed. Same avatar
for all users regardless of GitHub link. Render client-side or via deterministic URL
— implementation choice in Web.

## Related docs

- Rationale: [`../adr/001-authentication.md`](../adr/001-authentication.md)
- API implementation notes: `api/docs/concepts/authentication.md`
- Web implementation notes: `web/docs/concepts/authentication.md`
- GitHub App (still open): [`../roadmap/open-questions.md`](../roadmap/open-questions.md) #2

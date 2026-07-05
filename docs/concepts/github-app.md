# GitHub App (installation, permissions, repo sync)

**Read this when:** you implement or modify project→repo linking, the GitHub App
install/callback flow, installation permission requirements, or repo-list syncing
in the API or Web app.
**Skip if:** you only need GitHub **OAuth App** login/signup — see
[`authentication.md`](authentication.md) and
[`../adr/001-authentication.md`](../adr/001-authentication.md) (a separate GitHub
app registration from the one described here).

> **Status:** Decided. Resolves open question #2 from
> [`../roadmap/open-questions.md`](../roadmap/open-questions.md) (installation
> model + permissions). No ADR — this is implementation detail, not a rationale
> record.

## Two separate GitHub integrations

Yggdrasil registers **two different GitHub apps**, easy to conflate:

| | Purpose | Auth | Where |
|---|---|---|---|
| GitHub **OAuth App** | User login/signup/identity | `read:user`, `repo` scopes on a user token | `concepts/authentication.md` |
| GitHub **App** (this doc) | Org/repo installation for cloning, branches, PRs | JWT (app) → short-lived installation access token | `api/src/github/*.ts` |

## Required permissions

The GitHub App (Settings → Developer settings → GitHub Apps → your app →
**Permissions & events**) must request:

| Permission | Level | Why |
|---|---|---|
| **Contents** | Read and write | Clone repos, create branches, commit (see `job-dispatch.md`) |
| **Pull requests** | Read and write | Open draft PRs |
| **Metadata** | Read-only | Required by GitHub for every App install |

Without at least Contents + Pull requests, GitHub's install/configure screen
shows **"This App does not require access to your repositories"** and offers no
repo picker at all — the installation succeeds but is useless. If you hit that
screen, the fix is in the App's GitHub settings, not in Yggdrasil config.

## Setup URL (post-install redirect)

GitHub does **not** redirect back to the app after install unless a **Setup URL**
is configured on the GitHub App itself:

- **Setup URL:** `<APP_PUBLIC_URL-derived origin>/api/github/install/callback`
  (e.g. `http://localhost:8080/api/github/install/callback` in dev)
- Check **"Redirect on update"** so re-configuring an existing installation also
  redirects back (not just fresh installs).

Without this, GitHub shows its own generic "app installed" confirmation page and
the flow silently stalls — this looks like a bug but is a GitHub App setting.

## Install flow

1. Web: `POST`-equivalent `GET /api/github/install?name=&description=&return_to=`
   (session-authed). API stores a one-time `installState` (draft project name/
   description + `return_to`) and redirects to
   `https://github.com/apps/<slug>/installations/new?state=<state>`.
2. User installs/configures on GitHub.
3. GitHub redirects to the **Setup URL** above with
   `installation_id`, `setup_action`, `state`.
4. API (`api/src/github/install-routes.ts`, `GET /install/callback`) consumes the
   `installState` (one-time use), calls `syncInstallationFromGitHub`, then
   redirects to `return_to` (or `/projects/new`) with `step=repos&installation_id=...`.
5. Web repo-picker step lists synced repos; "Configure on GitHub" /
   "Refresh" re-trigger sync if permissions/repos change.

## Repo sync — correct GitHub API contract

`syncInstallationFromGitHub` (`api/src/github/sync-installation.ts`) must:

1. `GET /app/installations/{id}` — **app JWT** auth. Confirms installation +
   account.
2. `POST /app/installations/{id}/access_tokens` — **app JWT** auth. Mints a
   short-lived installation access token (`mintInstallationAccessToken` in
   `github-api.ts`).
3. `GET /installation/repositories` — **installation token** auth (not JWT).
   Returns `{ total_count, repository_selection, repositories: [] }`; paginate
   with `?page=`.

There is **no** `/app/installations/{id}/repositories` endpoint — calling it with
a JWT 404s. This was a real bug fixed in `github-api.ts`'s
`fetchInstallationRepositories`; don't reintroduce it.

## Env vars (API)

`GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM, real or `\n`-escaped newlines —
both normalized in `app-jwt.ts`), `GITHUB_APP_SLUG`, `GITHUB_APP_WEBHOOK_SECRET`.
`isGitHubAppConfigured()` in `api/src/config.ts` gates the install routes with a
`503` if any of app id/private key/slug is missing.

## Related docs

- [`job-dispatch.md`](job-dispatch.md) — what Contents/Pull requests access is used for at runtime.
- [`../adr/001-authentication.md`](../adr/001-authentication.md) — the separate OAuth App used for login.

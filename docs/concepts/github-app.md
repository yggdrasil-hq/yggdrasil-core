# GitHub App (repository access, installation & sync)

**Read this when:** you implement or modify GitHub App installation, installation
tokens, webhooks, project→repo linking, the install/callback flow, repo-list
syncing, or job credential minting.
**Skip if:** you only need identity/login — see [`authentication.md`](authentication.md)
and ADR [`../adr/001-authentication.md`](../adr/001-authentication.md) (a separate
GitHub app registration from the one described here).

> **Status:** Accepted (ADR 005). Rationale:
> [`../adr/005-github-app-repository-access.md`](../adr/005-github-app-repository-access.md).
> Also resolves open question #2 from
> [`../roadmap/open-questions.md`](../roadmap/open-questions.md) (installation
> model + permissions).
>
> **PR-merge/review webhooks (ADR 013):**
> [`../adr/013-pr-merge-webhooks.md`](../adr/013-pr-merge-webhooks.md) reverses
> ADR 005 §19 for `merged`/`changes_requested` — see the Webhooks table below.

## Summary

| Topic | Choice |
|-------|--------|
| Identity | GitHub OAuth App — `read:user` only ([`authentication.md`](authentication.md)) |
| Repo access | GitHub App — installation tokens |
| Instance setup | One OAuth App + one GitHub App per deployment |
| Install scope | Selected repos; re-configure on GitHub to add |
| Install sharing | One installation per (app, org) — shared across Yggdrasil projects |
| Job credential | Installation access token (~1h), minted at dispatch |
| Git authorship | GitHub App bot (`yggdrasil[bot]`) |
| Webhooks | `installation`, `installation_repositories`, `pull_request` (merged), `pull_request_review` (changes requested), `push` (dispatches `deploy` on push to primary's `main`) |
| Broken access | `github_access_warning` flag + action queue item |

## Two separate GitHub integrations

Yggdrasil registers **two different GitHub apps**, easy to conflate:

| | Purpose | Auth | Where |
|---|---|---|---|
| GitHub **OAuth App** | User login/identity (the only sign-in method, ADR 009) | `read:user` scope on a user token | `concepts/authentication.md` |
| GitHub **App** (this doc) | Org/repo installation for cloning, branches, PRs | JWT (app) → short-lived installation access token | `api/src/github/*.ts` |

## Instance admin setup

Each self-hosted deployment registers **two** GitHub integrations:

### GitHub OAuth App (identity)

- Scopes: `read:user` only
- Callback: `GET /api/auth/github/callback`
- Env: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (`api/src/config.ts`)

### GitHub App (repository access)

The GitHub App (Settings → Developer settings → GitHub Apps → your app →
**Permissions & events**) must request:

| Permission | Level | Why |
|---|---|---|
| **Contents** | Read and write | Clone repos, create branches, commit (see `job-dispatch.md`) |
| **Pull requests** | Read and write | Open draft PRs |
| **Workflows** | Read and write | Create/update files under `.github/workflows/` — GitHub enforces this as a *separate* permission from Contents; Contents write alone is not enough and the push is rejected server-side (ADR 005 §3 amendment) |
| **Metadata** | Read-only | Required by GitHub for every App install |

Without at least Contents + Pull requests, GitHub's install/configure screen
shows **"This App does not require access to your repositories"** and offers no
repo picker at all — the installation succeeds but is useless. If you hit that
screen, the fix is in the App's GitHub settings, not in Yggdrasil config.

If a `feature_build` fails to push because GitHub rejects a `.github/workflows/*`
file specifically (while other files in the same push succeed), the App
registration is missing the Workflows permission above — add it, then each
existing installation's org admin must **re-accept the updated permissions**
(GitHub shows a "review requested permissions" prompt; no reinstall needed).

Under the same **Permissions & events** page, **Subscribe to events** must also
have **Pull request** and **Pull request review** checked (ADR 013) — these
options only appear once the Pull requests permission above is granted. This
is required for merge/changes-requested auto-detection to work at all; the
webhook code has no way to verify or enforce it, so a merged PR that never
updates a feature's status is very likely this checkbox, not a bug. No
reinstall needed — GitHub starts delivering the events immediately once the
App registration is saved.

- Webhook URL: `POST /api/webhooks/github`
- Install callback: `GET /api/github/install/callback`
- Env: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM, real or `\n`-escaped
  newlines — both normalized in `app-jwt.ts`), `GITHUB_APP_SLUG`,
  `GITHUB_APP_WEBHOOK_SECRET`. `isGitHubAppConfigured()` in `api/src/config.ts`
  gates the install routes with a `503` if any of app id/private key/slug is
  missing.

#### Setup URL (post-install redirect)

GitHub does **not** redirect back to the app after install unless a **Setup URL**
is configured on the GitHub App itself:

- **Setup URL:** `<APP_PUBLIC_URL-derived origin>/api/github/install/callback`
  (e.g. `http://localhost:8080/api/github/install/callback` in dev)
- Check **"Redirect on update"** so re-configuring an existing installation also
  redirects back (not just fresh installs).

Without this, GitHub shows its own generic "app installed" confirmation page and
the flow silently stalls — this looks like a bug but is a GitHub App setting.

Document the checklist in `deploy/` when implementation lands.

## Data model (sketch)

```
github_installations
  id
  installation_id          -- GitHub's installation ID (unique per app+org)
  account_type             -- Organization | User
  account_login
  account_id               -- GitHub account ID
  installed_by_user_id     -- Yggdrasil user (project installer, audit)
  suspended_at             -- nullable
  created_at, updated_at

github_installation_repos
  installation_id          -- FK
  repo_full_name           -- e.g. acme/web-app
  repo_id                  -- GitHub repo ID

projects
  ...
  installation_id          -- FK → github_installations
  primary_repo_full_name
  github_access_warning    -- boolean, set by webhooks
  ...

project_repositories       -- actual table name (migration 002_projects.sql);
  project_id                  differs from the sketch above
  github_owner
  github_repo
  is_primary               -- boolean, not a `role` enum
  sort_order

user_installation_access   -- per-user installation-reconciliation cache
  user_id
  installation_id
  repos                    -- synced repo list for this user+installation
  reauth_required          -- boolean
  stale                    -- boolean
  ...

user_github_sync_state     -- tracks last reconciliation per user
  user_id
  ...
```

Projects reference one installation. Linked repos must be a subset of
`github_installation_repos` for that installation.

**Per-user installation reconciliation (implemented, not previously
documented here):** `GET /api/github/installations` is **per-user**, not
instance-wide — it calls `reconcileUserInstallations(userId)`
(`api/src/github/reconcile-user-installations.ts`), which hits GitHub's
`GET /user/installations` with the user's own OAuth token (refreshing via
`refresh_token` if expired) and upserts `user_installation_access` /
`user_github_sync_state`. The response includes `repos`, `reauthRequired`,
and `stale` flags reflecting that reconciliation, none of which are
API-surface-table concepts elsewhere in this doc.

## Project creation flow

1. User enters project name → API stores draft in session.
2. **GitHub step:**
   - User picks target org/account (or personal).
   - If no `github_installations` row for that org/account → redirect to GitHub App
     install URL (`state` encodes draft + return path).
   - If installation exists → continue to repo picker; show "Configure on GitHub" if
     a needed repo is not in `github_installation_repos`.
   - If GitHub blocks non-admin → return with error UI + shareable install URL.
3. **Install callback** → API upserts `github_installations`, syncs repos from
   GitHub API, redirects to repo picker.
4. User picks **primary** + optional **sub-repos** from installation repo list.
5. `POST /api/projects` → create project, link repos, record installer, dispatch
   `project_init`.

GitHub identity link in Settings is **not** required for this flow.

### Install flow (implementation detail)

1. Web: `GET /api/github/install?name=&description=&return_to=`
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

### Repo sync — correct GitHub API contract

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

## Installation token minting (jobs)

At job dispatch (`spec_grill`, `feature_build`, `test_run`):

1. Load project's `installation_id`. Fail fast if `github_access_warning` is set.
2. Build JWT (app ID + private key, short TTL).
3. `POST /app/installations/{installation_id}/access_tokens` → installation token.
4. Inject token into job spec as **job-scoped GitHub credential**.

Orchestrator uses token for `git clone`, commits, and PR APIs. All git writes appear
as the App bot.

## Webhooks

`POST /api/webhooks/github` — verify `X-Hub-Signature-256` with webhook secret.

| Event | Action |
|-------|--------|
| `installation` (created) | Upsert installation; sync repos |
| `installation` (deleted) | Mark installation suspended; set `github_access_warning` on all linked projects |
| `installation` (suspend) | Same as deleted |
| `installation` (unsuspend) | Clear suspension; clear warnings if repos restored |
| `installation_repositories` (added) | Add rows to `github_installation_repos` |
| `installation_repositories` (removed) | Remove rows; if removed repo is linked to a project → set `github_access_warning` |
| `pull_request` (closed, `merged: true`) | Feature matched by `pr_url` → `status = 'merged'`; if `project_init`, also `projects.markReady` if still `initializing` (ADR 013) |
| `pull_request` (closed, `merged: false`) | No-op — no lifecycle state represents "closed without merging" yet |
| `pull_request_review` (submitted, `state: "changes_requested"`) | Feature matched by `pr_url`, only if currently `in_review` → `status = 'changes_requested'` (ADR 013) |
| `push` (to primary repo's default branch) | `handlePushEvent` dispatches a `deploy` job (see `job-dispatch.md`) |

## GitHub access warning

When set on a project:

- New job dispatch fails fast with a clear error.
- Action queue shows **Fix GitHub access** → deep link to re-install or GitHub
  "Configure installation" URL.
- Cleared when webhook confirms access restored and all linked repos are granted again.

Add to action queue types in ADR 002.

## API surface (sketch)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/github/install` | session | Start install (`project_draft_id`, `account`) |
| GET | `/api/github/install/callback` | — | Install callback from GitHub |
| GET | `/api/github/installations` | session | List installations for the **current user** (`listForUser`), reconciled live against GitHub — see per-user reconciliation above |
| GET | `/api/github/installations/:id/repos` | session | Repos granted on an installation |
| GET | `/api/github/installations/:id/configure-url` | session | GitHub "Configure installation" deep link |
| POST | `/api/github/installations/:id/sync` | session | Force a repo/permission re-sync for an installation |
| POST | `/api/webhooks/github` | signature | Installation lifecycle webhooks |

Project CRUD endpoints accept `installation_id` + repo selection — see project API when
implemented.

## Related docs

- Identity OAuth: [`authentication.md`](authentication.md)
- Job dispatch: [`job-dispatch.md`](job-dispatch.md)
- Project settings / repos: [`project-settings.md`](project-settings.md)
- Glossary: [`../CONTEXT.md`](../CONTEXT.md)

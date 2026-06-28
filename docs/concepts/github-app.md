# GitHub App (repository access)

**Read this when:** you implement or modify GitHub App installation, installation
tokens, webhooks, project repo linking, or job credential minting.
**Skip if:** you only need identity/login — see [`authentication.md`](authentication.md)
and ADR [`../adr/001-authentication.md`](../adr/001-authentication.md).

> **Status:** Accepted (ADR 003). Rationale: [`../adr/003-github-app-repository-access.md`](../adr/003-github-app-repository-access.md).

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
| Webhooks | `installation`, `installation_repositories` only |
| Broken access | `github_access_warning` flag + action queue item |

## Instance admin setup

Each self-hosted deployment registers **two** GitHub integrations:

### GitHub OAuth App (identity)

- Scopes: `read:user` only
- Callback: `GET /api/auth/github/callback`
- Env: `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`

### GitHub App (repository access)

- Permissions: Metadata (read), Contents (read & write), Pull requests (read & write)
- Webhook URL: `POST /api/webhooks/github`
- Install callback: `GET /api/github/install/callback`
- Env: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM), `GITHUB_APP_WEBHOOK_SECRET`

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

project_linked_repos
  project_id
  repo_full_name
  role                     -- primary | sub
```

Projects reference one installation. Linked repos must be a subset of
`github_installation_repos` for that installation.

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
| GET | `/api/github/installations` | session | List installations visible to instance |
| GET | `/api/github/installations/:id/repos` | session | Repos granted on an installation |
| POST | `/api/webhooks/github` | signature | Installation lifecycle webhooks |

Project CRUD endpoints accept `installation_id` + repo selection — see project API when
implemented.

## Related docs

- Identity OAuth: [`authentication.md`](authentication.md)
- Job dispatch: [`job-dispatch.md`](job-dispatch.md)
- Project settings / repos: [`project-settings.md`](project-settings.md)
- Glossary: [`../CONTEXT.md`](../CONTEXT.md)

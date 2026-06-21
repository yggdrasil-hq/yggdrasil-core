# Convention: Docker deploy layout

**Read this when:** adding or changing Dockerfiles, compose files, or nginx routing
for the suite or a submodule.
**Skip if:** you only need to run the stack — see [`../../deploy/README.md`](../../deploy/README.md).

> Status: DRAFT — boilerplate scaffolded; preview upstream registration and agent
> chat routing are not implemented yet.

## Layout

| Location | Purpose |
|----------|---------|
| `deploy/` (meta repo) | Full-stack `docker-compose.dev.yml` / `docker-compose.prod.yml`, nginx, `deploy/.env.example` |
| `<submodule>/deploy/` | `Dockerfile.dev`, `Dockerfile.prod`, `Dockerfile.test` per service |
| `<submodule>/docker-compose.test.yml` | **api, web, orchestrator only** — CI integration tests |

Root compose **builds inline** from submodule contexts (`../api`, `../web`, …).

## Runtimes

| Repo | Stack | Base image |
|------|-------|------------|
| api | Express + TypeScript | `node:22-bookworm-slim` |
| web | Next.js | `node:22-bookworm-slim` |
| landing | Next.js | `node:22-bookworm-slim` |
| docusaurus | Docusaurus 3 | `node:22-bookworm-slim` |
| orchestrator | Go | `golang:1.23-bookworm` / distroless prod |

Use official multi-arch images; build natively on each machine. Add `buildx` manifest
publishing in CI when a registry is introduced.

## Dev routing (path-based, port `8080`)

| Path | Service |
|------|---------|
| `/` | landing |
| `/app` | web (`NEXT_PUBLIC_BASE_PATH=/app`) |
| `/docs` | docusaurus (`DOCS_BASE_URL=/docs/`) |
| `/api` | api |
| `/orchestrator` | orchestrator |
| `/preview/<run-id>/` | agent containers (stub) |

## Prod routing (env-driven subdomains)

Set `LANDING_HOST`, `APP_HOST`, `DOCS_HOST`, `API_HOST`, `ORCHESTRATOR_HOST`, `PREVIEW_HOST`
in `deploy/.env`. TLS is **terminated upstream**; nginx trusts `X-Forwarded-*`.

## Data stores (dev + self-hosted prod)

- **PostgreSQL** — primary relational DB (API)
- **MinIO** — S3-compatible object storage (artefacts)

## Orchestrator

Dev and self-hosted prod mount `/var/run/docker.sock` so the orchestrator can spawn
agent containers on the host daemon.

## Environment files

Run `./setup.sh` from the meta repo root to copy each `.env.example` → `.env`
(skips existing files).

- **Meta:** `deploy/.env` — infra + cross-service URLs (auto-loaded by compose)
- **Submodules:** `.env` — app-specific vars; root compose passes infra URLs via
  `env_file` and `environment`

## Dev hot reload

Bind-mount source; named volumes for `node_modules` (Node) and Go module cache.

## Open / TODO

- Dynamic nginx upstream registration for `/preview/` and `*.preview.*`
- Agent chat wire path (API vs orchestrator subdomain vs direct container) — see
  [`../roadmap/open-questions.md`](../roadmap/open-questions.md)

# Convention: Docker deploy layout

**Read this when:** adding or changing Dockerfiles, compose files, or nginx routing
for the suite or a submodule.
**Skip if:** you only need to run the stack — see [`../../deploy/README.md`](../../deploy/README.md).

> Status: DRAFT — boilerplate scaffolded; agent chat routing is not implemented
> yet. Project hosting (primary/temporary deployments) targets Kubernetes, not
> this Docker Compose stack — see ADR 003 (`../adr/003-orchestrator-kubernetes.md`)
> and the "Kubernetes cluster" section below.

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
| orchestrator | Go | `golang:1.26-bookworm` / distroless prod |

Use official multi-arch images; build natively on each machine.

Note: this table covers **Yggdrasil's own control-plane services**
(web/api/landing/docusaurus/orchestrator), which run via this Compose stack.
Customer **projects** hosted by the Orchestrator are built from a Dockerfile
per linked repo and run in Kubernetes, not here — see ADR 003.

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

- **PostgreSQL** — primary relational DB (API); also backs the Orchestrator's
  job/deploy queue (ADR 003 — no separate broker)
- **MinIO** — S3-compatible object storage (artefacts)

## Orchestrator

The Orchestrator no longer talks to a local Docker socket. Per ADR 003
(`../adr/003-orchestrator-kubernetes.md`), it targets **one Kubernetes cluster**:

- **Self-hosted:** a bundled **k3s** cluster by default (started alongside the
  Compose stack), or an existing cluster the operator points it at via
  kubeconfig.
- **Managed:** Yggdrasil's own shared multi-tenant cluster.

The Orchestrator's own process still runs as a container in this Compose stack
(or the managed equivalent) — it's the *target* cluster it manages, not the
cluster it runs in, that changed.

## Kubernetes cluster (project hosting)

Per-project workloads (ephemeral job runs and each project's always-on primary
deployment) live in the target cluster, one **namespace per project**:

- **Ingress:** in-cluster ingress-nginx (or Traefik) + cert-manager with a
  wildcard Let's Encrypt certificate.
- **URL scheme:** primary deployments at `<project-slug>.apps.<domain>`;
  temporary deployments (test runs, grill sessions, dev previews) at
  `<project-slug>-<kind>-<id>.preview.<domain>`. This is a separate ingress
  layer from the nginx routing described above, which only handles
  Yggdrasil's own control-plane services.
- **Registry:** a bundled `registry:2`-style registry for self-hosted; a
  Yggdrasil-operated, per-project-namespaced registry for managed.
- **Isolation:** namespace-per-project + a sandboxed RuntimeClass (gVisor/Kata)
  by default on job/deployment pods.
- **Resource limits:** per-namespace `ResourceQuota`/`LimitRange`, plus a
  concurrency cap on simultaneous temporary deployments per project (default:
  3) — requests beyond the cap queue.

Full rationale and trade-offs: ADR 003 (`../adr/003-orchestrator-kubernetes.md`).

## Environment files

Run `./setup.sh` from the meta repo root to copy each `.env.example` → `.env`
(skips existing files).

- **Meta:** `deploy/.env` — infra + cross-service URLs (auto-loaded by compose)
- **Submodules:** `.env` — app-specific vars; root compose passes infra URLs via
  `env_file` and `environment`

## Dev hot reload

Bind-mount source; named volumes for `node_modules` (Node) and Go module cache.

## Open / TODO

- Agent chat wire path (API vs orchestrator subdomain vs direct container) — see
  [`../roadmap/open-questions.md`](../roadmap/open-questions.md)
- Primary deployment migration/rollback safety net (open question #9)
- Multi-cluster credential routing for bring-your-own-cluster inside managed
  SaaS (open question #10)

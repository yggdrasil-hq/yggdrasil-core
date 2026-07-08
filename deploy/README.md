# Deploy — local full stack

**Read this when:** running the whole Yggdrasil suite locally or on a self-hosted
single-node prod machine.

## Prerequisites

- Docker Engine + Docker Compose v2
- Submodules checked out (`git clone --recurse-submodules`)
- A reachable Kubernetes cluster for the Orchestrator (ADR 003) — dev uses a
  local `k3d` cluster; see `../orchestrator/docs/overview/setup.md` for the
  one-time setup. Without it, the `orchestrator` service fails to start
  (`deploy/.kube/config-container` won't exist to mount).

## Setup

From the meta repo root:

```bash
./setup.sh
```

This copies each `.env.example` to `.env` (skips files that already exist).

## Dev (path-based routing)

```bash
docker compose -f deploy/docker-compose.dev.yml up --build
```

Open http://localhost:8080

| Path | Service |
|------|---------|
| `/` | Landing |
| `/app` | Web app |
| `/docs` | User docs (Docusaurus) |
| `/api` | API |
| `/orchestrator` | Orchestrator |
| `/preview/<run-id>/` | Agent previews (stub until orchestrator registers upstreams) |

## Prod (env-driven subdomains)

TLS is terminated **upstream** (CDN / load balancer). Nginx listens on HTTP and
trusts `X-Forwarded-*` headers.

```bash
# Edit deploy/.env — set LANDING_HOST, APP_HOST, DOCS_HOST, API_HOST,
# ORCHESTRATOR_HOST, PREVIEW_HOST
docker compose -f deploy/docker-compose.prod.yml up --build -d
```

## Docs

Full conventions: [`../docs/conventions/deploy.md`](../docs/conventions/deploy.md)

# Deploy — local full stack

**Read this when:** running the whole Yggdrasil suite locally or on a self-hosted
single-node prod machine.

## Prerequisites

- Docker Engine + Docker Compose v2
- Submodules checked out (`git clone --recurse-submodules`)

The Orchestrator targets Kubernetes, not a Docker socket (ADR 003). Dev compose
(below) bundles a disposable single-node k3s cluster for this automatically —
no separate cluster setup needed. See `../orchestrator/docs/overview/setup.md`
for the cert-manager step (still manual) and how to point at your own cluster
instead.

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

The Kubernetes dashboard (Headlamp) isn't routed through nginx — open it
directly at http://localhost:4466 to inspect pods/logs/events on the bundled
dev k3s cluster.

## Prod (env-driven subdomains)

TLS is terminated **upstream** (CDN / load balancer). Nginx listens on HTTP and
trusts `X-Forwarded-*` headers.

```bash
# Edit deploy/.env — set LANDING_HOST, APP_HOST, DOCS_HOST, API_HOST,
# ORCHESTRATOR_HOST, PREVIEW_HOST
docker compose -f deploy/docker-compose.prod.yml up --build -d
```

## Self-hosting without cloning submodules

`docker-compose.prod.yml` above builds each service from a checked-out
submodule. If you'd rather pull prebuilt images (published to `ghcr.io` by
each service's CI on every push to `main`) instead of building from source,
see the "Self-hosting from published images" section in
[`../docs/conventions/deploy.md`](../docs/conventions/deploy.md#self-hosting-from-published-images-ghcrio)
for image names, required env vars, ports, and a starter compose snippet.

## Docs

Full conventions: [`../docs/conventions/deploy.md`](../docs/conventions/deploy.md)

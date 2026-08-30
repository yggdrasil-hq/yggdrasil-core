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

The Orchestrator no longer talks to a local Docker socket. Per ADR 003 it
targets Kubernetes for job execution and project hosting, and per ADR 016
(`../adr/016-organization-rbac-and-cluster-routing.md`) there is **no
per-instance default cluster**: every Organization configures its own cluster
(kubeconfig stored encrypted in the API's database), and the Orchestrator
resolves each job's target cluster dynamically via its
project → organization (ADR 016 item 13). There is no bundled k3s and no
mounted `KUBECONFIG_HOST_PATH` anymore.

The Orchestrator's own process still runs as a container in this Compose stack
(or the managed equivalent) — it's the per-org *target* clusters it manages,
not the cluster it runs in, that moved to dynamic resolution.

## Kubernetes cluster (project hosting)

Per-project workloads (ephemeral job runs and each project's always-on primary
deployment) live in the target cluster, one **namespace per project**:

- **Ingress:** in-cluster ingress-nginx (or Traefik) + cert-manager with a
  wildcard Let's Encrypt certificate. Local dev uses `k3d`'s bundled
  **Traefik** and a `selfSigned` `ClusterIssuer` (no real domain/reachable
  IP available locally for real ACME) — see
  `../../orchestrator/docs/overview/setup.md`. The Orchestrator's ingress
  class and cert issuer are env-configurable
  (`INGRESS_CLASS_NAME`/`CERT_ISSUER_NAME`), so a self-hosted/managed
  install swaps in ingress-nginx + a real ACME `ClusterIssuer` via config,
  not code.
- **URL scheme:** primary deployments at `<project-slug>.apps.<domain>`;
  temporary deployments (test runs, grill sessions, dev previews) at
  `<project-slug>-<kind>-<id>.preview.<domain>`. This is a separate ingress
  layer from the nginx routing described above, which only handles
  Yggdrasil's own control-plane services.
  - `<domain>` is `APPS_BASE_DOMAIN`, set **independently** on both the
    Orchestrator (builds the real k8s Ingress host) and the API
    (`config.appsBaseDomain`, hands the Web app a link to it via `GET
    /:projectId/deploy`, ADR 013 addendum) — keep the two in sync by hand;
    there's no runtime dependency between the two services for this.
  - **Local dev:** neither the domain nor the ingress port is reachable out
    of the box — `APPS_BASE_DOMAIN`'s placeholder default (`yggdrasil.local`)
    resolves nowhere, and nothing publishes the locally-configured cluster's
    Traefik ingress to the host by default. See
    `../../orchestrator/docs/overview/setup.md`'s "Reaching a project's
    deployment locally" for the full recipe (nip.io wildcard DNS +
    `DEV_APPS_HTTP_PORT`/`DEV_APPS_HTTPS_PORT`/`APPS_HTTPS_PORT`).
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

## Self-hosting from published images (ghcr.io)

Every control-plane service's CI (`.github/workflows/build-and-push.yml`,
per-repo) builds `deploy/Dockerfile.prod` and pushes it to GHCR on every push
to `main`. A self-hoster can run these images directly instead of cloning the
submodules and building `docker-compose.prod.yml` from source.

| Service | Image | Container port | Notes |
|---------|-------|-----------------|-------|
| web | `ghcr.io/yggdrasil-hq/yggdrasil-web` | `3000` | Next.js standalone server |
| api | `ghcr.io/yggdrasil-hq/yggdrasil-api` | `3000` | needs Postgres + S3-compatible storage |
| orchestrator | `ghcr.io/yggdrasil-hq/yggdrasil-orchestrator` | `8080` | needs a `KUBECONFIG` for its target cluster (ADR 003) |
| landing | `ghcr.io/yggdrasil-hq/yggdrasil-landing` | `3000` | no app-specific config |
| docusaurus | `ghcr.io/yggdrasil-hq/yggdrasil-docusaurus` | `3000` | static docs site behind `serve` |

Tags: `latest` (most recent `main` build) or `sha-<8-char-commit-sha>` (pin to
a specific build). No `vX.Y.Z` release tags exist yet.

**GHCR packages default to private.** Until the images are made public,
pulling them needs a GitHub PAT with `read:packages` scope:

```bash
echo "$GHCR_PAT" | docker login ghcr.io -u <github-username> --password-stdin
```

### Required configuration per image

Env vars below are the ones each service actually reads at runtime (see each
submodule's `.env.example` for the full, commented list):

- **api** — `PORT`, `DATABASE_URL` (Postgres), `S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET`/`S3_REGION`, `SESSION_SECRET`,
  `APP_PUBLIC_URL`/`API_PUBLIC_URL`, `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` (sign-in, ADR 009 — required),
  `SECRETS_ENCRYPTION_KEY` (32-byte base64, `openssl rand -base64 32`), `INTERNAL_API_TOKEN` (shared with orchestrator),
  `APPS_BASE_DOMAIN` (must match the orchestrator's value exactly).
- **web** — `NEXT_PUBLIC_API_BASE_URL` (browser-facing API path/URL), `API_INTERNAL_URL` (server-side, reaches `api` directly), `NEXT_PUBLIC_BASE_PATH` (empty for a subdomain deploy).
- **orchestrator** — `PORT`, `DATABASE_URL` (same Postgres as api, shared `jobs` table), `KUBECONFIG` (unset to use in-cluster config), `API_INTERNAL_URL`/`INTERNAL_API_TOKEN` (shared with api), `APPS_BASE_DOMAIN`/`INGRESS_CLASS_NAME`/`CERT_ISSUER_NAME`, and the per-job-kind images (`SPEC_GRILL_IMAGE`/`FEATURE_BUILD_IMAGE`/`TEST_RUN_IMAGE`/`DESIGN_GRILL_IMAGE`, from `ghcr.io/yggdrasil-hq/yggdrasil-agent-images` — also private by default, so the target cluster needs an `imagePullSecret` too).
- **landing** — none.
- **docusaurus** — `DOCS_BASE_URL` (`/` for a subdomain deploy), `DOCS_SITE_URL`.

### Minimal compose snippet (images only, no build context)

```yaml
services:
  api:
    image: ghcr.io/yggdrasil-hq/yggdrasil-api:latest
    environment:
      PORT: "3000"
      DATABASE_URL: postgresql://user:pass@postgres:5432/yggdrasil
      S3_ENDPOINT: http://minio:9000
      S3_ACCESS_KEY: minioadmin
      S3_SECRET_KEY: change-me
      S3_BUCKET: yggdrasil
      S3_REGION: us-east-1
      SESSION_SECRET: change-me
      APP_PUBLIC_URL: https://app.example.com
      API_PUBLIC_URL: https://api.example.com
      GITHUB_CLIENT_ID: ${GITHUB_CLIENT_ID}
      GITHUB_CLIENT_SECRET: ${GITHUB_CLIENT_SECRET}
      SECRETS_ENCRYPTION_KEY: ${SECRETS_ENCRYPTION_KEY}
      INTERNAL_API_TOKEN: ${INTERNAL_API_TOKEN}
      APPS_BASE_DOMAIN: apps.example.com
    ports:
      - "3001:3000"

  web:
    image: ghcr.io/yggdrasil-hq/yggdrasil-web:latest
    environment:
      NEXT_PUBLIC_API_BASE_URL: https://api.example.com
      API_INTERNAL_URL: http://api:3000
      NEXT_PUBLIC_BASE_PATH: ""
    ports:
      - "3000:3000"

  landing:
    image: ghcr.io/yggdrasil-hq/yggdrasil-landing:latest
    ports:
      - "3002:3000"

  docusaurus:
    image: ghcr.io/yggdrasil-hq/yggdrasil-docusaurus:latest
    environment:
      DOCS_BASE_URL: "/"
      DOCS_SITE_URL: https://docs.example.com
    ports:
      - "3003:3000"

  orchestrator:
    image: ghcr.io/yggdrasil-hq/yggdrasil-orchestrator:latest
    environment:
      DATABASE_URL: postgresql://user:pass@postgres:5432/yggdrasil
      API_INTERNAL_URL: http://api:3000
      INTERNAL_API_TOKEN: ${INTERNAL_API_TOKEN}
      APPS_BASE_DOMAIN: apps.example.com
    volumes:
      - ~/.kube/config:/root/.kube/config:ro
    ports:
      - "8080:8080"
```

This is a starting point, not a drop-in replacement for
`docker-compose.prod.yml` — it omits nginx/TLS termination, Postgres/MinIO
themselves, and the bundled/target Kubernetes cluster the orchestrator needs
(see "Kubernetes cluster" above). Front it with your own reverse proxy/TLS and
point `*_PUBLIC_URL` at the real public hostnames.

## Dev hot reload

Bind-mount source; named volumes for `node_modules` (Node), Go module cache,
and each app's framework build-output dir (`.next` for web/landing,
`.docusaurus`/`build` for docusaurus). The build-output dirs need their own
volumes too, not just `node_modules` — dev containers run as root, and
without a volume there the framework's dev/build process writes those dirs
straight onto the bind-mounted host source tree, leaving them root-owned and
breaking host-side builds/`rm` until manually chowned.

## Open / TODO

- Agent chat wire path (API vs orchestrator subdomain vs direct container) — see
  [`../roadmap/open-questions.md`](../roadmap/open-questions.md)
- Primary deployment migration/rollback safety net (open question #9)
- Multi-cluster credential routing for bring-your-own-cluster inside managed
  SaaS (open question #10)

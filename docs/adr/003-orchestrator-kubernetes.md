# ADR 003: Orchestrator compute — Kubernetes-based job execution and project hosting

**Status:** Accepted (cluster-targeting section superseded by ADR 016)
**Date:** 2026-07-08 (cluster targeting superseded 2026-08-30 by ADR 016)
**Deciders:** Product/design session (grill-me)

> **Superseded:** "Compute substrate" item 3-4 below (bundled-k3s-by-default
> auto-selection, one cluster per Orchestrator instance via the
> `KUBECONFIG_HOST_PATH` env var) is superseded by
> [ADR 016](016-organization-rbac-and-cluster-routing.md) — decided, **not
> yet built**. The env var and instance-wide default are removed outright;
> every Organization must explicitly configure its own cluster before
> creating any project, with no platform-default fallback. Everything else
> in this ADR (namespace-per-project isolation, sandboxed RuntimeClass,
> primary/temporary deployment model, Helm/Dockerfile build contract, job
> dispatch transport) is unaffected.

## Context

Phase 1 requires "basic Pi integration in the Orchestrator" (`roadmap/phases.md`),
but the Orchestrator's compute substrate was never decided. Prior state:

- `conventions/deploy.md` (DRAFT) assumed a single Docker host: the Orchestrator
  mounts `/var/run/docker.sock` and spawns agent containers on the local daemon.
- `components/orchestrator.md` documented the Orchestrator as **stateless between
  runs** — receives a job spec, executes in an ephemeral container, reports back,
  owns no durable state.
- Four open questions blocked a concrete design: #1 (self-hosted vs. managed
  compute), #4 (secure env var injection), #6 (container resource limits / cost
  visibility), #8 (dynamic preview upstream registration).
- `concepts/job-dispatch.md` left the API→Orchestrator transport an open TODO
  (queue? HTTP? gRPC?).
- ADR 002 already established that a project clones a **primary repository**
  plus **linked sub-repositories** on every job, but said nothing about *hosting*
  a project's actual running application — only ephemeral build/test containers.

This ADR both picks Kubernetes over plain Docker as the compute substrate, and
resolves the design questions that decision immediately raises.

Constraints:

- Product targets small teams (2–10), self-hosted by default (`overview/product.md`),
  but the business also wants a Yggdrasil-operated managed offering from the start.
- Whatever we choose must not raise the self-hosted onboarding bar far above
  today's `docker compose up` (`deploy/README.md`).
- The Orchestrator's "stateless" property (ADR-adjacent, `components/orchestrator.md`)
  needs to be preserved in spirit even though this ADR gives projects real,
  persistent, stateful hosted deployments.

## Decision

### Compute substrate

1. The Orchestrator targets **Kubernetes**, not a raw Docker socket, for all job
   execution and project hosting.
2. Both **self-hosted** and **managed** (Yggdrasil-operated) deployment models
   are supported — this resolves Open Question #1.
3. Self-hosted installs default to a **bundled lightweight distro (k3s)** so
   setup stays close to today's single-command experience. Either deployment
   model may instead point the Orchestrator at an existing cluster via
   kubeconfig, for teams that already run one.
4. **One target Kubernetes cluster per Orchestrator instance** for MVP. No
   multi-cluster credential routing (e.g. an enterprise bringing its own
   cluster while using hosted SaaS) yet — see Follow-ups.

### Tenant & project isolation

5. **Namespace-per-project** is the isolation unit — not per-tenant/org, not
   per-repo-within-a-project. A project's namespace holds its primary
   deployment plus any of its currently-active temporary deployments.
6. Job and deployment pods default to a **sandboxed container RuntimeClass**
   (gVisor or Kata), applied universally as defense in depth — pods run
   AI-agent-directed code holding a live scoped GitHub token and, for primary
   deployments, real project secrets.
7. **Dedicated node pools per tenant** are out of scope for MVP; reserved as a
   possible future paid isolation tier.

### Orchestrator scope

8. The Orchestrator's Kubernetes footprint stays scoped to **per-project
   resources**: Jobs/Pods for ephemeral runs; Deployments, Services, Ingress,
   Secrets, and PVCs for project hosting. It does **not** take on cluster-wide
   day-2 operations (Postgres/MinIO backups, cluster disaster recovery) —
   those remain separate, ops-owned concerns (e.g. a `pg_dump` CronJob,
   Velero). This preserves "no durable *platform* state" even though the
   Orchestrator now manages durable *project* state.

### Deployments: primary vs. temporary

9. Each project gets exactly one **always-on primary deployment** — a
   persistent, stateful workload tracking `main`, holding the project's real
   application data (database, volumes).
10. Ephemeral **temporary deployments** back `spec_grill` (grill sessions),
    `feature_build` (dev/preview), and `test_run` jobs — created per-run,
    torn down after, with no persistent state of their own. This is unchanged
    from ADR 002's ephemeral-preview model for these job kinds.
11. The primary deployment **auto-redeploys whenever a PR merges to the
    primary repo's `main` branch**. There is **no migration/rollback safety
    net for MVP** — this is an explicit, temporary risk acceptance in service
    of shipping faster; see Follow-ups.

### Build & runtime contract

12. A project's **core (primary) repository maintains a Helm chart** describing
    its deployment topology; each **linked sub-repository provides its own
    Dockerfile** for image builds. The chart is scaffolded from a strict,
    Yggdrasil-defined template during `project_init` (ADR 002) — not
    hand-authored by the project team. (Project teams here mostly means the Pi
    agent, not a human, so the chart's rigidity is a feature, not friction.)
13. The Orchestrator applies charts **imperatively** — it calls Helm (via its
    Go SDK) directly against the target cluster at deploy time. No GitOps
    controller (ArgoCD/Flux) for MVP.

### Images & registry

14. Self-hosted installs run a **bundled registry** (e.g. `registry:2`)
    alongside the bundled k3s cluster. The managed deployment runs a
    **Yggdrasil-operated registry**, namespaced per project with per-namespace
    pull secrets. No dependency on public registries (Docker Hub) as a hard
    requirement.

### Networking

15. An in-cluster **ingress controller** (ingress-nginx or Traefik) plus
    **cert-manager** with a wildcard Let's Encrypt certificate handle all
    project traffic. URL scheme: primary deployments at
    `<project-slug>.apps.<domain>`; temporary deployments at
    `<project-slug>-<kind>-<id>.preview.<domain>`. This is a **separate**
    ingress layer from the meta-repo's own Compose-based nginx, which
    continues to route only Yggdrasil's own control-plane services
    (web/api/landing/docusaurus). This resolves Open Question #8.

### Secrets

16. Project-level env vars/secrets are stored **envelope-encrypted at rest in
    the API's PostgreSQL**, decrypted only in-memory by the API when building
    a job/deploy spec, and pushed by the Orchestrator directly into a
    per-namespace Kubernetes `Secret` object at deploy time. No third-party
    secrets manager (Vault, etc.) for MVP. This resolves Open Question #4.

### Resource limits & scheduling

17. Each project namespace gets a `ResourceQuota`/`LimitRange` sized for
    (primary deployment + a small fixed number of temporary-deployment slots),
    plus a hard **concurrency cap on simultaneous temporary deployments per
    project** (initial default: 3). Requests beyond the cap **queue** rather
    than reject — consistent with ADR 002's existing "skip if a previous
    `test_run` is still active" precedent, generalized to all temporary
    deployment kinds. This resolves Open Question #6.

### Job queue & transport

18. API→Orchestrator job dispatch uses a **Postgres-backed durable queue**
    (e.g. Go's `river` library, or a hand-rolled `SELECT ... FOR UPDATE SKIP
    LOCKED` pattern) — not a dedicated broker (Kafka/RabbitMQ). This resolves
    the transport TODO in `concepts/job-dispatch.md`. Postgres is already a
    hard dependency; job volumes (minutes-long container/pod lifecycles, not
    high-frequency small messages) are comfortably within what a
    Postgres-backed queue handles.

### Orchestrator service architecture

19. The Orchestrator remains a **single deployable service** for MVP,
    internally structured with clear module boundaries (queue-consumer/
    admission, job-executor, deploy-manager) rather than split into multiple
    independently-deployed services. Splitting is deferred until there's
    concrete evidence (load, blast-radius incidents) that justifies the
    operational cost of more services — this is intentionally a "modular
    monolith."
20. The Orchestrator runs as **multiple replicas (default 2)** from the start,
    for basic dispatch availability. This costs nothing extra to support: the
    Postgres queue's concurrent-consumer pattern (`SKIP LOCKED`) is safe with N
    consumers with no additional coordination work.

## Consequences

### Positive

- One compute model (Kubernetes) serves both ephemeral CI-like jobs and
  long-lived hosted app deployments, instead of needing two substrates.
- Namespace-per-project + a sandboxed RuntimeClass gives real isolation with a
  small operational surface — no dedicated node pools to manage yet.
- Reusing Postgres for the job queue and standard Kubernetes/Helm/cert-manager
  primitives for hosting means no new *categories* of infrastructure beyond
  what's already committed to (Postgres, MinIO, containers) — everything else
  is well-understood glue on top of that.
- Wildcard DNS + cert-manager resolves the long-standing `/preview/<run-id>/`
  stub in `deploy.md`/`deploy/README.md` with no per-deployment DNS/cert work.
- A modular-monolith Orchestrator keeps the self-hosted bundle to one
  additional service, not several.

### Negative / trade-offs

- **No migration safety net for primary deployment auto-deploys** — a bad
  migration against real project data on merge to `main` has no automatic
  rollback yet. Accepted explicitly to ship an MVP faster.
- **Helm + Dockerfile is a real authoring surface**, even generated from a
  strict template — a project whose topology doesn't fit the template's
  assumptions may need manual intervention.
- **Sandboxed runtime (gVisor/Kata) adds latency/compatibility overhead** to
  every job and deployment pod, applied as a blanket policy rather than a
  risk-scored one.
- **Bundled k3s + bundled registry** means self-hosted installs now run
  meaningfully more infrastructure than the Docker-socket-only design
  previously drafted in `deploy.md` — a heavier self-hosted footprint than
  originally scoped.
- ~~**One target cluster per Orchestrator instance** means "bring your own
  cluster while using hosted SaaS" isn't supported yet.~~ Resolved by
  [ADR 016](016-organization-rbac-and-cluster-routing.md) (per-org cluster
  config, no instance-wide default) — decided, not yet built.
- **Single Orchestrator service** conflates ephemeral job execution and
  persistent deploy management in one codebase; if one grows disproportionately
  relative to the other, the internal module boundaries will need to become
  real service boundaries.

### Follow-ups (out of scope for this ADR)

- Migration/rollback safety net for primary deployment deploys — likely a
  staging branch + staging deployment gate before promoting to primary. Not
  yet designed; tracked as a new open question.
- ~~Multi-cluster credential routing for bring-your-own-cluster inside the
  managed SaaS offering.~~ Resolved by
  [ADR 016](016-organization-rbac-and-cluster-routing.md) (2026-08-30) —
  decided, not yet built.
- Cluster/node-pool autoscaling strategy for bursty ephemeral job load.
- Dedicated node pools as a paid isolation tier.
- Buildpack/manifest-based auto-detection as an alternative to
  Dockerfile-required, if real projects need it.
- GitOps (ArgoCD/Flux) if imperative Helm deploys prove insufficient for audit/
  rollback needs.
- Extracting the job-executor and deploy-manager into independent services, if
  load or blast-radius evidence justifies it.
- Exact Kubernetes object shapes generated per job kind (Job vs. bare Pod for
  `spec_grill` / `feature_build` / `test_run`).
- Open Question #7 (agent chat wire path) is **not** resolved by this ADR —
  ingress/URL scheme is decided, but how live agent chat/steering reaches a
  running Pi process is still open.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Raw Docker socket (single host), as previously drafted in `deploy.md` | Doesn't scale past one node; no answer for multi-node managed SaaS or per-project persistent hosting with real ingress/secrets/volumes |
| Self-hosted requires customer's own existing cluster (no bundling) | Raises self-hosted onboarding bar far above today's `docker compose up`, likely excluding the stated 2–10 person team audience |
| Plain namespace isolation only, no sandboxed runtime | Cheap, but leaves container-escape as a live risk against pods holding scoped GitHub tokens and project secrets |
| Dedicated node pools per tenant from day one | Real isolation upgrade, but cost/complexity not justified before there's a paying multi-tenant customer base |
| `docker-compose.yml` as the project hosting manifest, translated to Kubernetes (Kompose-style) | Compose-to-Kubernetes translation is lossy beyond a small feature subset; Helm chosen instead since Kubernetes is the actual runtime |
| GitOps (ArgoCD/Flux) for deploys | Extra moving part (controller + repo/webhook wiring) not justified before MVP; imperative Helm calls are simpler and sufficient |
| Kafka / RabbitMQ for job dispatch | Built for high-throughput streaming/fan-out; job volume here (minutes-long container lifecycles) doesn't need it, and it's a new stateful service to bundle/operate everywhere |
| Split Orchestrator into job-runner + deploy-manager services now | No current scaling-pressure evidence justifies the operational cost of multiple services, especially for self-hosted bundling |
| Single Orchestrator replica | Simpler to reason about, but leaves zero margin for a crash/bad-deploy stalling the pipeline that now manages every project's live production deployment |
| Full migration safety net (pre-deploy dry-run + auto-rollback) from day one | Explicit "keep it simple for MVP" trade — deferred to a future staging-deployment gate |

Implementation reference: `docs/components/orchestrator.md`, `orchestrator/CLAUDE.md`,
`docs/conventions/deploy.md`, `docs/concepts/job-dispatch.md`.

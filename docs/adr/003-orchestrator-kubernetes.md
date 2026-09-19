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
11a. **Whether the primary deployment should also run a *built* image rather
    than its chart's declared one is open**, and it is the same chart-convention
    question as §12's multi-repository images — one image slot per repository in
    the chart — asked from the other direction (issue #55).

### Build & runtime contract

12. A project's **core (primary) repository maintains a Helm chart** describing
    its deployment topology; each **linked sub-repository provides its own
    Dockerfile** for image builds. The chart is scaffolded from a strict,
    Yggdrasil-defined template during `project_init` (ADR 002) — not
    hand-authored by the project team. (Project teams here mostly means the Pi
    agent, not a human, so the chart's rigidity is a feature, not friction.)

    **Amended (issues #69/#71): the build runs as an ordinary in-cluster Job with
    two containers of deliberately different capability** — a *context* container
    whose image has a shell (it clones, and it decides the two skip cases), and a
    shell-**less** executor container driven through the builder's own CLI. That
    split is load-bearing rather than incidental: any guard that needs a shell
    belongs in the former, and issue #69 is exactly what happens when one is put
    in the latter. See §14 for why the executor image has no shell at all.
13. The Orchestrator applies charts **imperatively** — it calls Helm (via its
    Go SDK) directly against the target cluster at deploy time. No GitOps
    controller (ArgoCD/Flux) for MVP.

### Images & registry

14. Self-hosted installs run a **bundled registry** (e.g. `registry:2`)
    alongside the bundled k3s cluster. The managed deployment runs a
    **Yggdrasil-operated registry**, namespaced per project with per-namespace
    pull secrets. No dependency on public registries (Docker Hub) as a hard
    requirement.

    **Amended (2026-09-19, issue #19): the bundled registry is optional
    configuration, not an assumption.** It is described above as part of the
    self-hosted install, but nothing in the product depended on that statement
    until a build step existed, and one does now. So the honest position is:
    the Orchestrator builds a preview's image **only when `IMAGE_REGISTRY` is
    set**. Unset means no build is attempted and a preview keeps its chart's
    declared image, which makes an install without a registry *unchanged*
    rather than broken — the state every existing install is in.

    **The build is best-effort by design.** Two cases are *skips* rather than
    failures, because failing the job for either would be reporting a problem
    the operator cannot act on:

    - a repository with **no Dockerfile at §12's contract path**;
    - a **ref that is not on the remote yet** — the ordinary case, not an edge
      one: a preview is created when a job *starts* (§10), while a
      `feature_build`'s branch is pushed only when the agent *finishes*. On a
      feature's first build the branch genuinely does not exist remotely, and
      treating that as a failure would replace a working preview with a
      failed-looking one for the whole of the first run.
    - a **repository with no Dockerfile** at §12's contract path.

    Both skips are decided in the clone init container, which is the one place in
    the build that has a shell — see the §14 amendment below for why that
    matters.

    Both fall back to the chart's image with the reason logged, and no failure
    path in the build can fail the job — the posture `startJobPreview` already
    takes.

    **Only the primary repository is built today.** §12 says each linked
    sub-repository provides its own Dockerfile; that half needs a chart
    convention for per-repository image slots, which does not exist and which
    §14's "one image" shape cannot express. Tracked as issue #55, with the four
    sub-questions (which values key, precedence against the primary's image,
    re-scaffolding when repositories are linked later, and which repositories
    are buildable at all).

    **The ref a build takes is a branch or a tag, not a commit.** The clone is
    shallow and single-ref (`--depth 1 --branch`), which a bare SHA cannot
    express; a ref that is neither is a skip rather than an opaque failure. A
    full-SHA build would need an unshallow fetch, and nothing needs one yet.

    Images land at `<registry>/proj-<project-id>/<repo>:<sanitised-ref>` —
    **keyed on the project id rather than the slug**, so renaming a project
    cannot orphan its images, matching the `proj-<id>` namespace naming used
    everywhere else.

    **Amended again (issue #69): the build container is invoked through the
    builder's own CLI, never through a shell.** The first implementation wrapped
    Kaniko in `sh -c`, and the Kaniko executor image is **distroless** — it has no
    shell at all — so *every* build failed at container start with
    `exec: "sh": executable file not found in $PATH`. It was not a subtle failure
    to diagnose once seen, but nothing had asserted the container could start, so
    the pipeline merged and appeared complete.

    The rule this leaves behind, for any future builder image: **check that the
    image has the interpreter you are invoking before wrapping it in one.**
    Kaniko's own `--context`/`--dockerfile`/`--destination` arguments need no
    shell, and a check that does need one (whether the repository has a
    Dockerfile) belongs in a container whose image is known to have a shell —
    which is why it moved to the clone init container, where "this ref is not on
    the remote yet" is already answered the same way.

    **And again (issues #69/#71): the build path and the pull path have different
    requirements, and only the build path is satisfied by a bare `registry:2`.**

    A build *pushes* from userspace code inside a pod, so cluster DNS resolves the
    registry and go-containerregistry falls back to plain HTTP. A preview
    Deployment *pulls* through **containerd, which is a node daemon**: it resolves
    registry hostnames with the node's resolver — so
    `registry.<ns>.svc.cluster.local` resolves perfectly from inside a pod and not
    at all for the pull — and it will not fall back to HTTP, so a plain
    `registry:2` fails with `http: server gave HTTP response to HTTPS client`.
    Both were measured against the real cluster, not inferred.

    So the bundled registry above is necessary but **not sufficient**. An install
    must additionally either serve it over TLS with a CA the nodes trust, or list
    it as insecure in containerd's configuration (k3s:
    `/etc/rancher/k3s/registries.yaml`), **and** address it by a name the nodes can
    resolve. Which of those the product should do is open (issue #71). What is now
    established is the part that matters for anyone reading evidence: **"the image
    built" is not evidence that a preview can run it.**

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

    **Amended (issue #76): replicas are safe once running, but not while
    starting.** `runMigrations` reads the applied set and then applies what is
    missing — a check-then-act — so two replicas booting together both apply the
    same migration and the loser exits with `23505` on
    `schema_migrations_pkey`. Nothing about `SKIP LOCKED` prevents that; it is a
    startup race in a different subsystem.

    The consequence is specific and worth knowing during a rollout: an overlapping
    rollout can **silently lose a replica**, and the surviving one looks healthy.
    An advisory lock around the migration pass is the fix; until it lands, this is
    a real limitation of "run 2 replicas", not a theoretical one. It was found by
    building the two-replica harness for issue #32, which had to serialise replica
    startup to get past it.

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
  config, no instance-wide default) — implemented in Track A.
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
  implemented in Track A.
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

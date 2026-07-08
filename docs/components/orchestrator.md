# Component: Orchestrator

**Read this when:** you need a high-level orientation on the execution layer
before diving into the `orchestrator/` submodule.
**Authoritative source:** `orchestrator/CLAUDE.md` (the submodule). Bridge page —
keep short, link, don't duplicate.

- **Submodule path:** `orchestrator/`
- **GitHub repo:** `yggdrasil-hq/yggdrasil-orchestrator`
- **Status:** added
- **Compute substrate:** **Kubernetes** (one target cluster per Orchestrator
  instance — bundled k3s by default for self-hosted, or an existing cluster via
  kubeconfig). See ADR 003 (`docs/adr/003-orchestrator-kubernetes.md`).
- **Key property:** the Orchestrator process itself is stateless (no in-memory
  state between runs, in-process crash-safe) — but per ADR 003 it now manages
  durable **per-project** Kubernetes state (each project's always-on primary
  deployment). It still owns no durable *platform* state (that's the API's job).

## Responsibility

Two distinct workload shapes, both scoped to a project's own Kubernetes
namespace:

**Ephemeral job runs** (`spec_grill`, `feature_build`, `test_run` — ADR 002):

1. Provision an ephemeral Pod/Job in the project's namespace.
2. Inject the Pi coding agent (see `concepts/pi-agent.md`) and configured tools.
3. Clone the target GitHub repo(s) with a short-lived installation token.
4. Create a feature branch `yggdrasil/<feature-slug>-<id>` (for `feature_build`).
5. Open a draft PR immediately (for `feature_build`).
6. Run Pi in RPC/SDK mode, streaming all events back to the API.
7. Optionally stand up a **temporary deployment** with a preview URL.
8. Tear down the Pod/Job (and temporary deployment, if any) and archive
   artefacts when done.

**Primary deployment hosting** (ADR 003):

9. Maintain each project's always-on primary deployment via the project's Helm
   chart — `helm upgrade --install` imperatively, triggered on merge to `main`.
10. Manage the namespace's Ingress, `Secret`, and PVC objects backing that
    deployment.

## Talks to

- **API** — consumes job/deploy specs via a Postgres-backed queue, streams
  events/results back. See `concepts/job-dispatch.md`.
- **GitHub** — clone, branch, PR (using the injected installation token).
- **Kubernetes API** (target cluster) — Jobs/Pods, Deployments, Services,
  Ingress, Secrets, PVCs, all namespaced per project.
- **Container registry** — pushes built images (bundled registry for
  self-hosted, Yggdrasil-operated registry for managed).

## Deep docs (in the submodule, once added)

- `orchestrator/CLAUDE.md` — router for the orchestrator repo
- `orchestrator/docs/` — Kubernetes job/deploy lifecycle, Pi RPC integration,
  Helm chart contract, artefact archival, resource limits

See ADR 003 (`docs/adr/003-orchestrator-kubernetes.md`) for the full compute
design and its trade-offs/follow-ups.

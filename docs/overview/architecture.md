# Architecture — how the pieces fit

**Read this when:** you need to understand the runtime relationship between
Web, API, and Orchestrator, or the lifecycle of an agent run end-to-end.
**Skip if:** you only need to work inside one component's internals — go to that
component's own `CLAUDE.md`.

> Status: DRAFT — high-level shape is known; concrete protocols/contracts are
> not finalized. Flag assumptions rather than inventing wire formats.

## Component responsibilities

- **Web** — UI only. Talks to the API over REST (commands/queries) and
  WebSocket (live run events). Holds no source-of-truth state.
- **API** — source of truth. Owns the database, GitHub OAuth tokens, and the
  event stream. Decides *when* work runs and dispatches **job specs** to the
  Orchestrator. Relays Orchestrator events to the Web app.
- **Orchestrator** — stateless worker process. Receives job/deploy specs over a
  Postgres-backed queue, executes ephemeral runs in Kubernetes Pods/Jobs, and
  maintains each project's always-on primary deployment via Helm. The process
  itself keeps nothing in memory between runs, but per ADR 003
  (`adr/003-orchestrator-kubernetes.md`) it now manages durable *project* state
  that lives in the target Kubernetes cluster, not in the API's database.

## End-to-end flow (a feature being built)

```
User (Web)
   │  writes feature spec, hits "run"
   ▼
API
   │  persists feature, mints short-lived scoped GitHub token,
   │  builds a job spec, dispatches to Orchestrator
   ▼
Orchestrator
   │  provision container → inject Pi agent + tools
   │  clone repo (scoped token) → create branch yggdrasil/<slug>-<id>
   │  open draft PR → run Pi (RPC/SDK), stream events ──┐
   │  (optional) tunnel preview URL                     │
   │  teardown + archive artefacts                      │
   ▼                                                    │
API  ◀───────────── events (status, logs, PR) ──────┘
   │  persists state + artefact refs, relays events
   ▼
Web  (live updates over WebSocket; user can chat/steer mid-run)
```

See `concepts/job-dispatch.md` for the API→Orchestrator contract,
`concepts/pi-agent.md` for what runs inside the container, and
`concepts/feature-lifecycle.md` for the states a feature moves through.

## Storage

- **PostgreSQL** — primary relational state (API-owned).
- **Object storage** — logs, test reports, screen recordings, artefacts.

## Key boundaries (don't cross them)

- Web never talks to the Orchestrator directly — always via the API.
- The Orchestrator process persists no state itself — the API owns all
  control-plane state. Per-project *hosted application* state (a project's
  primary deployment) lives in the target Kubernetes cluster, which the
  Orchestrator manages but does not itself store data in — see ADR 003.
- GitHub tokens are minted by the API and injected short-lived into the
  Orchestrator's job Pods; they are never stored in the Web app.

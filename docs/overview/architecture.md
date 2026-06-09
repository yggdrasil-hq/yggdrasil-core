# Architecture — how the pieces fit

**Read this when:** you need to understand the runtime relationship between
Frontend, Backend, and Forge, or the lifecycle of an agent run end-to-end.
**Skip if:** you only need to work inside one component's internals — go to that
component's own `CLAUDE.md`.

> Status: DRAFT — high-level shape is known; concrete protocols/contracts are
> not finalized. Flag assumptions rather than inventing wire formats.

## Component responsibilities

- **Frontend** — UI only. Talks to the Backend over REST (commands/queries) and
  WebSocket (live run events). Holds no source-of-truth state.
- **Backend** — source of truth. Owns the database, GitHub OAuth tokens, and the
  event stream. Decides *when* work runs and dispatches **job specs** to the
  Forge. Relays Forge events to the Frontend.
- **Forge** — stateless worker. Receives a job spec, executes it in an ephemeral
  container, streams events back, and reports a final result. Keeps nothing
  between runs.

## End-to-end flow (a feature being built)

```
User (Frontend)
   │  writes feature spec, hits "run"
   ▼
Backend
   │  persists feature, mints short-lived scoped GitHub token,
   │  builds a job spec, dispatches to Forge
   ▼
Forge
   │  provision container → inject Pi agent + tools
   │  clone repo (scoped token) → create branch yggdrasil/<slug>-<id>
   │  open draft PR → run Pi (RPC/SDK), stream events ──┐
   │  (optional) tunnel preview URL                     │
   │  teardown + archive artefacts                      │
   ▼                                                    │
Backend  ◀───────────── events (status, logs, PR) ──────┘
   │  persists state + artefact refs, relays events
   ▼
Frontend  (live updates over WebSocket; user can chat/steer mid-run)
```

See `concepts/job-dispatch.md` for the Backend→Forge contract,
`concepts/pi-agent.md` for what runs inside the container, and
`concepts/feature-lifecycle.md` for the states a feature moves through.

## Storage

- **PostgreSQL** — primary relational state (Backend-owned).
- **Object storage** — logs, test reports, screen recordings, artefacts.

## Key boundaries (don't cross them)

- Frontend never talks to the Forge directly — always via the Backend.
- Forge never persists durable state — the Backend owns it.
- GitHub tokens are minted by the Backend and injected short-lived into the
  Forge container; they are never stored in the Frontend.

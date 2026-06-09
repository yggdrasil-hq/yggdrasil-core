# Concept: job dispatch (Backend → Forge)

**Read this when:** you touch how the Backend hands work to the Forge — the job
spec, the event stream back, or scheduled (cron) test runs.
**Skip if:** you're inside a single component and not crossing this boundary.

> Status: DRAFT — flow is known from the brief; the concrete spec/protocol is not
> finalized. Treat field names below as placeholders.

## When a job is dispatched

- A **feature** is ready to be worked on (user action), or
- A **scheduled test run** fires (cron — Phase 3).

The Backend builds a **job spec** and dispatches it to the Forge. The Forge is
stateless: everything it needs must be in the spec (or fetchable with the
injected token).

## Job spec (PLACEHOLDER contents — confirm)

- Target repo(s) + ref, branch name `yggdrasil/<feature-slug>-<id>`.
- Short-lived scoped GitHub token (minted by Backend).
- Feature spec / prompt + provided context.
- Pi config: model, extensions, tool allowlist, timeout, token budget.
- Job kind: `feature_build` | `test_run` | (others TBD).
- Callback/stream endpoint for events.

## Events back to the Backend

The Forge streams run events (status changes, logs, PR opened, preview URL
ready, test results, completion/failure). The Backend persists them, stores
artefact refs in object storage, and relays to the Frontend over WebSocket.

## TODO

- Transport (queue? HTTP? gRPC?) and delivery guarantees. See
  `roadmap/open-questions.md` (self-hosted compute affects this).
- Exact event schema (align with Pi's event taxonomy — `concepts/pi-agent.md`).
- Idempotency / retry / dedupe for dispatch and events.

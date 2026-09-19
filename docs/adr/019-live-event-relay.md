# ADR 019: Live job-event relay (WebSocket)

**Status:** Accepted
**Date:** 2026-09-18
**Deciders:** Product session (open-issue burn-down, wave 6)
**Builds on:** [ADR 006](006-pi-rpc-orchestrator-integration.md) (the curated
event vocabulary this relays, and the Postgres `LISTEN`/`NOTIFY` pattern it
reuses for `job_replies`/`job_cancellations`), [ADR 010](010-feature-build-rpc-wiring.md)
and [ADR 015](015-six-stage-feature-lifecycle.md) (the event types a client
receives), [ADR 016](016-organization-rbac-and-cluster-routing.md) (the
org-membership scope the socket authorises against), [ADR 001](001-authentication.md)
and [ADR 009](009-github-only-authentication.md) (the session cookie that is the
socket's only credential), [ADR 024](024-per-message-grill-resume.md) (the
per-message restart control the grill page must keep working)
**Does not touch:** ADR 006/010's attach/RPC *machinery* (the Orchestrator change is
additive — item 13 adds one translation and widens `runTurn`'s forward-live set;
the attach protocol, turn handling and terminal-event detection are unchanged),
ADR 028 (a read relay records nothing), `deploy/` (the upgrade already worked; the
one timeout change is noted in item 12 and was made by the parent)
**Resolves:** `yggdrasil-hq/yggdrasil-core#10` (open question #7 — agent chat
wire path) and `yggdrasil-hq/yggdrasil-core#12` (open question #11 — leaving
`spec_grill` polling)

## Context

Two open questions have been entangled since ADR 006: **#7** asked where the
agent's live output should travel (Web → API, a separate Orchestrator subdomain,
or a socket straight to Pi in the job pod), and **#11** asked to actually leave
polling. The Web app has polled `GET /projects/:projectId/features/:featureId/events`
every 2 s since ADR 006 item 8 landed, and `api/CLAUDE.md` has carried a
"WebSocket (planned)" line for as long.

Polling is not merely wasteful here, it is the wrong shape. The events being read
are *turn-level*: one `ask_user` ends a turn and waits on a human, and one
`agent_text` carries a whole assistant message. A conversation therefore arrives
in 2 s quanta at best, and a reply from the user is not visible to another tab
until the next tick. The grill page's "agent is thinking" bubble is inferred from
a status flag rather than driven by anything live.

The building blocks for the alternative already exist:

- The API writes every curated event to `job_events` and already uses Postgres
  `LISTEN`/`NOTIFY` for the two *inbound* channels (`job_replies`,
  `job_cancellations`).
- `deploy/nginx/*` already proxies `/api/` with `Upgrade`/`Connection` headers,
  so an upgrade survives the only proxy in front of the API.
- Every authenticated route already resolves the caller from a session cookie,
  and the REST read the Web app polls already defines the exact authorisation a
  socket must reproduce.

## Decision

### 1. Topology: Web → API WebSocket. One hop, no new origin.

The socket connects to the API on `GET /api/ws` (the service serves it at `/ws`;
nginx's `/api/` prefix is what makes it `/api/ws` externally). The API holds the
socket, the Web app never learns the Orchestrator exists.

This resolves open question #7 in favour of the first of its three options, for
reasons that are about authority rather than convenience:

- **The API is the only component with both the events and the authorisation.**
  Every curated event is already posted *to the API* by the Orchestrator
  (`POST /internal/jobs/:jobId/events`), and the REST read that must be mirrored
  lives there too. A Web → Orchestrator or Web → Pi socket would have to
  re-implement project/org membership checks in a second service — or, worse,
  serve events to a socket authenticated by nothing.
- **A direct Web → Pi socket means exposing a job pod to the browser.** Those
  pods hold a live scoped GitHub token and the model API key (ADR 004), live in
  ephemeral per-job namespaces, and are deleted the moment the run ends. Putting
  an authenticated ingress in front of each one is a much larger surface than
  relaying through a service that is already public and already session-aware.
- **One origin means the session cookie just works.** A cross-origin socket needs
  a credential the browser will actually send, and the session cookie is
  `SameSite=Lax` (ADR 001) — a same-origin socket sends it automatically, with no
  token scheme, no CORS-on-upgrade negotiation, and nothing new to leak.
- **The Orchestrator stays swappable.** It is a stateless executor (ADR 003); the
  Web app's contract staying with the API is what keeps the Orchestrator's
  internal design from becoming a browser-facing API.

### 2. The socket is attached to the HTTP server, not to Express.

`index.ts` builds the server (`createServer(app)`) and attaches the `ws` server
to it, rather than `app.listen`. A WebSocket upgrade is an HTTP event Express
never sees, so there is no router to mount; and keeping the socket out of
`createApp` preserves the property that building an app opens no ports and no
subscriptions. This mirrors why the ADR 026 scheduler and ADR 029 recording sweep
are also started in `index.ts` rather than inside `createApp`.

### 3. Auth: the session cookie, read off the upgrade request.

The socket's only credential is `yggdrasil_session`, the same cookie every
authenticated route uses. Two consequences of the upgrade not passing through
Express:

- `cookie-parser` never runs, so the cookie is read from the raw `Cookie` header
  by a small local parser (`live/cookies.ts`). It is hand-rolled rather than
  imported from the `cookie` package because that package is present only
  transitively and is not a declared dependency — importing undeclared packages
  is exactly what had to be fixed by hand for `ws` itself before this lane could
  typecheck.
- The session is resolved (`sessions.findValid`) and then its user
  (`users.findById`). **A valid session whose user no longer resolves is
  rejected**, because the socket's identity is the user, never the session id.

No token scheme and no query-string credential: a URL is the one place a session
id would end up in logs, referrers and browser history.

Rejections close with an application code rather than sitting open and silent, so
a client can tell "not logged in" from "relay unavailable":

| Code | Meaning | Client behaviour |
|------|---------|------------------|
| `4401` | No/invalid session, or its user is gone | Stop retrying; the REST calls surface the 401 and the app sends the user to login |
| `4400` | Protocol abuse, or a failed handshake | Stop retrying |

The session is deliberately **not** touched on connect. Every authenticated REST
call already refreshes it, and the page keeps a reduced-rate poll running while
the socket is live — so a forgotten background tab cannot keep a session alive
indefinitely, which is the property the session TTL depends on.

### 4. Authorisation mirrors the REST read exactly, per subscribe frame.

A client subscribes with `{type: "subscribe", projectId, featureId}` and the API
resolves it in the same order, through the same repositories, as
`GET /projects/:projectId/features/:featureId/events`:

1. `projects.findByIdForUser(projectId, userId)` — the org-membership join
   (ADR 016) that yields a project only for a member of its organization.
2. `features.findById(projectId, featureId)` — the feature *within* that project.

Both failures produce one message (`Feature not found`) and no subscription,
matching the REST route's 404 for both. Distinguishing them would make the socket
an existence oracle for other organizations' projects and features.

The order is the security property, not an implementation detail: a bare
`features.findById(featureId)` would authorise **any** feature to **any**
authenticated user. That is the whole reason the relay does not simply reuse a
feature-id lookup.

Authorisation is re-checked on **every** subscribe frame — never cached across
frames on one socket, so an unsubscribe/resubscribe cycle re-authorises.

### 5. Frames: a change signal, not a state channel.

Client → server:

```json
{"type": "subscribe",   "projectId": "...", "featureId": "..."}
{"type": "unsubscribe", "featureId": "..."}
{"type": "ping"}
```

Server → client:

```json
{"type": "ready",        "protocolVersion": 1}
{"type": "subscribed",   "featureId": "..."}
{"type": "unsubscribed", "featureId": "..."}
{"type": "job_event",    "featureId": "...", "jobId": "...", "event": { ... }}
{"type": "job_event_delta", "featureId": "...", "jobId": "...", "text": "..."}
{"type": "error",        "message": "..."}
{"type": "pong"}
```

`job_event.event` is byte-identical to one entry of the REST read's `events`
array (including `createdAt` as an ISO string), so the Web app reuses one
`FeatureEvent` type for both paths.

`job_event_delta` (item 13) is the one frame that is **not** a record: it carries
raw streaming text that is never persisted, is not replayed on reconnect, and
whose only correct client reaction is to append it to a provisional buffer. Its
`text` is verbatim — chunks are frequently a single space or paragraph break, so
any normalisation would corrupt the reassembled message.

Ids are validated as uuids at parse time and a frame that is not recognised is
answered with an `error` frame; a connection sending `LIVE_MAX_PROTOCOL_ERRORS`
(5) of them is closed with `4400`. Zero tolerance would make one stray frame from
a slightly newer client fatal; unbounded tolerance lets a broken client spin the
process.

**A `job_event` frame carries no feature status, no `awaitingUserInput`, and no
`job_status`.** That is the central design decision of this ADR (item 7).

### 6. Fan-out: Postgres `LISTEN`/`NOTIFY`, with the hub in-process.

`JobEventRepository.create` — the single place any job event is written — ends
with `SELECT pg_notify('job_events', <event id>)`, following
`JobMessageRepository.create`'s existing ordering argument: NOTIFY becomes
visible only once its statement's transaction commits and `pg.Pool.query`
auto-commits, so inserting first means a listener can never be woken for a row it
cannot yet read. Every writer is covered by construction: the Orchestrator's
internal route, a user's mid-run reply, and a design session's messages all go
through that one method.

The payload is the **event id, not the event**: `pg_notify` caps its payload at
8000 bytes, and events legitimately carry large `markdown`, `summary` and design
`snapshot` values. Each API replica runs one listener on a dedicated (non-pooled)
`pg.Client` — `LISTEN` is connection-scoped, and a pooled connection may be
recycled or reset underneath a subscription — reads the row back with its job's
`project_id`/`feature_id` in one query, and publishes to a topic named
`feature:<id>`.

Streaming deltas (item 13) take a **second channel**, `job_event_deltas`, on the
same listener connection, because they need the opposite of everything above:
no row to read back (so the payload must be self-contained) and no place in the
catch-up story. Crucially they take the same *bus*, for the same reason — see
item 13 for why publishing them straight to an in-process hub would be wrong.

Why not an in-process emitter on the write path: several API replicas share one
database, and an emitter would relay only the events the *same process* happened
to write, failing silently and unreproducibly. Why not a timer poll: it would
reintroduce exactly the latency this ADR removes, moved to the server.

The in-process `LiveHub` maps topics to connections. A socket whose `send`
throws is **removed and the fan-out continues** — one half-closed tab must not
deprive its siblings of an event, and leaving it in the set would make every
later publish throw.

**Two topics now, routed by job kind (issue #25).** The paragraph this replaces
said a `design_grill` event was dropped because it has no `feature_id`, and that a
design-session surface "would need its own topic shape; the hub takes an opaque
topic string precisely so that is additive". That prediction held, and the addition
turned out to need one thing it did not foresee:

**A design session id *is* a job id.** The REST route resolves its `:sessionId`
through `findByIdForProject(projectId, sessionId)` plus a `kind === "design_grill"`
check — so the id itself says nothing about what it identifies, and a feature-less
event is therefore indistinguishable from a **scheduled `test_run`**, which also has
no `feature_id` and also emits events. `JobEventWithScope` had to gain the job's
`kind` (it carried only `projectId`/`featureId`/`event`), and `relayEnvelopeFor`
branches on it:

| scope | topic |
|---|---|
| has a `feature_id` | `feature:<featureId>` |
| `kind === "design_grill"` | `design:<sessionId>` |
| neither — a scheduled `test_run` | **null**, still dropped deliberately |

The design frame is its own type (`design_session_event`) rather than a reused
`job_event`, whose only scope field is named `featureId`; putting a session id in a
field called `featureId` is a lie an over-eager reader could act on, and making it
nullable would break a shape every existing client parses.

**The third case is now its own issue (#90) rather than an oversight.** A
feature-less job that is not a design session routes nowhere, because there is no
surface subscribed to it — and inventing a topic nobody reads would be noise
pretending to be a feature. Choosing that topic's shape belongs with issue #39's
general pipeline question rather than ahead of it.

**Verified cross-process**, in the two-replica harness: an event written by one
replica reaches a socket on the other over the design topic, **and** a feature event
does not appear on it. That second check is the negative case, and it had to be
rewritten to be falsifiable — its first version watched the feature topic while
writing a design event, which could not fail even with routing entirely wrong.

**Verified in a real two-replica deployment (issue #32).** This item's reasoning
was sound when it was written but had never been *observed* — by construction,
since it is unobservable in a single-process test. It has now been measured, with
a reproducible harness committed at `api/scripts/verify-live-relay/`:

- **The load-bearing claim holds.** An event written through one replica's HTTP
  surface reaches a socket held by another — **both directions, both channels**
  (stored events and deltas). This is the claim a bug would have hidden in
  production only.
- **The 8000-byte `pg_notify` cap is real**: 7999 bytes accepted, 8000 rejected
  (`payload string too long`). That is the constraint that makes the
  stored-event payload an event *id* rather than event data.
- **The nginx timeouts work as configured**: a 90-second idle socket survived and
  still delivered, which is past nginx's *default* 60s `proxy_read_timeout` — so
  the test distinguishes the configured 3600s from the default rather than passing
  under either.
- **What is still not verified: a real browser client.** The harness uses a `ws`
  client, so the Web app's own silent degradation to 2s polling was not exercised.
  A broken socket path *in a browser* therefore remains unobserved — and because
  that degradation makes a failure look like success, it is the half worth
  distrusting (item 13's follow-up 3).

**A protocol precondition this exposed (issue #77).** A `subscribe` frame sent
before the server's `ready` frame is **silently dropped**: the socket stays open
and still answers `ping`, so nothing fails and no client can tell. The cause is
that the server performs its session lookup before attaching a message listener,
and `ws` does not buffer for a listener that does not yet exist. This is worse than
the graceful degradation item 13 anticipated — degradation at least triggers the
polling fallback, whereas a silently-ignored `subscribe` leaves a client that
believes it is subscribed. Stated on the wire, or buffered, until it is fixed.

### 7. The Web app keeps REST as its only state path; the socket only says "re-read".

The relay notifies; the existing REST read is what updates the page. The grill
page therefore has **one** state path in both modes:

| Relay state | Poll interval | Socket's role |
|---|---|---|
| Not live (never connected, dropped, refused, disabled, gave up) | `GRILL_POLL_INTERVAL_MS` (2 s, unchanged) | none |
| Live (connected **and** subscribed) | `LIVE_SAFETY_POLL_INTERVAL_MS` (30 s) | each `job_event` triggers a coalesced immediate re-read |

Three things follow, and they are the reason for the choice:

- **Degradation is structural, not nominal.** A socket that never connects is
  not an error path — it is the pre-relay behaviour, because the same poll
  function runs with the same 2 s interval. There is no separate "socket failed"
  rendering to get wrong.
- **No derived state is duplicated in the browser.** `awaiting_user_input`, the
  feature's status and `jobs.last_error` are computed server-side; the socket
  never carries them, so the client cannot disagree with the API about the
  lifecycle. It also means an event type added in future needs no client change
  to be reflected — the re-read picks it up.
- **The slow poll is a safety net, not a formality.** A relay that silently stops
  delivering (a bug, a proxied connection killed without a close) degrades to
  "up to 30 s stale" instead of "wrong forever".

Bursts are coalesced (`LIVE_REFRESH_COALESCE_MS`, 150 ms): one agent turn can
append several events, and a re-read per frame would issue as many requests as
polling, just burstier.

"Live" means **subscribed**, never merely open: an open socket that has not been
accepted for the feature receives nothing, so treating it as live would strand
the page on the slow interval with no fast fallback.

### 8. Reconnection, and what a client that reconnects has missed.

Reconnect uses capped exponential backoff (1 s, 2 s, 4 s … 30 s), reset on a
successful open so a tab that blips once does not inherit an old failure count.
After `LIVE_MAX_RECONNECT_ATTEMPTS` (10) consecutive failures the client stops
trying and leaves the page on the fast poll — the relay is optional, and a
deployment that never accepts the upgrade must not leave every tab reconnecting
forever. `4401`/`4400`, and a subscribe refusal, are **not** retried: the same
request will be refused again.

**Missed events need no bookkeeping, because the re-read is the catch-up.** The
poll effect depends on whether the relay is live, so the transition into `live`
re-runs it and performs an immediate read — which returns the full event list
plus the derived state, from the authoritative source. This is why the protocol
has no `since` cursor and the hub keeps no per-connection history: an append-only
`job_events` table already is that history, and `GET .../events` already serves
it. A client that reconnects after any gap converges on the next read.

### 9. Several tabs, and a job that ends mid-connection.

Each socket is its own connection with its own id (`<userId>:<uuid>`), so two
tabs of one user are two independent subscribers and closing one does not
unsubscribe the other.

A job completing while a client is connected is not a special case: the terminal
event (`submit_adr`, `submit_build_result`, `run_failed`, `run_cancelled`, …) is
appended like any other and triggers a re-read, which is where the feature's new
status comes from. The client is never told "the job ended" by the socket,
because the socket is not a state channel (item 7).

Subscribing to a feature with **no active job** is allowed and meaningful:
subscription is by feature, not by job, so a retry (ADR 012) or a per-message
restart (ADR 024) that creates a new job row mid-connection keeps delivering on
the same subscription rather than requiring a resubscribe.

### 10. Bound: a revoked membership takes effect on the next reconnect.

Authorisation happens at subscribe; an *existing* subscription is not
re-evaluated when membership is later revoked or the session deleted. The socket
therefore outlives a revocation until it next reconnects, and a socket can
outlive the closing of a browser tab in a forgotten window.

Accepted, and stated plainly rather than implied, because the alternatives are
worse for the shape of this product: re-authorising per published event doubles
the queries of the hot path, and a periodic re-auth timer is a third mechanism
for a case whose exposure is one user's own organization's events for as long as
one socket stays open. The bound is also naturally repaired: any restart of the
API, any network blip, and any navigation re-connects and re-authorises, and the
page's REST calls are authorised per request regardless.

### 11. A kill switch, because the relay is optional by construction.

`config.live.enabled` (`LIVE_RELAY_ENABLED`, on by default) stops the listener
from starting. The socket endpoint still exists; a deployment with the relay off
simply has clients connect, subscribe, and receive nothing — which the page
handles as "not live" and polls normally. Deltas are dropped too (`NOOP_LIVE_PUBLISHER`
when no publisher is configured), so the switch is genuinely all-or-nothing rather
than leaving the delta path half-live. This is worth having precisely because
item 7 makes the relay non-load-bearing: a misbehaving socket path can be turned
off in a live install without a rollback. It defaults on for the same reason
ADR 026's scheduler and ADR 029's sweep do — a relay that must be switched on is
one that silently does nothing after a fresh install.

### 12. Proxy: nothing new was needed, but one timeout was.

`deploy/nginx/*.conf` already carried `Upgrade`/`Connection` on the API location
blocks, so the upgrade itself needed no change. What it did **not** have was a
read timeout above nginx's 60 s default — which would drop a socket that is
merely waiting on an agent turn or a human's reply, i.e. the common case for a
grill. `proxy_read_timeout`/`proxy_send_timeout` are now `3600s` on the API
server blocks in both `deploy/nginx/dev.conf` and `deploy/nginx/prod.conf.template`.
No route split, no separate host, and no `Connection` special-casing was required.

### 13. Delta streaming: implemented, in three parts across three repos.

Open question #12 asked to leave polling for "real interactivity (agent 'thinking'
states, streaming tokens, instant delivery)". Items 1-9 delivered instant
delivery; this item delivers the tokens.

**Why it needed three repos.** Pi emits streaming progress as `message_update`
events carrying a `text_delta`, and `rpc.Translate` handled only
`tool_execution_end`, `agent_end` and `message_end` — `message_update` fell
through to not-curated, so deltas never left the job pod and the API's event
schema had no type to accept. All three layers therefore change together:

1. **Orchestrator.** `translateMessageUpdate` decodes Pi's `assistantMessageEvent`
   union and translates only `text_delta` into `EventAgentTextDelta`, carrying the
   chunk verbatim. `runTurn` adds it to the set it forwards live and keeps
   reading — the same treatment `agent_text` gets — so it is **not terminal** and
   does not disturb the `agent_settled` / no-contract-tool failure path. Only
   `text_delta` is translated: `text_start`/`text_end` carry no prose,
   `thinking_*` is reasoning the model did not address to the user, and
   `toolcall_*` is tool arguments being assembled.
2. **API.** The delta is accepted by its own schema (`jobEventDeltaSchema`) and
   branched **before** the stored-event schema, so `jobEventSchema`'s enum stays
   authoritative for what can become a `job_events` row. It is relayed and never
   inserted; the response is `202`, not `201`, because nothing was created. One
   row per token is not an option: it would multiply the table by orders of
   magnitude, bloat the `GET .../events` catch-up read that item 8 depends on,
   and turn a transient affordance into permanent storage.
3. **Web.** Deltas accumulate into a growing agent bubble. The buffer is dropped
   when the authoritative `agent_text` arrives, so the two paths cannot
   double-render or drift (see the supersede rule below).

**Fan-out: a second Postgres channel, not a direct publish to the hub.** This is
the one implementation decision worth stating explicitly, because the obvious
shortcut is wrong. The delta could have been handed straight to the receiving
process's in-memory `LiveHub` — but sockets are held by whichever replica
accepted the upgrade, the Orchestrator's HTTP POST lands on whichever replica
nginx picked, and with the multi-replica deployment item 6 assumes, roughly half
of all deltas would reach no one. That is the same failure this ADR's own
alternatives table rejects for stored events ("an in-process emitter on the write
path ... silently relays only events written by the same API replica"). So
deltas ride `job_event_deltas`, a second channel on the same dedicated listener
connection, with a **self-contained** JSON payload `{featureId, jobId, text}` —
self-contained because there is no row to read back. The payload is guarded at
7 KB against `pg_notify`'s 8000-byte ceiling and rejected rather than attempted if
exceeded.

**The supersede rule.** Pi's docs are explicit that `message_update` carries a
delta "without a cumulative message snapshot" and that `message_end.message` is
authoritative, so the deltas for one message concatenate to exactly the text
`agent_text` later delivers. The Web app accumulates into a buffer and drops it
when the transcript read shows a **new** `agent_text` — counting messages rather
than substring-matching the buffer's own text, because a faithful superset cannot
fail to match on a whitespace or markdown nuance the way a substring comparison
could. Comparing counts also avoids flicker: a mid-stream read that has not yet
seen the finished message must leave the growing bubble alone. A second rule
drops the buffer when the run stops being `running`, because a stream interrupted
mid-message never persists its partial text and the bubble would otherwise
outlive the transcript it is supposed to preview.

**Costs, and they are real.** Deltas invert the traffic shape — one frame per
token rather than per turn — and three consequences follow, none of them solved
here:

- **One HTTP POST per delta.** `runTurn` forwards synchronously and each forward
  is a request to the API, so a turn's duration grows with its delta count and a
  terminating event queued behind a long stream waits for those POSTs to drain.
  The pod's stdout backpressure (the RPC event buffer is finite) means the
  surface for this is *slower turns*, not corruption.
- **The hub's per-frame `JSON.stringify` becomes hot**, along with one
  `pg_notify` per delta.
- **Nothing about the deltas is durable**, by design: not persisted, not
  replayed, and not part of the missed-event story. Item 8 still holds — a client
  that loses deltas loses nothing that matters, because the complete message
  arrives at `message_end` over the ordinary path.

Coalescing deltas in the Orchestrator (accumulating chunks and flushing every
~50-100 ms) is the obvious mitigation for the first two costs and is left as a
follow-up rather than built speculatively: it changes what the agent's stream
looks like on the wire, and the honest sequence is to measure first.

## Consequences

### Positive

- Open questions #7 and #11 are both resolved, with one component (the API)
  owning the wire path, the authorisation and the events.
- A job's events are delivered the moment they are written, with no new
  persistence, no new service, and no new origin.
- The socket reproduces the REST read's authorisation rather than inventing one,
  and the tests assert the negative cases (a non-member, a second user, and a
  feature outside the project all receive nothing).
- Because REST remains the only state path, the relay cannot render a state the
  API would not return, and a broken relay cannot produce a broken page — it
  produces the previous page.
- The same mechanism will carry `design_grill` sessions and build progress, since
  fan-out is by topic and the client's only reaction is a re-read.
- **Token-level streaming now works** (item 13), so open question #12's
  "streaming tokens" is met and not just its "instant delivery" half. The grill
  transcript grows as the model writes rather than appearing a message at a time,
  and the arrangement is self-correcting: the provisional bubble is always
  replaced by the persisted message, never merged with it.

### Negative / trade-offs

- **One long-lived connection per open tab** through nginx to the API, plus one
  dedicated Postgres connection per API replica for `LISTEN`. Bounded by tabs,
  but not free, and the listener connection is a new failure mode to monitor (it
  logs and reconnects rather than crashing).
- **A revoked membership is not enforced on an already-open socket** (item 10).
- **The 30 s safety poll means "live" is never fully trusted**, which is a
  deliberate cost: it is one request per 30 s per open grill page, in exchange
  for a silently-dead relay being visible as staleness rather than permanent
  wrongness.
- **Deltas cost one HTTP POST each, and are not coalesced** (item 13). A turn's
  duration now grows with its delta count, a terminating event queued behind a
  long stream waits for those POSTs to drain, and each delta is one `pg_notify`
  plus one socket write. This is the cost this ADR accepts for building the
  streaming path first and measuring before optimising; coalescing is follow-up 1
  and has since landed (issue #23)
  and is the expected fix.
- The relay is a read amplification: one event now causes a Postgres read, a
  socket write, and (coalesced) a REST re-read per subscribed tab, where before
  it caused nothing until the next poll. Deltas add a frame per token on top,
  deliberately without the Postgres read or the re-read.

### Follow-ups

1. ~~**Coalesce deltas in the Orchestrator.**~~ **Done** (issue #23,
   `orchestrator/internal/worker/deltas.go`). Consecutive deltas accumulate and
   are forwarded as one, on a 75 ms timer or a 4 KiB ceiling, whichever comes
   first. It is the localised change to the forwarding path this predicted and
   nothing else: the endpoint, the fan-out, the frame shape and the client's
   delta handling are untouched.

   Two properties are the reason it is a wrapper rather than a protocol change,
   and both are now pinned by tests. **Ordering**: every non-delta event flushes
   the buffer before it is forwarded, so the authoritative `agent_text` — which
   the client uses to *replace* accumulated text — can never overtake the deltas
   it supersedes. **No loss**: the buffer is flushed on every return path, and a
   delta arriving after the session ends is forwarded rather than dropped.

   The interval is still a judgement rather than a measurement, contrary to this
   item's own advice, because nobody has measured a real delta rate yet — 75 ms
   is the middle of the range the item names, chosen so a stream does not visibly
   arrive in lumps while cutting a few hundred chunks a second to about ten. If
   the number ever needs defending with a figure, that is the measurement to
   take.
2. **A design-session topic**, so `design_grill`'s live preview stops polling
   (ADR 014's snapshot events are already in the same vocabulary).
3. **Subscribe-once authorisation for build and testing surfaces** — the grill
   page is the only converted surface; the build-progress panel, the feature
   testing tab and the design session view still poll unchanged.
4. **Per-socket rate limiting and a delta volume ceiling**, now that frame volume
   is client-visible. There is none today, matching the rest of the API. Its
   prerequisite (follow-up 1) has landed, so what a normal stream costs is now
   measurable rather than hypothetical — which is what this item said it was
   waiting for.
5. Consider a `subscribe`-acknowledged cursor if the REST catch-up read ever
   becomes expensive enough to avoid — not close today, since a grill transcript
   is a few hundred rows at most.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Web → Orchestrator subdomain socket | Duplicates org/project authorisation in a second service that has no session concept, and exposes a stateless executor (ADR 003) directly to browsers. |
| Web → Pi in the job pod (direct preview socket) | Requires an authenticated ingress per ephemeral pod; those pods hold a live GitHub token and the model key (ADR 004) and are deleted at job end. Also cannot authorise without the API's data. |
| Server-Sent Events instead of WebSocket | One-way-only fits today's frames, but loses the client → server ping/keepalive and would need a second channel for the delta phase; `ws` was already available, and nginx was already upgrade-capable. |
| Poll the database on a timer inside the API (server-side "polling relay") | Reintroduces the same latency at a new layer while adding a per-replica query load. |
| An in-process emitter on the write path | Silently relays only events written by the same API replica — wrong with the multi-replica deployment ADR 003 §20 commits to, and wrong only in production. |
| Push full state (feature status, `awaitingUserInput`) over the socket | A second implementation of the lifecycle in the browser, which can disagree with the API; the REST read already computes it. |
| Deliver deltas by persisting them in `job_events` | One row per token; turns a transient affordance into unbounded storage and an enormous catch-up read. |
| Publish deltas straight to the receiving process's in-memory hub | Reaches only the sockets held by whichever replica handled the Orchestrator's HTTP POST — with 2 replicas, roughly half of every stream is lost, and only in production. Item 6's channel is the bus for exactly this reason. |
| Put deltas on the existing `job_events` channel with a tagged payload | The stored-event listener resolves its notification by reading the row back; a delta has no row, so the two payload shapes must not share a channel. |
| Trim whitespace from a delta before relaying it | Chunks are frequently a single space or a paragraph break, and the client concatenates them; trimming would corrupt the streamed text irreparably. |
| Drop the accumulated buffer on every transcript read | A read that lands mid-stream has seen no new message yet, so the growing bubble would blink away and re-appear on the next chunk. |
| Drop the 2 s poll entirely once the socket is live | No floor under a silently-dead relay, and no way to tell "no events" from "no delivery". The 30 s safety poll costs almost nothing and bounds the damage. |

# ADR 033: Relay scopes as data, not as a protocol per scope

**Status:** Accepted
**Date:** 2026-09-19
**Deciders:** Product session (open-issue burn-down, wave 13)
**Resolves:** issue #99 (generalise the subscription protocol), and by consequence
issue #95 (design sessions cannot stream text deltas) and issue #90 (a feature-less
job routes nowhere)
**Builds on:** [ADR 019](019-live-progress-relay.md) (the relay itself — the *signal*
versus state split, the two Postgres channels, `relayEnvelopeFor`, and item 7's rule
that the socket is never stricter or looser than the REST read it signals),
issue #25 (the design-session surface, the first scope added), issue #32 (multi-replica
fan-out, verified), issue #23/#24 (delta coalescing and the per-socket/per-job bounds),
and ADR 014 (the project-scoped `design_grill`, which is why a feature-less job exists
at all)

## Context

Issue #39 asked whether a new job kind can be added to the pipeline as *configuration*.
Its fourth claim said it should be, and the burn-down **refuted** it at the scope level:
adding the design-session scope in issue #25 cost a parallel protocol on both sides.

The evidence is a file list, which is the honest measure of "is this configuration?":

| file | what the design scope needed |
|---|---|
| `api/src/live/types.ts` | `liveTopicForDesignSession`; a new server frame `design_session_event` plus its parser |
| `api/src/live/relay.ts` | a branch in `relayEnvelopeFor` |
| `api/src/jobs/events-repository.ts` | `JobEventWithScope.jobKind` and `j.kind` in the scope SELECT |
| `api/src/live/authorization.ts` | `authorizeDesignSessionSubscription` |
| `api/src/live/socket.ts` | `subscribe_design`, `unsubscribe_design`, a confirmation frame — each in `parseClientFrame` **and** the frame switch |
| `web/lib/features/live-relay.ts` | `designSessionEventFromFrame`; a `designSubscription` protocol value |
| `web/components/designs/use-live-design-relay.ts` | a separate hook |

The *transport* is shared throughout — one socket, one path, one `LISTEN`, one hub, the
same coalescing and frame budget — so #39's claim is half true and fails where it
matters. The cause is structural rather than an oversight: **a session id is not a
feature id**, so the frames cannot be reused. `job_event`'s only scope field is named
`featureId`, and a `job_event` carrying a session id in that field would be a lie an
over-eager reader could act on. `design_session_event` exists to prevent exactly that,
and `designSessionEventFromFrame`'s comment argues against merging the two readers.

That reasoning was correct as a local decision and is the reason the cost was paid. This
ADR's claim is narrower and still holds: **the second scope was expensive for a reason
that does not recur, so the third should not pay it.**

## Decision

### 1. The frames carry a scope; the frame name does not name the scope.

```
→ {"type":"subscribe",   "contract":2, "projectId":"…", "scope":{"kind":"feature","id":"…"}}
→ {"type":"subscribe",   "contract":2, "projectId":"…", "scope":{"kind":"design_session","id":"…"}}
→ {"type":"subscribe",   "contract":2, "projectId":"…", "scope":{"kind":"test","id":"…"}}

← {"type":"ready",       "contract":2}
← {"type":"subscribed",  "scope":{"kind":…,"id":…}}
← {"type":"unsubscribed","scope":{"kind":…,"id":…}}
← {"type":"event",       "scope":{"kind":…,"id":…}, "event":{…}}
← {"type":"delta",       "scope":{"kind":…,"id":…}, "text":"…"}
```

Three frame names become one subscribed/unsubscribed pair and one event/delta pair; the
scope is a value. `scope` is a **closed union of two strings plus an id**, and the id's
meaning is defined by the kind — which is the point. The old framing failed because it
put a session id in a field named `featureId`; a tagged scope cannot make that mistake,
because the tag and the id travel together and a reader that does not understand a kind
rejects the frame instead of misreading it.

### 2. Two registries, keyed by `kind`.

- **A topic builder**: `(scope) => string`, replacing `liveTopicForFeature`,
  `liveTopicForDesignSession` and #90's third. `feature:<id>`, `design:<id>`,
  `test:<id>`.
- **An authoriser**: mirroring the REST route the scope signals.

**Every authoriser names the route it mirrors in a comment, and each resolves its
resource inside a project the caller is a member of.** ADR 019 item 7 is the reason:
a socket must be neither stricter nor looser than the read it signals. The specific
failure this guards against is a "generalisation" that collapses into a generic
`(projectId, id)` check — which is a *looser* gate than any existing route, and would
let a member of a project subscribe to a resource they cannot read. That is why the
registries are keyed by a closed enum rather than accepting a caller-supplied kind.

The design scope's topic is a pure function of the scope: a design session's id **is**
its job id (`api/src/jobs/events-repository.ts` documents this, and the events route
resolves the session as `findByIdForProject(projectId, sessionId)` requiring
`kind === "design_grill"`), so no lookup is needed to build `design:<id>`.

### 3. A new scope therefore costs a kind value, a topic builder and an authoriser.

No new frame names, no second reader, no second hook. The Web side reuses one
`useLiveRelay` parameterised by scope.

### 4. Version 2 replaces version 1; the old frames are removed in the same change.

`ready` already announces `protocolVersion`, so the lever exists. The ground for
choosing replacement over a compatibility window is that **the degradation is already
built and is the right one**, verified at both ends:

- an unrecognised client frame answers `{ type: "error", message: "Unrecognised frame" }`
  (`api/src/live/socket.ts`);
- `web/lib/features/live-relay.ts` treats an `error` frame as **terminal** — stop the
  socket, fall back to the fast poll.

So a version-1 client meeting a version-2 server degrades to the pre-relay poll, which
every surface is designed to survive. Accepting both shapes for a release is the right
choice when clients **cannot** be upgraded together — a shipped binary, a third-party
integration. Neither exists here: the only client is in this repository and ships in the
same image as the server, so a compatibility window would mean maintaining two parsers
to protect a client upgraded atomically with the thing it talks to.

**This is conditional on proving the degradation by running, not by reasoning.** A
mismatched-protocol path is reached only during a bad upgrade window, which is precisely
the path that never gets exercised and quietly rots. The change must drive a
version-1-shaped `subscribe` at the version-2 socket over a real WebSocket and show the
client ends up polling rather than dead. Bump `protocolVersion` in the same change so
the announcement matches the wire.

### 5. Issue #95's design deltas are this change's first new scope, not a separate job.

#95 records that a design session's prose arrives per message rather than per token,
because the delta path is feature-scoped end to end. Its own statement of what blocks it
is that `LiveDeltaPayload` "carries `featureId` and no scope discriminator, so it needs
either a scope field or a second payload shape".

**Decision §1 supplies the scope field**: the delta frame is scope-tagged. So the
"second payload shape" is not needed and #95 is implemented as this ADR's first new
scope, not before it. Verified at the three sites that would otherwise have to be
designed from scratch:

| site | today | under this ADR |
|---|---|---|
| `JobRepository.recordRelayedDeltaBytes` | returns `{ featureId, totalBytes, previousBytes }`, no kind | returns the kind; the row is already `RETURNING` from `jobs` |
| `publishDelta` (`internal-routes.ts`) | `if (!recorded \|\| !recorded.featureId) return;` | gate on the resolved scope |
| `LiveDeltaPayload` | `{ featureId, jobId, text }` | `{ scope, jobId, text }` |

**The per-job delta ceiling is unchanged and stays per-job.** `delta_bytes` lives on the
`jobs` row, and a design job *is* a job; a per-scope ceiling would be a second mechanism
for one concept. #95 raises that the two jobs' output sizes differ — true, but a design
grill's turns are mockup revisions, i.e. *shorter* than a feature grill's prose, so the
design case is less likely to reach a ceiling sized for the feature case. `0` continues
to mean "relay everything", which is the escape hatch if that proves wrong.

## Consequences

### Positive

- A new scope becomes data. Issue #90's `test:<testId>` scope — currently being
  implemented as the fourth copy of the old shape — folds in as the second case.
- The delta path stops being a special case: one payload, one frame, one reader.
- The closed-union scope removes a class of mistake rather than a bug: it is no longer
  possible to place an id of one kind into a field that names another.
- Each authoriser's comment naming its mirrored REST route makes ADR 019 item 7
  auditable by reading, which it currently is not for the design scope.

### Negative / trade-offs

- **A breaking wire change**, mitigated by a degradation path that is verified rather
  than assumed (§4), and by the fact that the only client is in this repository.
- **A single `event` frame means one reader for all scopes.** The current separation
  exists partly to stop a feature reader acting on a design event; under §1 that
  protection becomes the scope tag, which is a weaker guarantee at the point of reading
  and a stronger one at the point of writing. Net better, but the burden moves to the
  discriminator being exhaustive — which a closed union enforces.
- **A refactor of working code** (`#25`'s design relay and `#32`'s verified two-replica
  fan-out are both freshly landed), with the regression risk that carries. The mitigation
  is that #25 already has end-to-end coverage and the two-replica harness is runnable.

## Follow-ups (out of scope here)

- **A feature-driven `test_run` has both a feature id and a test id**, so it keeps
  routing to `feature:` and the Test-entity page gets no signal for it. Filed separately
  from #90 rather than folded in.
- **The REST read for a `test` scope** is the run history
  (`/projects/:projectId/tests/:testId/runs`), which is a list rather than a single
  resource — worth revisiting if the scope needs a per-run discriminator later.
- **Whether a `job:<id>` scope is ever needed.** It was rejected for #90 because it has
  no single REST equivalent and its natural authorisation binds a job to a *project*
  only, which is weaker than the existing topics. If a real consumer appears, the
  question returns, but the answer will be a fourth registry entry rather than a new
  protocol.

## Alternatives considered

- **Keep `job_event` and add a scope field to it.** Rejected for the reason #25's
  separation was correct: `job_event`'s field is named `featureId`, and widening its
  meaning to "maybe a session id" makes every reader infer which it holds. The frame
  name would keep claiming feature-ness while carrying something else.
- **A compatibility window (§1's option 1).** Rejected in §4: it trades a permanent
  second parser and a permanent two-shape test surface for protecting a client that
  cannot exist, since the only client ships with the server.
- **A generic `(projectId, resourceId)` authoriser.** Rejected in §2: a looser gate than
  every existing route, in violation of ADR 019 item 7.
- **Implementing #95 before #99.** Rejected as strictly more work: it requires the second
  payload shape this ADR exists to avoid, which would then be rewritten.

# ADR 032: Durable Pi sessions, and a true grill fork

**Status:** Accepted
**Date:** 2026-09-19
**Deciders:** Product session (open-issue burn-down, wave 9)
**Resolves:** issue #28 part 1 — "make it a real Pi fork", which
[ADR 024](024-per-message-grill-resume.md)'s follow-ups record as the real
implementation of "restart from here"
**Builds on:** [ADR 024](024-per-message-grill-resume.md) (the shipped
context-seeded restart, and the follow-up this replaces),
[ADR 006](006-pi-rpc-orchestrator-integration.md) (`switch_session`/`fork` as RPC
commands; the ephemeral pod and its deletion), [ADR 029](029-test-run-screen-recording.md)
(the retention shape reused here), and issue #30's object-storage layer
(`api/src/storage/`), which is what makes this affordable at all
**Does not touch:** the shipped seeded restart (ADR 024 items 1–7 stand; this adds a
second, non-destructive control), `feature_build` (issue #28 scopes this to
`spec_grill`), and the transcript rendering (`web/components/features/`)

## Context

ADR 024 shipped "restart from here" as a **context-seeded re-run**: the feature
returns to `draft`, a new `spec_grill` job is dispatched, and its seed is the earlier
conversation truncated at the chosen turn. It is explicit that this is a
*reconstruction* — not the original session, and not the agent's reasoning, tool
history or working state — and its follow-ups name the real implementation:

> Persisting Pi session files, `switch_session`, and `fork`-at-entry-id are **out of
> scope** … the real implementation of this idea.

Three things have changed since ADR 024 was written, and together they turn that
follow-up from a large speculative piece of work into a contract that is already
written down:

1. **Object storage exists.** ADR 029 and issue #30 built a storage layer
   (`api/src/storage/`) holding recordings, screenshots and extension bundles, with a
   per-artifact retention sweep. ADR 024's blocker was "a durable home for session
   files that today die with the ephemeral pod"; that home now exists.
2. **Pi's RPC surface already exposes the whole mechanism.** ADR 024 describes
   `switch_session` and `fork` as a contract to be designed. It is not — it is
   documented, and I verified each command against Pi's own `docs/rpc.md`:

   | command | shape | what it gives us |
   |---|---|---|
   | `get_state` | → `data.sessionFile: "/path/to/session.jsonl"` | **where the session lives** |
   | `switch_session` | `{"type":"switch_session","sessionPath":"…"}` | load a persisted session |
   | `fork` | `{"type":"fork","entryId":"abc123"}` → `{text, cancelled}` | **fork at a real entry id** |
   | `get_fork_messages` | → `{messages:[{entryId, text}]}` | **the entry ids to offer a user** |
   | `get_entries` | `{"type":"get_entries","since":"<entryId>"}` | entry ids as a **durable cursor** |

3. **`fork` is non-destructive by construction.** It creates a *new* session file from
   a point in the existing one. ADR 024's rewind cannot offer that: it truncates and
   re-seeds, so the discarded conversation is preserved only as job history that
   nothing reads.

## Decision

### 1. Persist the Pi session file to object storage, per job.

`get_state` returns `sessionFile`; the Orchestrator copies that JSONL into the storage
layer issue #30 built, keyed by job id, when the session ends — the same seam and the
same "read the artifact out of the pod before `DeleteJob` destroys it" posture
`collectRecording` already uses (ADR 029). No new storage mechanism, and no new
credential: this is the third artifact type through one layer.

**The shape is a session object per job**, not per feature: a re-run is a new job
(ADR 012's precedent, which ADR 024 item 1 also follows), so each job's session is its
own artifact and the lineage is the job chain, not a mutable file.

### 2. The entry ids come from `get_fork_messages`, not from correlating grill events.

This is the decision that makes the feature work rather than approximately work, and
it is worth stating because the shipped reconstruction hints at the wrong approach.

ADR 024's implementation stores `restartedFromEventId` — a **grill event id** — and
truncates the transcript at it. A true fork needs a **Pi entry id**, and those are a
different id space. The tempting bridge is a mapping table from one to the other,
which would be fragile in exactly the way that matters: it assumes a one-to-one
correspondence between a curated event and a session entry, and compaction,
tool-call turns and abandoned branches all break that assumption.

`get_fork_messages` removes the need. It returns the previous **user messages** with
their entry ids and text — and a grill's user messages *are* its replies. So the
restart points are read from Pi and matched to the transcript by their own text,
rather than inferred from an id mapping that would have to be kept correct.

`fork` operates on "a previous user message on the active branch", which is the same
granularity: one reply, one fork point.

### 3. Two controls, and only one of them is destructive.

With a real fork available, the two gestures separate and should stay separate:

| control | what it does | keeps the old conversation? |
|---|---|---|
| **Resume from here** (new) | forked session continues from that point; the original session file is untouched | **yes** |
| **Restart from here** (shipped, ADR 024) | rewind + re-seed, as today | only as unread job history |

ADR 024's own trade-offs say the rewind "is approximate, and should be a real fork",
and that a fork would "also let *resume from here* exist as a distinct,
non-destructive control". That is this decision, and it is the product value: the
destructive gesture stops being the only one.

### 4. Retention follows ADR 029's shape, and the window is the same by default.

A session file is a per-run artifact of the same job as its recording, so it takes the
same bounded-column/tombstone/retention treatment: a row per artifact, a
sweep driven by a configured window, and an explicit expired state rather than a
missing one. The default window matches recordings'.

Not copied from ADR 029: the *size* cap. A session is text and far smaller than a
recording, so the byte ceiling should be its own value rather than inherited — and if
it is set to zero it must mean "reclaim everything", not "keep forever", following the
convention `RECORDING_MAX_BYTES` already establishes.

### 5. A refused or unavailable fork fails honestly, never silently.

Both `switch_session` and `fork` can be **cancelled by an extension**
(`session_before_switch` / `session_before_fork`), and both can fail because the
artifact is gone — evicted, or reclaimed by the retention sweep. Three outcomes, and
the API must tell them apart:

- **forked** — the new session is running;
- **refused** — an extension declined; the user is told, and the original is intact;
- **unavailable** — the session file is expired or was never persisted (a pod that
  died mid-run). The surfaced reason names which, and **the shipped seeded restart
  remains available as the fallback**, because it needs nothing but the transcript
  that is already in `job_events`.

That third case is why this ADR does not delete ADR 024's mechanism. A true fork is
strictly better when it is possible; the reconstruction is what works when it is not.

## Consequences

### Positive

- The restart gesture stops discarding work: a fork leaves the original session
  intact, so a user who rewinds by mistake has not lost anything.
- The agent resumes with its **actual** state — reasoning, tool history, working
  context — rather than a re-rendering of the transcript. That is the difference
  ADR 024 item 2 is careful to call out.
- It costs one artifact type through storage that already exists, and uses an RPC
  contract Pi already documents. No new transport, no new credential, no new service.
- Entry ids being durable cursors (`get_entries` supports `since`) is a capability
  this ADR does not use — recorded as a follow-up, because it is what a resumed
  live run would need.

### Negative / trade-offs

- **A fork restores the session, not the workspace.** The pod is re-created and the
  entrypoint **re-clones** the repository (ADR 006 item 6), so the filesystem is the
  branch's current state, not the state at the forked turn. A fork is therefore "the
  same conversation against a fresh checkout", which is honest but is not
  time travel; a reviewer should not read it as restoring uncommitted work.
- **A session only exists if the pod reached a point where one was written.** A pod
  killed early leaves nothing, and this is the case the fallback covers. Persisting
  incrementally *during* a run would narrow it and is a follow-up, not a claim.
- **Compaction means the session is not the transcript.** Pi summarises long
  conversations, so a forked session's context is not a faithful re-reading of every
  turn — a difference the current reconstruction does not have, because it re-renders
  what was actually said.
- **Session files hold the full conversation**, including anything the transcript
  redacts or abbreviates, so the retention window is also a data-retention decision
  and not only a storage one.
- The id spaces still differ (`restartedFromEventId` vs an entry id), so the API keeps
  both fields and they mean different things. Recording that here is cheaper than
  letting a reader assume they are interchangeable.

## Follow-ups (out of scope here)

- **Persist incrementally during a run**, so a pod killed mid-grill still leaves a
  usable session. This is what would make the "unavailable" path rare rather than
  routine.
- **`get_entries`'s `since` cursor** as the basis for resuming a *live* run after a
  reconnect, which is the other thing a durable session makes possible.
- **Surface superseded runs** (issue #28 part 2). Strictly a different change: it is a
  read over history that already exists, and is neither required by nor enabled by
  this ADR. Worth doing independently, since it also improves ADR 024's existing
  rewind, whose discarded conversation is currently write-only.
- **Generalise the fork to `feature_build`.** The same truncation argument applies to
  its seed, and issue #28 records it as unasked-for today.
- **A per-project session retention setting**, if the single window proves wrong for
  either a chatty or a sensitive project.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **Keep only the shipped reconstruction** | It is the fallback, not the answer: ADR 024 item 2 says plainly that what the agent receives is a re-rendering, not its state, and the restart is destructive. This ADR exists because "the real implementation" was named as the goal. |
| **Map grill event ids to Pi entry ids** | The bridge looks obvious and is fragile in the direction that matters: it assumes a one-to-one correspondence between a curated event and a session entry, which compaction, tool-call turns and abandoned branches each break. `get_fork_messages` gives the entry ids directly, so the mapping is never needed. |
| **Store session files in Postgres, as recordings originally were** | The same reasoning that moved recordings to object storage (issue #30) applies with the same force: a session is an unbounded per-run blob, and a database backup should not grow with it. The move is also already done, which is what makes this affordable now. |
| **Keep sessions on the pod's filesystem and reuse the pod** | ADR 006 deletes the Job at the terminal event, deliberately — a pod holds a live GitHub token and the model key, and an idle one is a standing surface. Reusing pods to preserve sessions would undo that decision for a convenience. |
| **Persist the session as `job_events` rows** | One row per token or per turn describes the transcript, not the session: the point of a fork is the state *around* the conversation (branch tree, compaction, tool calls), which the event vocabulary deliberately does not model. |
| **Make the fork the only restart control, replacing the rewind** | It is unavailable exactly when it is most needed — a pod that died, or a session the sweep reclaimed. Removing the reconstruction would remove the fallback and turn a degraded case into no case. |
| **Fork at the assistant's question rather than the user's reply** | `fork` operates on a previous **user message**, so this is not available; and it would be the wrong point anyway, since re-answering a question is the gesture being offered. |

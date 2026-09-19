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

## Implementation status (updated after the work, 2026-09-19)

| Item | State |
|---|---|
| 1 — persist the session per job | **shipped** (`orchestrator` `6cbdd91`, `api` `6304c7f`); the API route is `POST /internal/jobs/:jobId/session` |
| 2 — entry ids from `get_fork_messages` | **shipped.** Capture at collection (`orchestrator` `ecea294`, `api` `b352cb0`, migration 055), and the dispatch that uses them (`api` `a3d00ea`, `web` `a7082bf`) |
| 3 — two controls, only one destructive | **shipped** (`orchestrator` `37b1501`, `api` `d53f12a` + `a3d00ea`, `web` `a7082bf`; migrations 056, 057). "Resume from here" is `POST /projects/:projectId/features/:featureId/resume-from-message`, offering Pi's own reported points as a picker |
| 4 — retention | **shipped** — migration 054, own `SESSION_MAX_BYTES` (5 MB), zero means reclaim-everything |
| 5 — fail honestly | **shipped** for collection (`unavailable` vs `not_collected`, carried through storage, read and UI) and for the fork, which records a `fork_stage` of `write` / `switch` / `fork` |

Two things the implementation settled that this ADR did not anticipate: `get_session_stats`
**also** returns `sessionFile` (and the Orchestrator was already calling it every run, so the
path was in flight rather than needing a new round trip — issue #101), and the fork-point
capture has to be a **sibling route** rather than a field on the session post, because that
request's body is the raw JSONL artifact and base64 would inflate it by a third.

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

**`get_session_stats` also reports `sessionFile`, and this is worth knowing before
you look for a separate call.** The Orchestrator has called that command at the end of
every agent run since ADR 023 landed, so the path is already in flight on a turn it
already opens — the implementation added one line to an existing command batch rather
than a new round trip (issue #101, verified against a real Pi process, Pi 0.84.4 in the
pinned image, not from the docs). This ADR still names `get_state` because that command's
*documented purpose* is the session's state, and reading the session path out of a
*statistics* response would pin us to a by-product. The two agree and there is no window
between them, but a reader choosing between them should know both carry it.

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
| **Resume from here** (new) | forked session continues from that point; the original conversation is untouched | **yes** |
| **Restart from here** (shipped, ADR 024) | rewind + re-seed, as today | only as unread job history |

ADR 024's own trade-offs say the rewind "is approximate, and should be a real fork",
and that a fork would "also let *resume from here* exist as a distinct,
non-destructive control". That is this decision, and it is the product value: the
destructive gesture stops being the only one.

**"Untouched" means the conversation, not the file.** Loading a session makes Pi append
bookkeeping entries to it — a real Pi 0.84.4 process, given a hand-built session file and
asked to `switch_session` to it, appended a `thinking_level_change` entry. Nothing is
truncated and no message is lost, which is the property this row is claiming, but a reader
should not take "untouched" as byte-identical.

**Three behaviours of the real RPC surface that item 3's implementation depends on**, all
captured from that same process rather than from the documentation, and all recorded because
two of them contradict what the ADR would lead an implementer to assume:

- **`switch_session` does not report a missing file as a failure.** Pointed at a path that
does not exist it answers `{"success":true,"cancelled":false}` — no error, no file
  created, and a subsequent `get_state` shows no `sessionFile` and `messageCount: 0`.
  **So `success` cannot be item 5's refusal signal**; a fork must verify `get_state`
  afterwards. That is the difference between "the fork was refused" and "the fork silently
  ran on an empty session", which is precisely the failure item 5 exists to forbid.
- **Responses are not necessarily in send order** once a command touches the session tree —
  sending `fork`, `get_state`, `get_fork_messages` was answered `get_state`,
  `get_fork_messages`, `fork`. Matching each response by its own `command` field is
  therefore load-bearing, and anything reading "the next response" positionally is wrong.
- **`fork` at a valid entry id creates a new file** whose header carries
  `parentSession`, and the forked context ends *before* the fork point — the fork point's
  own text is returned so the caller re-sends it. That is the right semantics for "resume
  from here", and it is `get_state`'s path afterwards that the next collection stores. An
  unknown entry id is an honest failure (`invalid entry id`), unlike the `switch_session`
  case above.

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
- **Surface superseded runs** (issue #28 part 2) — **shipped.** Two routes
  (`GET …/features/:featureId/jobs/:jobId/events` and `…/grill-runs`) and a read-only list
  on the Spec page. The supersession relation is derived from `restarted_from_event_id`
  (`LEFT JOIN`), not stored, and a run replaced by ADR 012's *retry* is deliberately
  labelled differently from one a rewind actually discarded.
- **How a restored session file reaches the fork pod.** **Shipped.** The **Orchestrator
  writes it into the pod** rather than the pod pulling it. The pod runs untrusted code and
  currently calls no internal service, so a pull would add an outbound channel *and* a third
  secret to the least-trusted process — one granting read access to another run's
  conversation. Writing in adds neither, and the exposure is not new: ADR 024's rewind
  already sends the earlier conversation into the new pod, under `GrillTranscriptSummary`.
  The write mirrors `k8s.ReadPodFile` (`cat` over SPDY exec) and takes the same rules — an
  argv slice rather than a shell string, and a bound drawn from `SESSION_MAX_BYTES`.
- **Verifying the switch, not trusting it.** **Shipped** as three conditions, not one: the
  state question was answered, the reported path is the restored one, *and* the session holds
  messages. Each is satisfiable by the failure another catches — a path match passes for a
  file that exists but is empty, and a count alone passes for a session that loaded but is not
  the one named. The write is also `tee` with **no `mkdir -p`**, since a second exec or a shell
  would each violate the argv-slice rule, so the restore path is a `/tmp` location that needs
  no setup and is correctly ephemeral for a one-run input.
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

# ADR 024: Per-message grill restart — "restart from here"

**Status:** Accepted
**Date:** 2026-09-17
**Deciders:** Product session (open-issue burn-down, wave 4)
**Resolves:** `roadmap/open-questions.md` #17 — "Per-message grill resume/restart"
**Builds on:** [ADR 006](006-pi-rpc-orchestrator-integration.md) (the
`spec_grill` RPC session, and mid-run reply as the way a *live* run is steered),
[ADR 012](012-spec-grill-retry-state-reset.md) (retry always dispatches a new
job row; the old one is kept as history, never reused),
[ADR 015](015-six-stage-feature-lifecycle.md) (§5-8: the `specContext` seed that
carries a prior ADR, transcript summary and kickback reason into a fresh
`spec_grill` run), [ADR 028](028-audit-logging.md) (the audit trail the restart
is recorded in)
**Does not touch:** ADR 006's mid-run reply delivery (a live run is still
steered by replying, not by rewinding), ADR 012's retry endpoints (unchanged),
the Orchestrator's RPC machinery (this reuses the existing seed, it does not add
a Pi command)

## Context

The Spec stage's grill transcript is a long, linear conversation, and today the
only recovery from a grill that went wrong is coarse: ADR 012's retry re-runs
the *entire* interview from scratch, and ADR 006's mid-run reply steers a run
that is still going. `design/projects/detail/features/detail/spec` mocks a
third granularity — per-message controls on individual transcript turns — and
its own `.design-note` is explicit that nothing behind them exists: "neither
operates at the granularity of 'one specific message in the middle of the
transcript'. Resume/restart-from-message would need new API surface + a new
Orchestrator/Pi contract this doesn't attempt to design."

That note is right about the shape of the problem, and the obvious
implementation is a real fork: persist Pi's session file, restart the pod,
`switch_session`, and `fork` at an actual entry id. That is a large piece of
work — it needs a durable home for session files that today die with the
ephemeral pod (ADR 006 deletes the Kubernetes Job at the terminal event), plus
a new Orchestrator/Pi contract.

The question this ADR answers is whether the *product* value of "go back to
that point and redo it" requires that machinery, or whether it can be delivered
on top of the seed mechanism ADR 015 already ships.

## Decision

### 1. Deliver "Restart from here" only, as a context-seeded re-run. No true fork.

The feature is implemented by reusing ADR 015's existing `specContext` seeding
path: the feature returns to `draft`, a **new** `spec_grill` job is dispatched
(ADR 012's precedent — a new row every time, the old one preserved as history,
never reused or mutated), and its seed is the earlier conversation truncated at
the chosen turn.

Persisting Pi session files, `switch_session`, and `fork`-at-entry-id are
**out of scope** and are recorded under Follow-ups as the real implementation
of this idea. Nothing in this ADR persists session files.

### 2. The restart context is a reconstruction, not the original session — and the ADR says so plainly.

This is the central honesty of the decision. The agent is stateless per run and
only ever sees its seed, so what it receives is a **re-rendering of the turns
before the chosen one**, not the conversation that actually happened. Three
things are therefore lost, and none of them are recoverable from the API side:

- **Tool-call side effects already applied to the workspace.** `spec_grill`
  runs read-only (ADR 005), so today this is mostly moot — but the transcript
  never recorded a file's contents, only that the agent read one, and the new
  run re-explores from scratch rather than resuming an exploration.
- **Reasoning the transcript does not contain.** Only assistant *prose* and
  `ask_user` questions are kept (see item 4). Anything the model decided
  without saying — the shape of a rejected approach, why one design was
  preferred — is gone even if it was in the previous run's context.
- **The model's own working state.** Compaction history, the branch structure
  of its session, any internal summary: none of that travels. A fork would
  preserve it; this cannot.

This is acceptable *because of what the feature is for*. It is a convenience
for "that went the wrong way, let me try again from a better point", where the
user's expectation is a fresh run informed by what was already discussed — not
"resume exactly where I was, state intact". A user who wants literal continuity
is served by ADR 006's mid-run reply (while the run is live) or by ADR 012's
retry (which reuses the whole transcript as a summary). The ADR states the
limitation rather than presenting the re-run as a fork, so nobody builds on it
expecting the session to be restored.

### 3. Boundary semantics: the chosen turn is excluded, and everything before it is kept.

"Restart from here" on turn N yields a seed of the turns *strictly before* N.
The chosen turn is the first thing redone.

Exclusive rather than inclusive is a deliberate reading of the phrase, and it
is the more useful one in each direction: clicking the agent's question at N
re-asks that question (including it would hand the agent its own question with
the user's answer already in place), and clicking a user reply at N makes the
agent respond to it afresh. Restarting from the *first* turn therefore yields
an empty transcript — a clean restart, which is the correct degenerate case, not
an error.

### 4. Only conversation turns are valid boundaries.

`agent_text`, `ask_user`, and `user_message` can be restart points.
`submit_adr`, `run_failed`, and `run_cancelled` cannot: they are system or
terminal markers, not points in the conversation, and "restart from" one of
them would not identify anything to redo. They are rejected with a 404 rather
than silently coerced to the nearest turn.

The summary itself reuses ADR 015's existing renderer, moved into a shared pure
module (`api/src/jobs/grill-context.ts`) rather than reimplemented — one
spelling of "how a grill transcript becomes seed prose", with the same 12k
character cap and the same tail-keeping truncation. Keeping the *tail* is
correct for a prefix as well: the turns nearest the boundary are the ones the
new run needs.

### 5. Boundary of *when*: only while the feature is still in Spec, or stopped.

Allowed: `draft`, `spec_ready`, `failed`, `cancelled`. The transition is a
guarded `UPDATE ... WHERE status = ANY(...)` (ADR 011's precedent), so a
feature that moves on between the checks and the write is refused rather than
silently rewound, and no grill run is dispatched for it.

Refused: `queued`/`running`/`testing`/`agentic_review`/`in_review`/`merged`
(work is in flight, or scope is already agreed and built) and `returned` (ADR
015 gives it its own explicit resume/kickback affordances). Also refused: any
feature whose **latest job is not a `spec_grill`** — a failed `feature_build`
also leaves a feature `failed`, and its event stream is not a grill transcript.
And refused while a grill job is actually running, because ADR 006's mid-run
reply already steers a live session and rewinding underneath one would race the
agent still writing to the transcript.

The refusal is a single predicate with a single set of reasons
(`messageRestartRefusal`), which the route returns and the Web app's own
predicate mirrors. Two independent copies of these conditions would eventually
disagree about which one failed.

### 6. The seed carries no previous ADR.

`previousAdrMarkdown` is empty on this path. An ADR is the *last* output of a
grill run, so in a rewind it is always downstream of the boundary and is
discarded with the rest of the tail. Keeping it would be incoherent in the
other direction too: the feature returns to `draft` with `adr_approved = FALSE`,
so a seed asserting "previously approved ADR" would contradict the state the
user is looking at.

The practical consequence — rewinding discards an ADR that may already have been
approved — is exactly why the UI requires explicit confirmation (item 9).

### 7. The seed is the existing shape plus one discriminator flag.

`specContext` gains a single boolean, `restartFromMessage`. Everything else is
ADR 015's existing fields, unchanged. It carries no action items and no design
snapshots, because nothing after the boundary survives.

The flag is not cosmetic. The Orchestrator words its prompt from this seed, and
its kickback wording — "a continuation of an earlier specification run",
"Implementation kickback reason", "preserve useful decisions from the context
below" — describes a *blocked implementation*, which is not what happened. Over
a transcript that simply stops mid-conversation, that wording would push the
agent to treat an unfinished discussion as settled context and quietly preserve
decisions the user deliberately rewound past. So the prompt branches on the
flag, and the branch has its own test asserting the kickback phrasings are
*absent*.

### 8. A job records which turn it rewound to.

`jobs.restarted_from_event_id` (nullable, `REFERENCES job_events(id) ON DELETE
SET NULL`) holds the chosen turn. The seed cannot serve this purpose: it lives
in `jobs.spec_context`, a JSONB blob that can carry a whole previous ADR and
transcript and is deliberately never exposed publicly.

Two reasons it is worth a column. The audit trail can say *how far* a grill was
rewound, not merely that it was. And the Web app can explain itself: after a
restart, the events endpoint returns the **new** job's events, so the page shows
a fresh, empty transcript — without a marker the earlier conversation appears to
have simply vanished. `ON DELETE SET NULL` is defensive: nothing deletes a job
event on its own today, but a restarted run must not be destroyed because the
turn it referenced went away.

### 9. The UI requires deliberate confirmation.

The control renders only where the API would accept it, and the first click
opens an explanation rather than sending anything; the second performs the
restart. The copy names what is lost (the conversation after that turn, and the
ADR if one exists) instead of asking a bare "are you sure?".

The gate is a pure module (`web/lib/features/grill-restart.ts`) so it is
unit-testable — this repo has no component testing library.

### 10. Authorization and audit reuse what exists.

The route uses the same project-access gate as every other feature mutation
(`getOwnedProject`), the same model-config resolveability check the other
`spec_grill` dispatches use, and records ADR 028's
`feature.grill_restarted_from_message` with the chosen turn in its metadata. No
new capability is invented.

It is recorded separately from `feature.grill_retried` because the two discard
very different amounts of work: a retry re-runs the interview from scratch, a
rewind keeps everything before the chosen turn.

### 11. "Stop" was already built; nothing was added for it.

The design note for the mock observes that Stop "already has a real landing
spot — `feature-lifecycle.md`'s `cancelled` state exists today for exactly
this". That is accurate: the grill page's existing Cancel control calls the
feature-cancel route, which flips the feature to `cancelled` synchronously and
cancels the outstanding job. This ADR therefore adds only the rewind, and the
"Stop" half of the mock is satisfied by an existing control.

### 12. Known drift from the `design/` wireframe (ADR 017).

ADR 017 makes `design/` source-of-truth for IA, so the deviation is recorded
rather than left implicit:

- The mock shows **two** controls per turn, "Resume from here" and "Restart
  from here". Only Restart is built — Resume is out of scope per item 1.
- The mock renders both controls on **every** turn unconditionally. Real
  controls appear only where the API would accept them (a conversation turn, on
  a feature still in Spec), because an unactionable control that returns a 409
  is worse than an absent one.
- The mock has no confirmation step; the real control has one (item 9).

The route itself is unchanged — this is a detail view of the existing Spec
stage, not a new page — so the route-map parity ADR 017 establishes is intact.

## Consequences

### Positive

- The "go back to a better point and redo it" affordance exists without new Pi
  contract work, new storage, or a new pod-lifecycle problem.
- It reuses ADR 015's seed end to end: the same `specContext` field, the same
  renderer, the same Orchestrator consumption path. Nothing about how a seeded
  grill run works had to change.
- The honest framing (a reconstruction, not a fork) sets the right expectation
  for both users and future implementers, and the deferred real implementation
  is already scoped.

### Negative / trade-offs

- **The restart is approximate.** Per item 2, the new run does not inherit the
  old session's reasoning, working state, or exploration; it re-derives them
  from a summary. A user expecting a true fork will find it coarser.
- **An approved ADR can be discarded by one confirmed click**, deliberately.
  The confirmation and the audit row are the mitigations, not a prevention.
- **The superseded transcript is not shown.** After a restart the events
  endpoint returns the new job's events, so the earlier conversation leaves the
  screen entirely; only a note says it happened. The rows are still in the
  database (ADR 012's history), but no UI reads them by job id.
- **Only `spec_grill` participates.** `feature_build` and the other agent kinds
  have their own seeds but no per-message control; extending it would need the
  same kind check the events endpoint now exposes (`jobKind`).
- **Two predicates, one behaviour.** The API and the Web app each gate the
  control; they mirror one another by construction and by test, but they are
  separate code in separate repos, so a future change must remember both.

### Follow-ups

- ~~**The real implementation: persist Pi's session file and fork at a genuine
  entry id.**~~ **Decided in [ADR 032](../adr/032-durable-pi-sessions-and-true-fork.md)**
  (issue #28 part 1). That ADR answers the decision this follow-up asked for —
  session retention, and the Orchestrator/Pi contract — and records two things
  worth knowing from here:

  - **The contract needed no designing.** `switch_session`, `fork`,
    `get_fork_messages` and `get_state` are all documented RPC commands in Pi's
    `docs/rpc.md`, not a surface to be invented. The blocker was always the durable
    home, which issue #30's object storage has since supplied.
  - **The entry ids come from `get_fork_messages`**, not from a mapping between
    this ADR's `restartedFromEventId` and a Pi entry id. Those are different id
    spaces, and a bridge between them would have been fragile in exactly the way
    that matters — that is the single most useful thing ADR 032 settles.

  ADR 032 keeps this ADR's reconstruction rather than replacing it: a true fork is
  unavailable precisely when it is most wanted (a pod that died, or a session the
  retention sweep reclaimed), so the seeded re-run remains the fallback.
- **A member-visible history of superseded runs.** The rows exist; nothing
  surfaces them, so the earlier conversation is effectively write-only today.
- **Surface that a build resolved conflicts / a run was rewound** in the
  product's own event stream (a curated event), rather than only in the audit
  trail and a UI note.
- **Generalize the rewind to `feature_build`** if per-message control turns out
  to be wanted there — the same truncation would apply to its seed.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **True fork now**: persist session files, `switch_session` + `fork` at an entry id (ADR 006's machinery) | The right end state, but it needs durable session storage that does not exist today (sessions die with the ephemeral pod) plus a new Orchestrator/Pi contract. Deferred, not rejected — recorded as the primary follow-up. |
| **Retry the whole grill** (existing ADR 012 endpoint) | Already exists, and is exactly the coarseness this removes: it re-runs the interview from scratch, making the user repeat settled answers. This ADR is the middle ground between it and a fork. |
| **"Resume from here" (inclusive boundary)** | Would hand the agent its own question already answered, turning a redo into a continuation. Also raises a question with no good answer: what does resuming mid-turn mean for a job that is not running? |
| **Let the agent itself decide what to keep** (pass the full transcript and ask it to ignore the tail) | Cost grows with every run, and it makes correctness depend on the model obeying an instruction rather than on truncation being structural. |
| **A per-message control for every job kind** | Each agent kind has a different seed and a different notion of a "turn" (a build's transcript is not a conversation). Scoping to `spec_grill` keeps the boundary rule meaningful. |
| **No confirmation click** | The action discards work irreversibly and can drop an approved ADR. A single unconfirmed click next to every transcript bubble is a mis-click waiting to happen. |

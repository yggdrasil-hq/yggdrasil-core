# ADR 020: Design persistence and browse/history

**Status:** Accepted
**Date:** 2026-09-17
**Deciders:** Product session (open-issue burn-down, wave 3)
**Builds on:** [ADR 014](014-design-grill-live-mockups.md) (the `design_grill`
job kind, its curated events, and the `designs/<slug>/` repo convention this
index points at), [ADR 002](002-projects-features-tests.md) (the Feature/Test
entity patterns the design entity mirrors in spirit), [ADR 015](015-six-stage-feature-lifecycle.md)
(`specContext` — the "this is a continuation of an earlier run" framing reused
in item 5), [ADR 028](028-audit-logging.md) (the audit actions this adds, and
whose out-of-scope row for design sessions this removes)
**Does not touch:** ADR 014's job-backed session, snapshot events, image/skill
or RPC path (all unchanged — this adds an index beside them), ADR 021
(parallel-feature branches — designs are not feature branches), `design/` (no
wireframe exists for the browse index; recorded as ADR 017 drift in item 9)

## Context

ADR 014 shipped `design_grill` as a **job kind**: a live session where an agent
authors self-contained HTML mockups, commits them under the project's
`designs/<slug>/` folder, and opens a draft PR on finalize. What it deliberately
left open
(`roadmap/open-questions.md` #12, issue
[yggdrasil-core#13](https://github.com/yggdrasil-hq/yggdrasil-core/issues/13))
was whether a design becomes a persisted DB entity or `designs/` stays a pure
repo convention with no row in Yggdrasil's own database.

That question had a concrete cost. A design's entire identity lived on the
`design_grill` **job row** (`design_name`, `design_slug`, `design_description`),
and the Web app's only design route was `/designs/:sessionId`, where `:sessionId`
is a job id. So a design was addressable only while you still held its session
id: there was no way to list a project's designs, no history, and no way to open
an existing design. Issue
[yggdrasil-core#2](https://github.com/yggdrasil-hq/yggdrasil-core/issues/2)
(browse/history and re-open) was blocked on that.

Two facts constrain the answer:

1. **The artifact is already committed.** ADR 014's skill commits
   `designs/<slug>/` and opens a draft PR itself. The repo is the source of
   truth for the mockup, and the PR is how a human views it.
2. **Every design that exists today was produced by a session.** That is the
   only supported way to make one, and every such session already carries its
   design's name, slug and description on its job row.

## Decision

### Index, not storage

1. **A `designs` table is the index; the artifact stays in git.** The row holds
   identity, lifecycle, and the draft PR that carries it — never the mockup's
   content. Copying HTML into Postgres would create a **second source of truth**
   for a file that is already committed, versioned, and reviewed through a PR,
   and would immediately raise a sync problem: which copy wins when the branch
   moves, and what happens to the row when the PR is closed unmerged? The repo
   answers all of that already. Postgres is asked only the question git is bad
   at — "which designs does this project have, and what state are they in?"

2. **The natural key is `(project_id, slug)`, not a surrogate identity.** The
   slug *is* the artifact's identity on disk: `designs/<slug>/` is one folder
   per design, so `(project_id, slug)` is already unique in reality. Making it
   the key means **starting a design and re-opening one are the same operation**
   — the same upsert — and a duplicate index row for one folder is
   unrepresentable rather than merely discouraged.

3. **Status is `in_progress` | `finalized`, and nothing else.** Read from what
   the shipped flow actually does: a session either ends by calling
   `submit_design` (which has committed the folder and opened its draft PR) or
   it doesn't. Run outcome for the newest session — `failed`, `cancelled`,
   `running` — is **read through from that session's job row** and shown beside
   the design, never mirrored into this column: the job already owns run status,
   and a second copy could disagree with it. `finalized` is terminal; a later
   session iterating the same folder does not un-finalize a design that has
   already been committed.

### Write path

4. **The row is written at two moments, both already-existing flows.**
   `POST /projects/:id/designs` upserts the row as `in_progress` and links the
   session to it; the `submit_design` handler (reached through the internal
   job-event route) upserts it as `finalized`, recording `pr_url` and
   `finalized_at`. No new lifecycle, no new endpoint, no new job kind.

   Both writes are **best-effort**: the session job is already dispatched and
   genuinely running, so failing the request would report a failure the user
   cannot act on, and `submit_design` arrives on a path with no client waiting
   on it. This is safe because the finalize write is an upsert **keyed by
   `(project_id, slug)`** rather than by a design id — so a session whose index
   row was lost at start still lands a correct, finalized row at exactly the
   moment the design becomes worth browsing.

5. **Re-opening seeds the new session with the previous one's context.** The
   create form is pre-filled from the saved design and **carries the slug
   through** — the slug is what selects both the existing folder and the
   existing index row, so it must survive a name edit rather than being
   re-derived from it. The pod is then told it is continuing an existing design,
   via the same framing ADR 015 established for a re-grill, including the
   previous session's draft PR and the list of files it committed.

   Delivery detail worth stating plainly: `buildDesignGrillPrompt` renders only
   the design's name, slug and brief, so the continuation context is composed
   **into the brief** by the API (`api/src/designs/brief.ts`) rather than sent
   as a structured `specContext`-shaped field. A dedicated channel would be
   tidier, but the design prompt never reads one today; adding it is an
   Orchestrator change and is listed under Follow-ups. The composition is a
   pure function so it is unit-tested without a pod or a database.

### Read path

6. **Browse and history are two read-only endpoints** on the existing
   `/projects` mount: `GET /projects/:id/designs` (a project's designs, most
   recently touched first, each with its latest session folded in via a
   `LATERAL` join rather than N+1 queries) and
   `GET /projects/:id/designs/:designId` (one design plus every session that has
   worked on it). Authorization is **project membership**, matching how a
   project's features and tests are read — every query is scoped by the resolved
   project id, so a design cannot be reached through another project or another
   organization by guessing its id.

   History is read through `jobs.design_id`, a nullable FK set when a session
   is indexed, so a design's sessions are one indexed lookup instead of a slug
   join.

### Existing data

7. **The migration backfills the index from job history, because the
   alternative is an empty browse view on every existing project.** All the
   needed data is already persisted — every `design_grill` job carries its
   design's name/slug, and every `submit_design` `job_event` carries the PR url
   and the finalized snapshot. The backfill groups by `(project_id, slug)`, takes
   the **earliest** session as the origin, marks the design finalized if **any**
   session submitted, and then points every existing session at its row.

   **Designs with no row at all, and what browse shows for them.** After this
   change the index is complete for every design produced by a session, past or
   future. It is *not* complete for a `designs/<slug>/` folder committed
   **by hand**, outside any session: there is no job, so there is no row and
   nothing to derive one from. Discovering those would require reading repo
   contents over the GitHub API — a genuinely larger feature than an index, and
   one that would also have to decide what a hand-committed folder's *name* even
   is. The decision here is to **show the gap rather than hide it**: the empty
   state states plainly that designs committed directly to the repository
   without a session are not listed. A silently empty index is the outcome this
   item exists to prevent; a labelled one is a known boundary.

### API surface

8. **Two new Web routes, and the live-session route moves.** `/designs` is the
   browse index, `/designs/new` starts a session (with `?reopen=<designId>` for
   the re-open flow), and the session transcript moves from `/designs/:sessionId`
   to **`/designs/sessions/:sessionId`**. The move is what makes the URL space
   unambiguous: a design id and a session id are both uuids in the same path
   position, and resolving that by "look it up and see which table answers"
   would be a guess dressed as routing. Reserving the `sessions` segment removes
   the ambiguity by construction. Old `/designs/:sessionId` links are not
   preserved — pre-launch, and the alternative is permanent ambiguity.

9. **Known ADR 017 drift:** `design/` has no browse-index wireframe (its map has
   project tests but no designs section). The pages are built from the existing
   shell, tokens and primitives in the same style as their siblings, and a
   `design/` pass is owed so the source-of-truth-for-IA claim stays true.

## Consequences

### Positive

- Issue #2 (browse/history and re-open) becomes implementable, and open question
  #12 is resolved: a Design is a persisted DB entity — **as an index**, which is
  the answer that does not fork the source of truth.
- A design is addressable by a stable id and a slug, independent of any session,
  so history survives across sessions and multiple sessions per design are
  representable.
- Re-opening is not a new flow: it is the ordinary create path with a slug
  carried through, which is what makes "iterate on the existing folder" work
  without the agent inventing a parallel one.
- The backfill means the feature is useful the day it ships, on projects that
  already have designs.

### Negative / trade-offs

- **A second store to keep honest.** The index can drift from the repo — a
  folder deleted or renamed by hand leaves a stale row. Nothing reconciles that
  today; the row is a pointer, and a broken pointer is visible as a dead PR link
  rather than as a silent wrong.
- **Best-effort writes can be lost.** A failed index write at session start
  means the design does not appear in browse until it finalizes (finalize
  upserts, so it is not lost permanently). Accepted because the write failure
  path is a database problem in which the request has almost certainly failed
  earlier anyway.
- **The re-open context rides in the brief**, which is a presentation field.
  It works and it is framed exactly as ADR 015 frames a re-grill, but a reader
  of the brief sees agent guidance mixed with the user's words.
- **Hand-committed designs are invisible** (item 7). Documented and surfaced in
  the empty state rather than solved.
- **A URL moved.** `/designs/:sessionId` → `/designs/sessions/:sessionId`.
  Cheap now, breaking later, which is the argument for doing it now.

## Follow-ups

- **A structured continuation channel for the design prompt** in the
  Orchestrator (`buildDesignGrillPrompt` reading a `specContext`-shaped field),
  so re-open context stops living inside the brief.
- **A `design/` wireframe** for the browse index and detail page, closing the
  ADR 017 drift recorded in item 9.
- **Reconciliation for hand-committed designs**, if it is ever wanted: a
  repo-contents read to discover `designs/*/` folders with no row. Explicitly
  not attempted here.
- **Submodule/`designs/` scaffolding and `feature-grill` discovery** remain
  ADR 014's implicit-discovery story, unchanged.
- **`design_grill` still has no feature tier for model configuration** — a
  design job carries no `feature_id` by design (ADR 014 keeps sessions
  project-scoped), so this index does not change that; giving design jobs a
  feature identity is a separate decision.

## Alternatives considered

| Alternative | Why not |
|---|---|
| **No table — `designs/` stays a pure repo convention, browse reads the repo via the GitHub API.** | Answers "which folders exist" but not "what happened to them, when, by which session, with which PR". It also puts a repo-contents call on the critical path of a list view, and gives every design a name derived from a folder path. |
| **Store the mockup HTML in the database.** | Creates a second source of truth for content that is already committed, versioned and PR-reviewed, plus a sync problem in both directions. The banner is explicit that the row is an index, not a copy. |
| **Keep the job row as the identity; list `design_grill` jobs instead of adding a table.** | A job is a *run*, not a design. Two sessions on one design would appear as two designs, and there would be nowhere to hang `pr_url`/`finalized_at` that survives a retry. |
| **Mirror the session's run status (`failed`/`cancelled`) into the design's own status.** | Two spellings of one concept that can disagree. The job owns run outcome; the design owns artifact lifecycle. |
| **`/designs/:id` for the design, keeping `/designs/:sessionId` for sessions.** | Both ids are uuids in the same position. It works only by lookup-and-hope, and fails in the confusing direction (a session id that happens to match nothing renders as "design not found"). |
| **Require every design to be created through a session, and reject hand-committed folders.** | Not enforceable — anyone can commit to their own repo — so the honest version is to document the boundary (item 7) rather than pretend it does not exist. |

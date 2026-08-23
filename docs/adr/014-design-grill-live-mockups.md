# ADR 014: `design_grill` — agent-authored live HTML mockup sessions

**Status:** Accepted
**Date:** 2026-08-23
**Deciders:** Product/design session (grill-with-docs)
**Builds on:** [ADR 002](002-projects-features-tests.md) (projects/features/tests,
job kinds), [ADR 003](003-orchestrator-kubernetes.md) (Kubernetes compute,
Helm/local-dev split), [ADR 004](004-agent-base-containers.md) (agent base
containers, skills, `yggdrasil-contract` extension), [ADR 005](005-github-app-repository-access.md)
(GitHub App, container access tiers), [ADR 006](006-pi-rpc-orchestrator-integration.md)
(Pi RPC attach/turn machinery, curated events), [ADR 008](008-project-init-grill-and-submodule-repos.md)
(`project_init` structure standard, repo-relationship interview)
**Amends:** ADR 008 item 3 (`project-init`'s interview gains a conditional
`designs/` scaffold branch) and item 6 (structure-standard checklist); ADR 002's
job kinds table (adds `design_grill`)

## Context

The product needs a way to design a web/mobile UI *before* committing to how
many features it becomes — sketching a settings page, a checkout flow, or a
modal's states as plain, throwaway-cheap HTML/CSS mockups, iterated live in
conversation with an agent, then referenced later when a real feature actually
builds the page. Nothing in the existing job model (`spec_grill` → ADR,
`feature_build` → code + PR, `test_run` → verification report) fits: a design
isn't a spec (no codebase-grilling, no build step to gate behind review) and
isn't a build (nothing to implement — the chat output *is* the artifact).

Reached via a `grill-with-docs` session against this suite's own domain model.
Key constraints surfaced there:

- Designs are **plain, self-contained HTML mockups with no app logic** —
  static markup/CSS, at most vanilla `<script>` for demonstrating an
  interaction state (a tab switch, an accordion). No framework, no build
  step, no network calls.
- The session should feel **live**: a chat on one side, a preview that
  updates as the agent writes, right up until you say it's done.
- A finalized design needs to be **discoverable later**, when a real feature
  is being grilled/built for that same page/widget.

## Decision

### New job kind: `design_grill`

1. `design_grill` is a new job kind, sibling to `spec_grill`, reusing ADR
   006's attach/RPC machinery **wholesale**: the internally-concurrent worker
   model, one-attach-call-per-turn, `Client.BeginTurn`/`Send`/`EndTurn`,
   curated-event translation, Postgres `LISTEN`/`NOTIFY` mid-run reply
   delivery, and `POST /:projectId/features/:featureId/cancel`-style
   cancellation. No new transport code — only a new skill, a new terminal
   contract tool, and one new non-terminal one (item 4).
2. New per-job-kind image, `agent-images/design_grill/` (ADR 004's
   one-Dockerfile-per-job-kind convention), with its own skill,
   `design-grill/SKILL.md`, loaded on top of the shared common base layer and
   the `yggdrasil-contract` extension.
3. **Container access tier:** `design_grill` gets a **write-scoped**
   installation token (`contents: write` + `pull-requests: write`), minted
   the same way `feature_build`'s is (ADR 006 item 5's refinement, ADR 010
   item 3) — a new precedent, since write access was previously
   `feature_build`-only. All linked repos are still cloned (ADR 002 item 3,
   uniform across job kinds), even though only the primary repo is ever
   written to.

### Contract tools

4. Alongside the existing `ask_user` (mid-session clarifying questions, ends
   the turn not the run), `design_grill` gets:
   - **`update_design_preview`** (non-terminal) — called whenever the agent
     changes file content during a turn. Payload is the **full current
     snapshot**: every path under the session's design folder mapped to its
     full content, not a diff. Relayed as a new curated event through the
     existing `POST /internal/jobs/:id/events` pipeline.
   - **`submit_design`** (terminal, ends the run like `submit_adr`) — the
     finalized snapshot. Triggers the commit (item 8).

### Live preview: no hosting, client-side sandboxed render

5. No ephemeral deployment, no preview tunnel (unlike `test_run`/
   `feature_build`, which exist to run a *real built app*). The Web app polls
   the feature/design's events (reusing `spec_grill`'s existing 2s-poll
   pattern, ADR 006 item 15) and renders the latest `update_design_preview`
   snapshot in a **tabbed, sandboxed iframe** — one tab per file path,
   `<iframe sandbox="allow-scripts" srcdoc="...">` (no `allow-same-origin`,
   so any mockup `<script>` can't read/write anything outside the iframe).
6. One session can produce **multiple related files**, grouped under
   `designs/<slug>/` (a folder per session) rather than a single flat file —
   e.g. `designs/checkout/page.html` + `designs/checkout/modal.html` from one
   grill about a related flow.

### The "no logic" boundary is a prompt instruction, not a runtime restriction

7. HTML + CSS + self-contained vanilla `<script>` is allowed for simple
   interaction states; no framework, no build step, no `fetch`/network calls.
   This is enforced by `design-grill/SKILL.md`'s system prompt, the same way
   other skill boundaries are — nothing in the container or the iframe sandbox
   *prevents* the agent from writing a network call, it just isn't asked to.
   The iframe sandbox (item 5) limits blast radius if it ever does, but isn't
   a content filter.

### Kickoff and finalize: single-phase, no separate approval gate

8. Starting a session needs a **name/slug + initial description** (unlike
   Feature's title-only creation) — the description seeds the first turn's
   prompt so the session doesn't waste a round-trip on "what do you want to
   design?" On `submit_design`, the **same session** commits: branch
   `yggdrasil/design-<slug>-<id>` on the primary repo, files written under
   `designs/<slug>/`, a PR opened — mirroring `feature_build`'s commit shape,
   but with **no separate spec/build split**. A design has no implementation
   gap to gate behind human review the way Feature's ADR-vs-code split does;
   the chat's own output is the whole artifact.
9. **Designs are re-openable.** A later `design_grill` session started
   against an existing slug clones that folder's current state on `main` as
   its starting point and, on `submit_design`, produces a new branch/PR —
   git history carries the design's evolution the same way it would for any
   other file. (Re-opening always starts from `main`, not from a specific
   prior job's output — see Consequences on concurrent sessions.)

### `project_init` scaffolds `designs/` conditionally

10. `project_init`'s repo-relationship interview (ADR 008 item 3, step 3)
    gains one more branch: **does this project have a web/mobile/user-facing
    interface?** If yes, the resulting ADR scaffolds an empty `designs/`
    directory and the project record gets a `has_design_surface` flag set
    true; if no (e.g. a pure API/library project), `designs/` is never
    created and the Web app never offers a "New design" action for that
    project. This extends the structure-standard checklist (ADR 008 item 6).
11. `design_grill` is gated the same way Tests are (ADR 002 item 25): only
    usable once the project is **`ready`** *and* `has_design_surface` is
    true — `designs/` doesn't exist in `main` until `project_init`'s
    `feature_build` has actually merged it there.

### Referenced implicitly by later features

12. `feature-grill`'s skill prompt (ADR 008 item 4) gains one added
    instruction: check `designs/` for a relevant existing mockup during its
    normal codebase exploration, same posture it already has toward
    `docs/CONTEXT.md`/`docs/adr/`. No structured link, no new field on
    Feature — the agent discovers a design the same way it discovers any
    other file in the repo. `implement` (`feature_build`'s skill) needs no
    change: by the time it runs, any design usage is already captured in the
    approved ADR text itself, which `feature-grill` is responsible for
    noticing and writing down.

### Left open

13. **Whether a Design becomes a persisted DB entity** — its own table, a
    lifecycle, a list/browse view (mirroring how Feature and Test both are
    modeled) — or whether `designs/` stays a pure repo convention with
    `design_grill`'s job/event machinery as the only mechanism, and no row in
    Yggdrasil's own database ever represents "a design" as an object. This
    ADR ships the job kind, commit/PR shape, and live-preview mechanics
    without forcing that call either way — nothing here depends on it.
    Tracked as `roadmap/open-questions.md` #12.

## Consequences

### Positive

- Reuses ADR 006's transport layer wholesale — no new attach/turn/event/
  cancellation code, only a new skill, one new terminal contract tool, and
  one new non-terminal one.
- No new hosting infrastructure: the live preview rides on the same polling
  plumbing `spec_grill` already has, at zero extra infra cost, appropriate
  for content that's just markup with no build step.
- Single-phase finalize avoids inventing a redundant approval gate for an
  artifact with no implementation step to gate.
- `project_init`'s existing repo-relationship interview absorbs the one new
  question needed (does this project have a UI) instead of a separate
  interview flow.

### Negative / trade-offs

- **Second write-scoped job kind.** `design_grill` widens what was previously
  a `feature_build`-only access tier. Container isolation (ADR 003's
  sandboxed RuntimeClass), not an in-band approval gate, remains the actual
  security boundary — same posture already stated for RPC mode generally
  (`docs/concepts/pi-agent.md`).
- **"No logic" is a prompt convention, not enforced.** See item 7 — a
  design's self-contained/no-network constraint is only as reliable as the
  skill's system prompt.
- **Design persistence is explicitly unresolved** (item 13) — a browse/list
  UI for existing designs, and any structured (non-implicit) way for a
  feature to reference one, are both blocked on that decision.
- **No conflict handling for concurrent re-opens.** Two overlapping
  `design_grill` sessions against the same slug both start from `main` and
  could produce conflicting PRs if both are open at once — the same
  unresolved class of risk ADR 002 already accepts for `feature_build`
  (`roadmap/open-questions.md` #5, branch conflicts), not newly introduced
  here.

### Follow-ups (out of scope here)

- Resolve the Design-persistence open question (`roadmap/open-questions.md` #12).
- A Web app surface for browsing/listing existing designs — depends on the above.
- A structured (non-implicit) way for a feature to reference a specific
  design, once the entity question resolves.
- WebSocket relay for the live preview — inherits the suite-wide 2s-poll
  posture ADR 006 (items 8, 18) already deferred; not solved specially here.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Reuse `spec_grill` as a "mode" instead of a new job kind | Would fork skill selection a third way and make container access tier per-run instead of per-image; a distinct job kind keeps ADR 004's per-kind image/tier model intact |
| Real hosting via ephemeral preview tunnel (`test_run`-style) | Unnecessary infrastructure for self-contained static HTML with no build step; client-side iframe rendering reuses existing polling plumbing for free |
| Two-phase design/build split mirroring Feature | No implementation gap exists between "design agreed" and "design committed" — a second phase would be process for its own sake |
| Decide Design persistence now, one way or the other | Genuinely undecided by the product owner; shipping the mechanism without forcing the call keeps both paths open |
| Scaffold `designs/` unconditionally on every project | Wastes an empty, misleading directory (and a meaningless "New design" affordance) on projects with no UI, e.g. a pure API/library project |

Implementation reference: `docs/concepts/job-dispatch.md`,
`docs/concepts/pi-agent.md`, `docs/adr/008-project-init-grill-and-submodule-repos.md`.

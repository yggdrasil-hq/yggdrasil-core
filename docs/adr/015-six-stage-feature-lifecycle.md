# ADR 015: Six-stage feature lifecycle — Action Items, Testing, and Agentic Review

**Status:** Accepted
**Date:** 2026-08-30
**Deciders:** Product/design session (grill-with-docs)
**Builds on:** [ADR 002](002-projects-features-tests.md) (projects/features/tests,
job kinds, feature lifecycle states), [ADR 004](004-agent-base-containers.md)
(agent base containers, one-Dockerfile-per-job-kind), [ADR 005](005-github-app-repository-access.md)
(GitHub App, container access tiers), [ADR 006](006-pi-rpc-orchestrator-integration.md)
(Pi RPC attach/turn machinery, curated events), [ADR 008](008-project-init-grill-and-submodule-repos.md)
(structure standard — `setup.sh`/`run.sh` convention), [ADR 010](010-feature-build-rpc-wiring.md)
(`feature_build` RPC wiring, `submit_build_result`), [ADR 012](012-spec-grill-retry-state-reset.md)
(retry semantics — new job row, feature status reset), [ADR 013](013-pr-merge-webhooks.md)
(PR-merge/review webhooks, `changes_requested`), [ADR 014](014-design-grill-live-mockups.md)
(`design_grill`, precedent for adding a new job kind)
**Supersedes:** ADR 002 §"Feature workflow"/"Feature lifecycle states" (the
`draft → spec_ready → queued → running → in_review → merged` model and the
`changes_requested` state). ADR 002's project/repo/test model is untouched.
**Amends:** ADR 008 item 6 (structure-standard checklist gains two optional
scripts)

## Context

`design/projects/detail/features/detail/*` sketched a six-stage feature
lifecycle — **Spec → Action Items → Implementation → Testing → Agentic
Review → Manual Review** — replacing ADR 002's three-phase model, with
failures at Testing, Agentic Review, or Manual Review routing back to
Implementation with a comment instead of failing outright. The wireframes
were deliberately uneven in how grounded each stage was (see each page's own
`.design-note`, and `roadmap/open-questions.md` #14): Manual Review was
basically a relabel of existing states; Action Items, Testing, and Agentic
Review ranged from "small extension of something real" to "invented from
nothing." This ADR resolves the actual mechanics for all six stages —
reached via a `grill-with-docs` session — as a single coherent decision,
even for the pieces that won't be built immediately.

## Decision

### Overall shape: mostly the same states, three new ones, one retired

```
draft → spec_ready → queued → running → testing → agentic_review → in_review → merged
  │         │(*)         │        │         │            │              │
  │         │            │        └─►returned◄───────────┴──────────────┘
  │         │            │        (reason: test_failure | agentic_review | human_review)
  │         │            └─►failed   (generic crash/bug — unchanged, ADR 012 retry)
  │         └─►cancelled
  └─►cancelled

returned → [human clicks "Resume implementation"] → queued
```

1. Three new states: `testing`, `agentic_review`, `returned`. One retired:
   `changes_requested` is replaced by `returned` (see item 9). Everything
   else (`draft`, `spec_ready`, `queued`, `running`, `failed`, `cancelled`,
   `in_review`, `merged`) is unchanged from ADR 002.
2. (*) **"Spec" and "Action Items" are both the `spec_ready` state** — Action
   Items is a UI view of `spec_ready`, not a new DB state, where "Start
   build" stays disabled until every Action Item on the current batch is
   resolved. This mirrors how "Manual Review" is a UI grouping of
   `in_review`/`returned`/`merged`, not new states either.
3. `testing` and `agentic_review` are **auto-entered, no human gate**:
   Testing starts the instant a build succeeds, Agentic Review starts the
   instant Testing passes (if its toggle is on, item 12), Manual Review
   starts the instant Agentic Review approves. The only human gate in the
   back half of the pipeline is resuming from `returned`.

### Action Items (new concept, generated once per `spec_grill` run)

4. `spec_grill`'s existing terminal `submit_adr` tool gains an optional
   `actionItems` field alongside the ADR markdown — same call, one more
   payload field. Action Items are generated **once per `spec_grill` run**,
   at the `draft` → `spec_ready` transition. `feature_build` never creates
   new Action Items itself (item 7 explains why) — the batch is always
   produced by whichever `spec_grill` run most recently completed, and by
   the time a feature reaches `running`, its whole batch is already
   resolved, so there's never a leftover-vs-new-batch merge to reason about.
5. Four Action Item types, each with a distinct resolution mechanic:
   - **Env var / secret request** — names a key + description; extends the
     existing `project_secrets` mechanism (`job-dispatch.md`). **Auto-resolves**
     by polling whether that key now exists in `project_secrets` — no manual
     "mark resolved" step.
   - **Move to `design_grill`** — links to a design session (ADR 014).
     Resolves the moment `submit_design` fires (design **finalized**, not
     merged — its PR may still be open). The design's full HTML/CSS snapshot
     is attached directly into the next `spec_grill`'s context (same
     mechanism as item 7's kickback context), not left to repo-exploration
     discovery (ADR 014 item 12), since the design's branch may not be
     merged to `main` yet.
   - **New blocking subtask feature** — auto-creates a real Feature, parented
     to the original via a new `features.parent_feature_id` column, running
     the normal full lifecycle (its own Spec → ... → Manual Review). The
     parent's Action Item resolves only when the subtask reaches **`merged`**
     — not just approved/`spec_ready` — since the parent's build likely needs
     the subtask's actual code to exist.
   - **Test request** — **synchronous, human-supervised**, unlike the other
     three. `spec_grill` proposes a draft markdown test spec on the Action
     Item; the user reviews/edits it and clicks "create test" (setting the
     schedule at the same time), which creates the real Test entity
     immediately and resolves the item. No async job — Tests are just config.
6. New table `feature_action_items` (feature_id, type, description, status,
   resolved_at, plus type-specific fields: `secret_key` /
   `design_session_id` / `subtask_feature_id` / `draft_test_markdown`).

### Implementation can kick back to Spec (new, not just Action Items)

7. `feature_build` stays **unattended** (ADR 010 — no `ask_user`-equivalent
   tool) even with Action Items in the picture. Instead of giving it a new
   interactive capability, it gets one new **terminal** contract tool,
   `request_action_item`, called specifically when the agent recognizes
   mid-build that it's blocked on something only a human or another job can
   provide (a missing secret, a dependency that should be its own feature,
   etc.) — structurally distinct from a generic crash/bug, which still calls
   `submit_build_result(success: false)` / `run_failed` and lands in today's
   `failed` state, retried via ADR 012 exactly as now.
8. `request_action_item`'s payload (one or more needed items, each
   `{type, description}`) triggers a **new `spec_grill` job**, landing the
   feature back in `draft` — the same state a first-time grill uses, not a
   new one, mirroring ADR 012's "new job row, feature status reset" retry
   precedent. What's different: the new `spec_grill`'s initial context is
   seeded with the **previous approved ADR**, a **summary of the previous
   grill transcript**, and the **kickback reason** (the needed items just
   reported), so the agent picks up from where it left off instead of
   re-exploring from scratch. This `spec_grill` run produces a fresh ADR +
   Action Items batch exactly like a first-time run (item 4).

### Testing: Agentic (extended) and Unit/Integration (new, non-agentic)

9. **Agentic** testing extends the existing `test_run`/Tests feature
   (ADR 002 item 21-24) with an on-demand trigger, not just its existing
   cron trigger: `test_run`'s job spec gains a `ref` field, and when
   dispatched as a Testing-stage gate it targets an ephemeral deployment of
   the **feature's own branch**, not `main`. Same agent-driven mechanics
   (markdown spec, test report artifact) either way.
10. **Unit/Integration** testing is **not agent-driven at all** — a
    deliberate departure from every other job kind. It's "run the project's
    own test command and capture pass/fail," which is deterministic and
    doesn't need an LLM to drive it. New job kind: **`script_test_run`** —
    a plain container (no Pi, no skill, no attach/RPC, no contract tools),
    running one of two new optional scripts at the structure standard's
    fixed convention (ADR 008 item 6, alongside `setup.sh`/`run.sh`):
    **`test-unit.sh`** / **`test-integration.sh`**, in the primary repo. A
    script's mere presence is its own enable/disable toggle — no separate
    project setting, mirroring `setup.sh`'s existing "optional" status.
11. Each script is responsible for running its actual framework (jest,
    pytest, go test, ...) **and** writing its result to one canonical path
    in a fixed minimal JSON schema — `.yggdrasil/test-report.json`:
    `{passed, failed, skipped, total, coveragePercent?, failingTests: []}`.
    Yggdrasil only ever reads that file; it never parses jest/JUnit/lcov/or
    any framework-specific format itself. The translation burden sits with
    the project's own script, the same posture `run.sh`/`setup.sh` already
    have toward their respective concerns.
12. Agentic Review is a **per-project toggle, default on** (new
    `projects.agentic_review_enabled` boolean) — not every team wants an AI
    reviewing their AI's diff as a hard gate. Unit/Integration have no
    separate toggle (item 10 — script presence is the toggle).

### Agentic Review (new job kind, zero prior grounding)

13. New job kind **`agentic_review`**, triggered automatically once all
    enabled Testing groups pass. Reuses ADR 006's attach/RPC machinery
    wholesale (same precedent `design_grill` set in ADR 014): new
    per-job-kind image (`agent-images/agentic_review/`), its own skill.
14. **Read-only container access tier** (`contents: read`, same tier as
    `spec_grill`/`test_run`) — it reviews a diff, it doesn't write code.
    Its verdict is a **new terminal contract tool**,
    `submit_review({verdict: "approved" | "changes_requested", comment})`,
    relayed as a curated event to the API — **not** a real GitHub PR review.
    This is a deliberate distinction: a real GitHub review would trigger
    ADR 013's `pull_request_review` webhook, which is specifically the
    *human* Manual Review signal and only fires from `in_review` — a state
    this stage precedes, so it wouldn't even match, and conflating the two
    would blur "an agent said no" with "a human said no."
15. Inputs: clones all linked repos at the feature branch (like
    `feature_build`), plus the approved ADR and the Testing stage's report(s)
    as context, so it's reviewing "does this diff actually implement the
    ADR" rather than diffing blindly.
16. `approved` → advances to `in_review` (Manual Review). `changes_requested`
    → `returned` (item 17) with the review comment attached.

### Unifying the three "sent back to Implementation" paths

17. Three different triggers all need to land a feature back in
    Implementation with a comment: Testing failure (structured test report),
    Agentic Review `changes_requested` (the reviewing agent's comment), and
    Manual Review `changes_requested` (a human's real GitHub PR review via
    ADR 013's webhook — unchanged mechanism, new landing state). All three
    now land in one unified state: **`returned`**, replacing
    `changes_requested` outright. New fields: `return_reason`
    (`test_failure` | `agentic_review` | `human_review`) and
    `return_comment`. The implementation wireframe already called this
    landing view "Returned" in its own design-note — the naming was already
    converging on this before the mechanics were nailed down here.
18. `returned` **requires an explicit human "Resume implementation" click**
    to redispatch a fresh `feature_build` job (landing back in `queued`) —
    for all three trigger reasons, including the two fully-automatic ones.
    An unattended fail → retry → fail loop with no human in it could burn
    real compute silently on a feature that's fundamentally stuck; this is a
    deliberate, if conservative, choice to always put a person back in the
    loop before spending another build.
19. Infra-level job failure (the Testing or Agentic Review container itself
    crashes or times out, without producing a real verdict) is **not**
    `returned` — it's `failed`, exactly like a `feature_build` crash today,
    retried via ADR 012. `returned` is reserved for "the job ran fine and
    said no," not "the job didn't run."

### Migration

20. Existing `changes_requested` rows become `returned` with
    `reason: human_review` — a straightforward rename, no other data change.
    Features already sitting in `queued`/`running`/`in_review` keep flowing
    forward and pick up the new Testing/Agentic Review gates the first time
    they'd naturally reach them; nothing already past `in_review` is
    retroactively gated.

## Consequences

### Positive

- Action Items reuses `spec_grill`'s existing single-call output shape
  (`submit_adr` gains a field) rather than inventing a second job phase.
- `feature_build` stays fully unattended — the one new tool it gains
  (`request_action_item`) is still a **terminal** call, same shape as
  `submit_build_result`, not a new interactive turn type.
- Unit/Integration testing avoids real scope creep (parsing every test
  framework's native output) by pushing translation to the project's own
  script, mirroring the `run.sh`/`setup.sh` precedent exactly.
- A single `returned` state with a reason field is simpler to build and
  reason about than three separate "sent back" states would have been, and
  matches the wireframe's own "Returned" naming.
- The human-gate-before-resume rule (item 18) bounds compute risk from the
  two new automatic failure paths without adding a retry-count/backoff
  mechanism this ADR would otherwise have had to design.

### Negative / trade-offs

- **Two new job kinds** (`agentic_review`, `script_test_run`), each needing
  its own image in `agent-images/` — real build/maintenance surface added to
  ADR 004's roster.
- **`script_test_run` is a second non-agent job kind precedent** (after
  `deploy`) — most of the system's mental model is "job kind = Pi container
  running a skill"; this and `deploy` are the exceptions.
- **Kickback context (item 8) doesn't include a strict cap** on how large the
  "previous grill transcript summary" can get across repeated kickback
  cycles — a feature that kicks back several times could accumulate a large
  context payload. Not solved here; flagged as a follow-up.
- **Agentic Review's `contents: read` tier means it can't leave inline PR
  comments** — its feedback only exists inside Yggdrasil, not on the GitHub
  PR itself, which may feel like a gap to a reviewer who's used to seeing
  bot comments inline on GitHub.
- **Blocking subtask features (item 5) have no cycle/depth guard** — nothing
  stops a subtask's own `spec_grill` from proposing another blocking
  subtask. Not solved here; same class of unbounded-recursion risk as any
  new parent/child model, flagged as a follow-up.

### Follow-ups (out of scope here)

- Cap/summarize kickback context growth across repeated cycles (item 8).
- Guard against unbounded blocking-subtask-feature recursion (item 5).
- Any Web app surface for Agentic Review's comment beyond the "Returned"
  view (e.g. showing it inline against the diff).
- Whether `agentic_review`'s verdict should ever escalate to a real GitHub
  PR comment/review (currently deliberately internal-only, item 14).
- Org/RBAC (`roadmap/open-questions.md` #13) and per-message grill
  resume/restart (`roadmap/open-questions.md` #17) are separate, unresolved
  `design/`-surfaced questions this session deliberately did not touch.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Let `feature_build` create Action Items directly, mid-build | Would require giving the unattended "implement" skill a new interactive/`ask_user`-equivalent capability — a much bigger change than routing back through the skill (`spec_grill`) that already does this kind of reasoning |
| Fold Unit/Integration testing into the existing `test_run` job kind | Would force a deterministic script-run through Pi/RPC machinery it doesn't need — spinning up an LLM-driven container just to run `npm test` and read a file |
| Yggdrasil parses common test-report formats directly (JUnit XML, lcov) | Locks the feature to whatever formats get built-in support; every framework not on the list needs a shim anyway, so the canonical-JSON-path convention solves the same problem more generally |
| Agentic Review posts a real GitHub PR review | Would trigger ADR 013's `pull_request_review` webhook (the human Manual Review signal) from a state where that webhook's guard doesn't even apply, conflating an agent's verdict with a human's |
| Separate `returned`-like states per trigger reason (`test_failed`, `review_rejected`, `changes_requested`) | Three states doing the same job (send Implementation back with a comment) is more surface than a reason field on one state, for no behavioral difference |
| Auto-redispatch `feature_build` immediately on any return, no human gate | Risks an unattended fail → retry → fail loop burning compute on a feature that's fundamentally stuck, with no human ever noticing |
| Make Agentic Review mandatory, no toggle | Not every team wants an AI hard-gating on another AI's diff; a default-on toggle keeps the safety net while staying reversible per project |

# ADR 008: `project_init` grill workflow, structure standard, and submodule sub-repos

**Status:** Accepted
**Date:** 2026-07-11 (amended 2026-08-30 by ADR 015 item 10 — structure standard
gains two optional scripts, `test-unit.sh`/`test-integration.sh`)
**Deciders:** Product/design session (grill-me)
**Builds on:** [ADR 002](002-projects-features-tests.md) (projects/features/tests),
[ADR 003](003-orchestrator-kubernetes.md) (Orchestrator Kubernetes compute, Helm
contract), [ADR 004](004-agent-base-containers.md) (agent base containers, skills),
[ADR 005](005-github-app-repository-access.md) (GitHub App), [ADR 006](006-pi-rpc-orchestrator-integration.md)
(Pi RPC integration)
**Amends:** ADR 002 §7 (project init's "templated grill prompt" — now concrete),
ADR 003 §12 (build/runtime contract — adds a local-dev convention alongside the
existing Helm contract, no change to the Helm decision itself), ADR 004 §14
(`project_init` scaffolds a docs convention — now a full structure standard with a
concrete skill behind it), ADR 006 item 5 (`FeatureSpec` gains a field)

## Context

`project_init` does not actually behave differently from a normal feature's
`spec_grill` today, despite two prior ADRs promising it would:

- ADR 002 §7: "Project init uses the same feature workflow as normal features,
  with a fixed type and templated grill prompt ('bootstrap/adapt this codebase
  for Yggdrasil')."
- ADR 004 §14: "The templated `project_init` grill session … now explicitly
  scaffolds `docs/CONTEXT.md` and an empty `docs/adr/`."

Neither "templated grill prompt" was ever wired to code. `POST /projects`
(`api/src/projects/routes.ts`) creates the `project_init` feature with the
literal title `"Project initialization"` and dispatches a plain `spec_grill`
job — mechanically identical to any normal feature. `FeatureSpec`
(`orchestrator/internal/apiclient/client.go`) carries `{title, repos,
githubToken}` only; there is no `featureType` anywhere in the job spec. The
`spec_grill` image installs exactly one skill, `grill-with-docs`
(`agent-images/spec_grill/skills/grill-with-docs/SKILL.md`), written to be
feature-agnostic — it assumes `docs/CONTEXT.md`/`docs/adr/` either already
exist (from a prior `project_init`) or don't, and proceeds accordingly. Nothing
in the running container is ever told "this is the bootstrap run, ask about
purpose/tech-stack/repo-structure and check the structure standard."

Verified against a real running job pod (a test project dogfooding a copy of
Yggdrasil's own orchestrator/api code): the ADR 006 turn-taking mechanism
(`ask_user`/`submit_adr`, mid-run replies, session teardown) works correctly
end-to-end. The gap is entirely in content — the generic grill invents its own
generic design questions instead of the three the product actually needs
answered, and never checks any structure convention, because nothing tells it
to.

Separately, ADR 003 §12 already mandates a Helm chart, scaffolded at
`project_init`, as the *hosting* contract (previews + the always-on primary
deployment) — and explicitly rejected docker-compose for that role (lossy
translation). But nothing existed for **local development ergonomics** (a
human — or an agent — running the app on a laptop), and multi-repo customer
projects were modeled as sibling clones (ADR 002 §1, `entrypoint.sh`), never as
git submodules the way yggdrasil-core itself nests its own component repos
(`docs/conventions/repo-structure.md`).

## Decision

### `project_init` becomes an explicit, distinct grill session

1. `FeatureSpec` (`orchestrator/internal/apiclient/client.go`) gains
   `FeatureType string` (`"normal" | "project_init"`, mirroring
   `api/src/features/types.ts`), populated from the `features` table by
   `GET /internal/projects/:projectId/features/:featureId/spec`.
2. `buildInitialPrompt` (`orchestrator/internal/worker/specgrill.go`) branches
   on `FeatureType`. For `project_init`, the prompt is entirely
   system-authored (no user-supplied title text to lean on) and explicitly
   states the goal — bootstrap/adapt this repo for Yggdrasil — and names
   `/root/.pi/agent/skills/project-init/SKILL.md` as the skill governing the
   run. For `normal`, the prompt keeps today's shape (the user's feature
   title as the actual content to grill) but names
   `/root/.pi/agent/skills/feature-grill/SKILL.md` instead. Skill selection is
   **explicit in the prompt**, not inferred by the model from a title string —
   the same fix `buildInitialPrompt`'s own history already applied once
   (stating repo paths explicitly instead of relying on the model to
   rediscover them).

### Two skills replace `grill-with-docs`

3. **New:** `agent-images/spec_grill/skills/project-init/SKILL.md`. Interview
   order:
   1. What the project does and achieves.
   2. Tech stack.
   3. Repo relationships — **not** "single repo vs. primary+sub-repos" (that's
      already fixed by the repo picker at project-creation time, ADR 002 §2,
      and the initial prompt already lists each repo's role). Instead: state
      back what's already known (the linked repos and their roles) and probe
      one level deeper — e.g. is a given sub-repo a library the primary
      imports, or an independently-deployed service the primary calls at
      runtime? This is real ambiguity the repo picker doesn't resolve, and it
      directly shapes the Helm chart and `run.sh`.
   4. Read-only exploration of the target repo(s) against the bundled
      structure standard (item 6) to determine what's missing or
      non-conforming.

   The resulting ADR must specify: `docs/CONTEXT.md` seed content (the answers
   above), a `setup.sh` spec (or an explicit "not needed" if there's nothing
   to bootstrap/seed), a `run.sh` spec, confirmation that the Helm chart
   exists or needs scaffolding (ADR 003 §12, unchanged), a `CLAUDE.md`/
   `AGENTS.md` router scaffold, and — if the repo already has code that
   doesn't conform — a restructuring plan. There is **no separate mid-grill
   consent gate** for restructuring: the existing `spec_ready` → human review
   → Start build gate (ADR 002 §14) is the approval mechanism, so asking
   "should we restructure, yes/no" mid-interview would just duplicate a review
   step that's already coming.
4. **Renamed, content otherwise unchanged in substance:** `grill-with-docs` →
   `agent-images/spec_grill/skills/feature-grill/SKILL.md`, retained for
   normal features grilling against `docs/CONTEXT.md`/`docs/adr/`.
5. `agent-images/spec_grill/Dockerfile` installs both skills. Because
   selection is driven by the explicit initial prompt (item 2), not model
   inference, both skills can be `disable-model-invocation`'d — the prompt
   tells Pi exactly which `SKILL.md` to read first, every time.

### Structure standard

6. New bundled reference,
   `agent-images/spec_grill/skills/project-init/reference/structure-standard.md`
   — baked into the image at build time (same mechanism `agent-images/docs/concepts/skills.md`
   already documents for skills), so the container never needs network access
   to yggdrasil-core's own docs to know what "conforms" means. Checklist:
   `setup.sh`, `run.sh`, `docs/CONTEXT.md`, `docs/adr/` (ADR 004 §14), Helm
   chart (ADR 003 §12), and a `CLAUDE.md`/`AGENTS.md` router mirroring
   `templates/child-repo/` — minus the submodule-nesting pattern for the
   router itself; that pattern is for a meta-repo-of-component-repos, not a
   customer project's own primary repo (whose only submodule nesting is its
   code sub-repos, item 8).
7. `setup.sh` (idempotent env/bootstrap/seed — omissible if a project needs
   none of that) and `run.sh` (the one deterministic command to run the app
   locally) are **local-dev-only** conventions, orthogonal to the Helm chart.
   The Helm chart remains the Orchestrator's only hosting mechanism —
   ephemeral preview deployments for `spec_grill`/`feature_build`/`test_run`,
   and the always-on primary deployment for prod (ADR 003 §9-13, unchanged).
   No docker-compose anywhere in this convention.

### Sub-repos become git submodules of the primary

8. Reverses ADR 002 §1/§3's sibling-clone model for a project's **sub-repos**
   (the meta yggdrasil-core repo already used submodules for its own
   component repos — this extends the same pattern to customer projects
   managed by Yggdrasil): a project's sub-repos are wired as git submodules of
   the primary repo, not cloned side-by-side by the entrypoint.
9. Wiring happens **once**, during `project_init`'s `feature_build` — the only
   phase with write access. `implement` runs `git submodule add <sub-repo-url>
   <path>` per sub-repo named in the project_init ADR, and commits
   `.gitmodules` on the project_init feature branch. Linking an **additional**
   sub-repo to an already-`ready` project (via project settings, after
   `project_init` has merged) is an explicit **follow-up**, not solved here —
   it's a pre-existing gap (ADR 005 already allows adding repos to an
   installation later) that this ADR doesn't need to close to fix
   `project_init` itself.
10. `base/entrypoint.sh` changes from cloning each `TARGET_REPOS` entry
    separately to: `git config --global url."https://x-access-token:<token>@github.com/".insteadOf
    "https://github.com/"`, then a single `git clone --recurse-submodules
    <primary-clone-url> /workspace`, then immediately clearing the global
    rewrite — mirroring today's strip-token-after-clone step, just for the
    whole tree instead of one URL. This requires the primary's `.gitmodules`
    to already reference its sub-repos at job time, which is true from the
    first `spec_grill`/`feature_build` run after item 9 has landed once.
11. `feature_build`'s existing two-PR model is unchanged in shape:
    Coordination PR on the primary, Repo PR per touched sub-repo. The
    Coordination PR additionally bumps each touched submodule's pointer
    (gitlink) commit to match what its Repo PR introduced, so the primary's
    tree stays consistent with what actually landed in the sub-repo.

## Consequences

### Positive

- Closes the actual reported bug: `project_init` now deterministically asks
  the three things the product needs answered, instead of a generic,
  self-invented design interview.
- The Helm/local-dev split stays honest to ADR 003 while giving customer
  projects a local-dev story that was previously entirely undefined.
- Submodule sub-repos make a customer project's repo layout structurally
  mirror yggdrasil-core's own convention directly, rather than by loose
  analogy — satisfies "any project initialised should follow similar
  repository structure to the current yggdrasil one" literally.
- Explicit skill selection via the initial prompt removes a whole class of
  "did the model correctly infer which skill applies" failure modes — the
  same fix `buildInitialPrompt` already made once for repo paths.

### Negative / trade-offs

- Materially larger surface than the originally-reported bug alone:
  `entrypoint.sh` rewrite, `FeatureSpec`/DB field threading, two new/renamed
  skill files, submodule auth, Coordination-PR pointer bumps.
- Submodule adoption departs from the sibling-clone model ADR 006 already
  verified end-to-end against a real pod — needs its own verification pass,
  not assumed correct by association.
- Linking a sub-repo after `project_init` merges remains unsolved (tracked
  follow-up below).
- The structure standard now conceptually exists in two places — this ADR's
  prose and the bundled reference file actually read at runtime — the same
  duplication trade-off ADR 004 already accepted for the `docs/CONTEXT.md`
  convention.

### Follow-ups (out of scope here)

- **Discovered during implementation of this ADR:** items 9 and 11 (submodule
  wiring and pointer bumps during `project_init`'s `feature_build`) assume
  `feature_build` already clones repos, checks out the feature branch, and
  is driven the way ADR 006 drives `spec_grill` (attach + RPC + curated event
  relay) so `submit_build_result` is actually observed. It isn't:
  `orchestrator/internal/worker/worker.go`'s `runInCluster` still routes
  `feature_build` through the placeholder-compatible `runAgentJob`/
  `k8s.RunJob` path (`TARGET_REPOS`/`GITHUB_TOKEN` are only ever set for
  `queue.KindSpecGrill`), which only polls `Job.Status` — nothing attaches to
  drive a real Pi RPC session, and per Pi's own RPC docs (quoted in ADR 006's
  Context) the process never exits on its own. A real `feature_build` image
  would hang indefinitely today. This is a pre-existing gap ADR 006
  explicitly deferred ("`feature_build`/`test_run` reuse the same machinery
  in a later pass"), not introduced by this ADR — but items 9/11 have no
  working foundation to run on top of until that gap closes. **This ADR's
  implementation therefore ships items 1-7 and 10 (the `spec_grill`-side
  skill split, structure standard, and `entrypoint.sh`'s submodule-aware
  clone, which only needs `TARGET_REPOS`/`GITHUB_TOKEN` to exist and is
  job-kind-agnostic) now; items 9 and 11 stay designed-but-unimplemented
  until `feature_build`'s own attach/RPC-drive/event-relay wiring lands as
  its own pass.**
- Design "link a sub-repo to an already-`ready` project" wiring it in as a
  submodule automatically (today: undefined for both the old sibling-clone
  model and this one).
- Submodule pointer semantics when a sub-repo's Repo PR hasn't merged yet
  (Coordination PR would point at an unmerged commit) vs. after (a
  squash-merge changes the target commit hash, requiring a second pointer
  bump) — left as an implementation detail for `feature_build`, not designed
  here.
- No new Web app work is proposed — the existing `spec_ready` review UI
  (ADR 006 item 15) is reused as-is for `project_init`'s ADR too.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Let the model infer project_init vs. normal-feature grilling from the feature title alone | Same class of ambiguity already causing today's bug — the model "invents" behavior instead of being told explicitly, exactly like the repo-path issue `buildInitialPrompt` already had to fix once |
| One skill file, internally branching on which case applies | Less file duplication, but bundles two fairly different interview scripts into one file and still relies on the model correctly identifying which branch applies from prose rather than the Orchestrator picking deterministically |
| docker-compose.yml as the local-dev convention | Explicitly not wanted — `run.sh` is the single deterministic entry point instead; avoids conflating with ADR 003's already-rejected docker-compose-as-hosting-manifest discussion |
| Keep sub-repos as sibling clones (status quo) | Simpler, already working and verified (ADR 006) — but doesn't satisfy the goal of customer projects structurally mirroring yggdrasil-core's own submodule convention |
| Per-submodule URL patching after a submodule-less clone | Works, but is N places to get auth right instead of one global rewrite before a single recursive clone |
| A mid-grill explicit consent step ("should we restructure, yes/no") before drafting the ADR's restructuring plan | Duplicates the review gate already coming at `spec_ready` → Start build (ADR 002 §14) |
| Author the structure standard once in yggdrasil-core docs, mirror a copy into agent-images | Keeps a human-readable canonical copy at the cost of two places to keep in sync; the bundled-file-only approach was preferred for this pass since agent-images already treats skills as build-time-baked, not fetched |

Implementation reference: `docs/concepts/job-dispatch.md`,
`docs/concepts/feature-lifecycle.md`, `agent-images/CLAUDE.md`,
`orchestrator/CLAUDE.md`.

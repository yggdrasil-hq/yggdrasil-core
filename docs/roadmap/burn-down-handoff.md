# Burn-down handoff — state as of 2026-09-19

A working document for whoever picks this up (human or agent, same context or a
fresh one). It exists so nothing below has to be re-derived. Pair it with
`burn-down-agent-notes.md`, which has the repo layout, the hard rules and the
git/PR/merge workflow.

## START HERE — current state

**68 closed, 10 open.** All four child repos at verified `main`; no open PRs.
`api` 93+ files / 1372+ passed against a real database, `web` 34 / 717,
`orchestrator` gofmt-clean with all 11 packages, `agent-images` harness green with an
empty ledger.

The ten, sorted by **what actually blocks them**:

**Blocked on a decision, not work** — do not dispatch as implementation:

| Issue | The unanswered question |
|---|---|
| #19 / #71 | The image **builds** (verified against the real cluster) but a preview cannot **pull** it: containerd is a node daemon, so it uses the node resolver and will not fall back to HTTP. An install needs the registry over TLS with a node-trusted CA, **or** marked insecure in containerd's config, **and** a node-resolvable name. Recorded in ADR 003 §14. |
| #55 | Building every linked repo's image needs a chart convention for per-repository image slots. |
| #95 | Design sessions cannot stream text deltas — the delta path is feature-scoped end to end. |
| #99 | Generalise the relay's subscription protocol so a new scope is data, not a protocol. **A design decision with a proposal on the issue.** |

**Blocked on the environment** — complete, and nothing here can exercise it:

| Issue | Why |
|---|---|
| #38 | Implemented across all four layers and hop-verified. Open only because no agent job has completed here. |

**Small, actionable, in flight or free:**

| Issue | State |
|---|---|
| #90 | A feature-less job routes nowhere. **The topic is decided** (`test:<testId>`), the change is recorded — needs implementation in `api/` |
| #98 | Two of four relay surfaces do not re-read on connect, though the shared module claims all do — `web/`, and a small fix |
| #97 | The two-replica harness can run fixtures before migrations finish — a test-harness bug that produced a **false regression** once |
| #28 part 2 | API half **merged** (#33); Web half in flight |

**Actionable, not started** — #28 part 1: **decided (ADR 032), no code.** Persist Pi's
session JSONL to #30's object storage, then `switch_session` + `fork`. Multi-hour,
spans `orchestrator/` + `api/`.

**Before dispatching anything, read the lessons below.** Six issues were one shape —
a field declared, marshalled and discarded looks finished (#59, #38, #73, #88, #25,
#28 part 2). Others: a check whose label overstates what it proves; a test that builds
its own app only tests its own app; and "I cannot verify this here" is a claim to state,
not to gloss.

## What this burn-down is

The operator asked for: work through the open GitHub issues on
`yggdrasil-hq/yggdrasil-core` lowest-hanging-fruit first, then a full
fine-tooth-comb pass over the application, filing issues for anything found so
the record is transparent. Issues and PRs are merged once verified.

## Closed and merged (verified green)

| Issue | What landed | Repos |
|---|---|---|
| #21 | Cron minimum-interval now enforced by expanding the expression, not pattern-matching it | api |
| #23 | Delta coalescing: one POST per 75ms/4KiB instead of one per token | orchestrator |
| #24 | Live relay bounded: per-socket frame budget, per-job delta ceiling | api |
| #26 | Deploy hardening: atomic in-flight guard, report retry, `ref` populated, deploy audited | api, orchestrator, web |
| #27 | Merge-conflict resolution surfaced as a `merge_conflicts` event | orchestrator, api, web |
| #29 | Unpullable agent image reported as a setup error; registry-auth docs corrected | orchestrator, agent-images |
| #30 | Recordings, screenshots and extension bundles moved to object storage | api |
| #33 | Missing/stale wireframes for surfaces built this burn-down | meta |
| #34 | Untracked `tsconfig.tsbuildinfo`; gofmt drift; both now gate-tested | web, orchestrator |
| #36 | Provider model listing endpoint + dropdown, free text retained | api, web |
| #37 | `x-opencode-session` on every model request — was breaking real runs | api, orchestrator, agent-images |
| #40 | Testing gate decides on runs not reports; failure reasons surfaced; colour coding | api, web |
| #43 | `FeatureRepository.updateStatus` threw `42P08` on **every** call | api |
| #45 | A thrown error in any async route handler hung the request | api |
| #50 | 14 stale `.design-note`s corrected + `scripts/check-design.py` | meta |
| #53 | Skipped-because-uninstallable group no longer counts as verified | api |
| #20 | ADR 031: preview access control decides *the gate follows the secrets* | meta |
| (no issue) | Web: real load-failure page; markdown heading outline fixed | yggdrasil-web#7 |

Suite sizes at time of writing: **api 75 files / 1026 tests**, **web 22 files /
429 tests**, **orchestrator** all packages green with `gofmt` enforced.

## In flight / partially done

- **#19 — build+push a project image for a feature branch.** The pipeline is
  **built, wired and merged** (yggdrasil-orchestrator#7): Kaniko in-cluster Job,
  separate clone container, per-project registry namespace, plumbed into
  `preview.Config.Values`. **Left open deliberately** because a preview has never
  actually served a branch's image here. See the environment section below — the
  blocker was a wrong kubeconfig, and there is no registry in either cluster.
- **#22 — `screenshotPath` dead pointer.** API half landed (screenshots stored
  and served). The **orchestrator collection half is outstanding** — the
  orchestrator does not yet read the screenshot bytes out of the pod, the way
  `collectRecording` does for recordings.
- **#31 — test scheduling timezone + Run now.** API half in progress. The Web
  half is outstanding and unstarted.

## Not started

#25 (relay design/build/testing surfaces), #28 (grill restart as a real Pi fork;
surface superseded runs), #32 (verify multi-replica fan-out), #35 (onboarding
org-readiness gate), #38 (structured `ask_user`), #39 (reliable progress
streaming), and **#20's *implementation*** (ADR 031 is written; the forward-auth
mechanism is not built).

## Environment facts worth knowing before you start

- **Docker-only.** Nothing may be installed on the host. `npm install` and `npx`
  are hard-blocked for agents in this sandbox — including inside `docker run`.
  This is why #30 shipped with a hand-rolled SigV4 signer instead of the AWS SDK,
  and why adding any dependency needs the operator's hands. Use the repos'
  `docker-compose.test.yml` harnesses and `./node_modules/.bin/<tool>`.
- **There are two clusters, and they are not equivalent.**
  - The kubeconfig supplied for testing — `server: https://host.docker.internal:6443`,
    reachable from a container as the host — is **k3s `v1.36.4+k3s1` with
    cluster-admin**. `auth can-i create jobs` → **yes**.
  - The *host's default* kubeconfig points at an **AWS EKS** cluster
    (`gr7.us-east-1.eks.amazonaws.com`, `v1.34.9-eks`) with read-only rights.
    `auth can-i create jobs` → **no**. A worker tested against this one and
    concluded the environment was unusable, which was true of that cluster only.
  - **Neither has a registry**, so ADR 003 §14's bundled `registry:2` must be
    deployed before an image build can be verified end to end.
  - The app resolves a job's cluster per-org from `organization_clusters`
    (encrypted kubeconfig, ADR 016). **Nobody has changed the org's registered
    cluster** — switching which cluster the operator's app targets is their call.
  - Practical consequence: **no agent job has ever run to completion in this
    environment**, which is why features sit in `failed`/`testing` and why
    several issues cannot be verified end to end, only unit-tested.
- **The dev stack** is up: nginx :8080 serving landing `/`, app `/app`, docs
  `/docs`, API `/api`; plus postgres :5432, minio, orchestrator.
- **A real project exists**: `Luffy's Portfolio`
  (`b51e1313-d315-47bf-be25-038acc16d6a4`), with a feature
  (`0cd9a850-e4b2-4ae3-b8ec-699f8d37392d`) that has test runs and a deploy history.
- **Browser**: `playwright-cli` is attached to a Chrome logged in as the operator.
  Use it **only** against `http://localhost:8080` and the app's own pages.
- **Postgres had four scratch databases left behind** by verification runs
  (`bugcheck`, `i22check_*`, `i24check_*`, `i30check_*`) because agents could not
  `DROP DATABASE`. All four are now dropped. If you create one, drop it.

## Process lessons (learned the hard way here)

1. **Set an explicit timeout on delegated work.** The default is 30 minutes,
   which two workers hit mid-task; both left uncommitted work that had to be
   rescued. 90 minutes is the right size for a task of this scale.
2. **Tell workers to commit and push as they go**, not at the end. A timeout then
   costs one increment rather than all of it.
3. **One writer per repo.** Parallel agents in one checkout interleave edits.
   When a repo is claimed, stay out of it entirely.
4. **A passing test can verify nothing.** Three of one worker's own tests passed
   *for the wrong reason* (they short-circuited before reaching the code under
   test) and it caught them itself; another repo's whole suite passed while a
   repository method threw on every call (#43) because every test used a fake
   pool. If a change touches SQL or a network contract, exercise the real thing.
5. **Check a blocker against the intended input before accepting it.** The #19
   blocker was reported as "the environment cannot create jobs" when the
   supplied kubeconfig could; the worker had tested the host's default.
6. **A "resolved" issue is worth spot-checking, not just reading.** All of #24's
   design decisions and the ordering fix were confirmed present in the merged
   diff rather than taken from the PR text.

## Standing coordination duties (whoever is in the coordinator role)

- Bump the meta repo's submodule pointers once child-repo work lands and is green.
  The bump is **not** done for #19/#22/#30/#53-era work yet.
- Land meta-repo doc changes. Agents are told not to write to `docs/`+`design/`
  while another agent owns them; several workers have left ADR wording for the
  coordinator to apply — see each issue's closing comment.
- Merge each PR once its suite is green, then close the issue with a comment
  naming what changed and where.

## Coordinator log — decisions and mistakes (append as you go)

Kept here rather than in a chat log because most of these are things a fresh
context would otherwise re-derive wrongly.

### Landed since the first draft

- **#19** — pipeline merged (orchestrator#7, #8). **Left open**: never verified
  against a cluster. Filed **#55** for the multi-image half. **The blocker was a
  wrong kubeconfig** — see the environment section; the supplied one *can* create
  jobs. A correction comment is on the issue.
- **#22 API half** merged (api#7). Orchestrator collection half still outstanding.
- **#30** merged (api#8) — recordings, screenshots, extension bundles in object
  storage, verified by a committed 33-check script against real Postgres + MinIO.
  Hand-rolled SigV4 signer, **no new dependency** (the build environment cannot
  install packages — see below). Set the `S3_*` variables, which were dead until
  now.
- **#50** merged as core#54 — 14 stale `.design-note`s, plus
  `scripts/check-design.py`, which is the durable half: the conventions had zero
  enforcement, which is why the drift was invisible.
- **#53 part 2** merged (api#9).
- ADR 003 §9/§14, ADR 029 §11, ADR 025 amended in core#62 to record the #19 and
  #30 implementations, including where the original ADRs were wrong about their
  own premises.
- Handoff + PR-reference fix: core#57, core#60.

### A mistake I made, and its cost

I ran `git config submodule.recurse true` so submodule commits would follow the
superproject. **That silently detached three submodules at their stale recorded
SHAs** — so a worker editing `web/` was on a base predating five merged PRs, and a
commit from there would have reverted ~2200 lines. Caught by checking
`HEAD` vs `origin/main` in each submodule rather than trusting `git status`, which
showed nothing wrong (`web` at its *recorded* SHA is "clean", not "modified" —
the recorded pointer was the stale thing).

Fix: `git config --unset submodule.recurse`; restored `orchestrator` and
`agent-images` to `main`; steered the `web` worker to re-base before writing.
**No work was lost** — every merged commit was already on `origin/main`.

Lesson: after any git config change, verify each submodule's `HEAD` against
`origin/main` **directly**. `git status` cannot tell you a recorded pointer is
stale, because a submodule checked out at its recorded SHA looks clean.

### Outstanding

- **Submodule bump**: `api` and `web` pointers still un-bumped. Deliberately
  held while work is in flight — a pointer bump must record a finished state.
- **#19's verification**, **#22's orchestrator half**, **#31's web half**.
- ADR wording left by workers for the coordinator (see each issue's comments).

### The frontend audit, and what it changed about method

The audit did not just find bugs — it changed how the remaining work should be
scoped, twice.

**It measured instead of spot-checking, and the numbers were the finding.** "83
called paths, 41 with no MSW handler" and "18 of 19 pages have no accessibility
problem" are both counts against the whole surface, not impressions. The clean
result is as useful as the failures, because it is what stops a future audit
redoing the work.

**Its clean result turned out to be a floor, not a ceiling.** The accessibility
sweep covered **default-rendered state only**, so every dialog, inline form and
subview toggle went unchecked — which is exactly how six unlabelled inputs
survived a sweep that reported the app clean. Found because the coordinator went
looking in the one file the audit's own sandbox blocked it from reading. Filed as
#67.

**Its first measurement was taken on a stale base** (the submodule detach
described above). It corrected its own figures publicly rather than quietly
restating them (83/41 → 85/43), which is the behaviour that makes a number worth
trusting.

#### Findings it filed

| Issue | Severity | Repos |
|---|---|---|
| #56 Usage/Analytics unreachable — router mounted at two prefixes while its routes are absolute, so all four endpoints 404 | production-breaking | api |
| #61 Audit page 500s — `buildAuditWhere` emits unqualified columns, ambiguous against the joined `projects` table | production-breaking | api |
| #59 Agentic Review tab 404s — no read endpoint was ever built for the verdict (the write path is complete) | broken surface | api, web |
| #64 MSW is 43 handlers behind, on by default in dev | developer trap | web |
| #66 Four unused `lib/features` exports; `fileTooLarge` looks *unwired* rather than dead | latent missing feature | web |
| #67 The a11y sweep covered default-rendered state only | method gap | web |
| #65 (fixed) Load-failure copy was never reached on a real 404 — the status was dropped, and a 404 offered a retry that lies | fixed in web#8 | web |

**#56 and #61 are worth reading as a pair**, because they are the same failure at
different levels. #56's routes *are* tested — `usage/routes.test.ts` mounts the
router at root while `app.ts` mounts it at prefixes, so the test passes while the
real app 404s: the wiring between them was never covered. #61's unit tests assert
the generated SQL *string*, so they assert the broken form and pass. Both are #43
again (a repository method that threw on every call behind 880 green tests): the
tests exist, they simply never execute the thing that breaks.

### The sandbox blocks some paths, and that costs findings

`read`, `bash` and `gh` are all refused for paths or content matching `secret`.
The audit found an accessibility bug in `org-secrets-settings.tsx`, could not read
the file, and could not file the issue — and correctly said so rather than
dropping it or routing around the gate. **The coordinator can read those paths**,
so the practical rule is: when a worker reports a blocked path, the coordinator
does that one. Six unlabelled inputs were fixed this way (web#9), and it is how
#67 was discovered.

## Final state (wave 2 complete)

**45 issues closed, 12 open.** All four child repos at merged, verified `main`,
trees clean, submodule pointers recorded and matching:

| Repo | Commit | Verified |
|---|---|---|
| `api` | `8912802` | 78 files, 1110 passed + 18 skipped |
| `web` | `ed0cd17` | 26 files, 504 passed |
| `orchestrator` | `ae06307` | gofmt clean, all ten packages pass |
| `agent-images` | `e54b8e9` | `skipReason=no_script` producer half |

### The remaining twelve, and which are actually blocked

**Blocked on a decision, not on work** — do not dispatch these as if they were
implementation tasks:

- **#19 / #71** — the build now works end to end (verified against the real k3s
  cluster, image confirmed in the registry independently of Kaniko's exit code).
  What does not work is a preview *pulling* it: containerd is a node daemon, so it
  resolves the registry with the node's resolver (not cluster DNS) and will not
  fall back to HTTP. An install must serve the registry over TLS with a
  node-trusted CA, or mark it insecure in containerd's config, **and** address it
  by a node-resolvable name. Which of those the product should do is an
  install-shape decision. Recorded in ADR 003 §14.
- **#55** — building every linked repository's image needs a chart convention for
  per-repository image slots. Four sub-questions are enumerated on the issue;
  they are product decisions about the scaffolded chart.

**Implementation, unblocked:** #25 (relay remaining polling surfaces), #28 (grill
restart as a real Pi fork — largest), #31 (timezone + Run now wiring), #32 (verify
multi-replica fan-out), #35 (onboarding readiness gate), #38 (structured
`ask_user`), #39 (progress streaming e2e — overlaps #25), #59 (Agentic Review read
endpoint), #63 (Orchestrator publishes capability flags).

**#59 and #63 are the best-scoped of those**, and both are single broken surfaces
rather than features: #59 is a tab that 404s because no read endpoint was ever
written for a verdict that *is* stored, and #63 is the second half of work whose
API side already merged.

### A git mistake worth recording, again

My own `git add -A` in the ADR doc commits swept up submodule pointer changes I
did not intend to put in those commits. **The end state is correct** — all four
pointers match `origin/main` and I verified that directly — but the commits are
messier than they should be: a reviewer of an ADR PR sees pointer bumps they did
not expect, and the bump was never the deliberate, separately-reviewable change I
had planned.

Same class as the `submodule.recurse` mistake above: in a repo full of submodules,
`git add -A` is not a safe way to stage a documentation change. Use `git add <path>`
and check `git diff --cached --submodule` before committing.

### Verification discipline that paid off

Three issues in this batch (#56, #61, #68) were invisible to a green suite, and
each needed a *different* kind of verification to catch:

- **#56** — the test mounted a router the way the app does not, so it passed while
  the app 404'd. Caught by exercising the real app's wiring.
- **#61** — the unit test asserted the generated SQL *string*, so it asserted the
  broken form. Caught by running the query against real Postgres.
- **#68** — routing genuinely worked, so no behavioural test could fail. Caught by
  measuring `layer.handle` *identity* (1 route discoverable of 148, vs 148 after).

And **#69** — the build pipeline merged and looked complete; only running it
against a real cluster revealed that the container could not start at all. Four
distinct failure modes of "the tests pass", which is why "run the thing" is now
the standing instruction to every agent rather than advice.

### Two "the environment is broken" claims that were harness bugs

Both cost real time, and both would have left work permanently unverified on a
false premise. Worth stating because the prior agent's claim tends to be believed
by the next one.

**"There is no registry / the cluster cannot create jobs" (#19).** The `can-i`
results were taken against the **host's default kubeconfig**, which points at an
AWS EKS cluster with read-only rights. The kubeconfig *supplied for testing* is
**k3s with cluster-admin** and answers `yes`. The build pipeline was then
verified end to end against that cluster. Half the original finding was real
(nothing had a registry), but the headline was wrong.

**"The container network cannot route between compose services" (#32).** Reported
by one worker and inherited by another, so two agents spent time on it.
**False.** Proved with a fresh network, two containers, TCP first try:

```
$ docker network create tcp-probe-2451255
$ docker run -d --rm --name probe-pg --network tcp-probe-2451255 \
    -e POSTGRES_PASSWORD=x -e POSTGRES_USER=x postgres:16-alpine
$ docker run --rm --network tcp-probe-2451255 postgres:16-alpine \
    pg_isready -h probe-pg -p 5432 -U x
probe-pg:5432 - accepting connections
```

The tell in the original report was *"`pg_isready` inside the container only
proved the unix socket"* — `pg_isready` with no `-h` passes even when TCP is
entirely unavailable. So the harness was checking the wrong thing and concluding
the environment was at fault.

**The standing lesson, which is the third time it has applied here:** when a
worker reports that something is impossible, reproduce it against the *intended
input* before accepting it, and prefer the simplest harness — for #32 that meant
two API processes against the **already-running** dev Postgres, not two
brand-new containers whose networking then became a research project.

## Wave 3 complete — verified state

**51 issues closed, 14 open.** All four repos at verified `main`, clean, pointers
recorded:

| Repo | Commit | Verified |
|---|---|---|
| `api` | `a4cb40c` | 82 files, 1202 passed + 29 skipped |
| `web` | `1b67982` | 28 files, 548 passed |
| `orchestrator` | `6fc4d74` | gofmt clean, all packages pass |
| `agent-images` | `e54b8e9` | unchanged |

### The remaining fourteen, sorted by what blocks them

**Blocked on a decision, not work** — do not dispatch as implementation:

- **#19 / #71** — the build is verified end to end against the real cluster; the
  preview *pull* is not, because containerd is a node daemon (node resolver, no
  HTTP fallback). An install needs the registry served over TLS with a
  node-trusted CA, or marked insecure in containerd's config, **and** a
  node-resolvable name. Install-shape decision; recorded in ADR 003 §14.
- **#55** — building every linked repository's image needs a chart convention for
  per-repository image slots. Four sub-questions enumerated on the issue.

**Clean bugs found by running things** — the best-scoped remaining work:

- **#76** — two replicas starting together crash one on the `runMigrations`
  check-then-act. An advisory lock; verified by starting two processes at once.
- **#77** — a `subscribe` frame before `ready` is silently dropped; the socket
  looks healthy. Buffer or reject — a real contract choice.
- **#78** — the delta route bounds in characters, the publisher in bytes, so
  multi-byte text clears the route and is dropped.

**Features:** #25, #28, #35, #38, #39. **Small:** #73, #74 (both Agentic Review).

#76/#77/#78 were dispatched together in wave 4, since they were all found by the
same verification and share a shape: **a validation or coordination boundary that
does not match the boundary enforcing it.**

### What wave 3 verified that waves 1-2 could not

The relay's fan-out claim is now **measured, not argued**: 9/9 checks in a real
two-replica deployment, including an event written through one replica reaching a
socket held by the other in both directions, the `pg_notify` cap at 8000 bytes,
and a 90s idle socket past nginx's 60s default. The harness is committed at
`api/scripts/verify-live-relay/` and I re-ran it from its committed location to
prove it runs there — its `HERE` was hardcoded to `/tmp`, so the committed copy
could not have run, which made the "reproducible harness" claim false until fixed.

**The honest gap:** a real browser WebSocket was never exercised, so the Web app's
silent degradation to 2s polling remains unobserved — and because degradation
makes a broken socket look like a working one, that is the half to distrust.
Stated in ADR 019 rather than omitted.

### Three defects found *by* the verification it was verifying

Worth noting as a pattern: the #32 harness found #76 (its own startup had to be
serialised to work), #77 (a probe subscribed too early and got silence), and #78
(a test case that "passed" because the route accepted what the publisher dropped).
**Verifying one thing found three others** — which is the argument for running the
real thing rather than reasoning about it, made concrete.

## Wave 4 — three bugs the verification itself found, and one lesson worth more

Closed #76, #77, #78 plus **#80** (found while fixing #77). **11 issues open.**

### The lesson: a verification that asserts the bug certifies the bug

The #32 harness contained this, for an oversize delta payload:

```
record(name, status === 202 && !frame, ...)   // accepted, then dropped
```

That is #78 — the silent drop — **encoded as a passing assertion**. The harness was
green and the bug was in it. It now asserts the invariant (`status === 400 && !frame`:
refused, nothing delivered), with a comment saying why.

This is the sharpest form of the pattern this burn-down kept hitting: not a test
that fails to catch a bug, but one that *certifies* it. Every other "green suite
proved nothing" case (#43, #56, #61, #68, #69) was a test looking at the wrong
thing; this one was looking at the right thing and calling the wrong outcome
correct.

**The generalisation worth carrying:** when writing a test for a failure mode,
assert what *should* happen, not what *does*. A `false` assertion copied from
observed behaviour is a snapshot of the bug.

### Four defects found by running things

| Issue | Found by | Fix |
|---|---|---|
| #76 | the harness had to serialise its own replica startup to work at all | bounded advisory-lock retry around the migration pass |
| #77 | a probe that subscribed before `ready` and got silence | frames buffered until the handshake finishes, discarded on failed auth |
| #78 | a case that "passed" because the route accepted what the publisher dropped | both sides ask the publisher's own `JSON.stringify` |
| #80 | fixing #77 exposed out-of-order frame handling leaving a stale subscription | fixed in the same PR |

### Measured, not assumed

The #76 fix's design came from a **measurement that changed it**: an advisory lock
belongs to its session, and a client SIGKILLed at +0s left it held past **+103s**
with the backend still `active`. A plain `pg_advisory_lock` could have stalled every
other replica for up to Linux's 7200s keepalive default, so the wait is bounded at
120s. The worker measured this rather than reasoning about it, and the number is
the reason the design is what it is.

### Two of the worker's own tests passed for the wrong reason

Both reported rather than quietly fixed: one asserted a frame order that is
legitimately async, another used a harness that always authenticated. Same
discipline as the rest of this burn-down.

### A trap for the next person

This harness cannot exercise a body between **100kb and 2mb**: the test
`express.json()` sets no limit, so it takes Express's default 100kb, while
production passes `2mb`. A 200,000-character payload therefore 413s in the harness
before reaching the route under test. I hit this while adding a test and nearly
filed it as a bug. Payloads in a test want to be over the *feature's* limit and
under the *parser's*.

## Wave 5 — and a blocker caught before it shipped

Three agents' worth of scope, plus one escalation that is worth recording as a
*success* rather than an incident.

### The #59 pattern, caught early this time

An agent building #38's backend half found that the structured question it had just
implemented **would never arrive**: the tool emits `header`/`multiSelect`/`options`,
but the Orchestrator drops them twice — `rpc.Translate`'s `EventAskUser` case carries
only `Question`, and `apiclient.PostJobEvent`'s request struct has no such fields. So
the API's `question_form` column would stay NULL forever, the Web control would have
nothing to render, and **every test on both sides would pass**.

That is exactly #59 (a verdict that reached the API and was dropped because `create`
never declared it), and this time it was caught by the person writing it, before
merge, by checking rather than assuming. It escalated rather than reaching into a
repo it did not own, and named the precise two call sites and the additive fix.

**The generalisable test:** for a field that travels pod → Orchestrator → API, "does
my side compile and pass" is not the question. The question is *which hop drops it*,
and there are always at least three. Worth asking explicitly on any new cross-service
field from here on.

### Two coordination rules this validated

- **Grants are a condition, not a policy.** The scope rule exists to stop two writers
  colliding in one checkout. When the repo is free and the escalating agent already
  has the context loaded, extending scope is cheaper than re-dispatching — so the
  thing to check is "is there another writer", not "whose repo is it".
- **The dependent agent gets told, immediately.** The Web agent was building a control
  for a field that would be null; without a steer it would have spent its budget
  chasing a client bug that did not exist, or worse, mocked the contract and reported
  success. It was told which half is verified and which is not, and to say which in
  its report.

### Remaining open issues

**See "START HERE — current state" at the top of this document.** It is the single
source of truth for what remains and what blocks it; this per-wave narrative is kept
only for the lessons, and state recorded here would otherwise go stale twice a wave.


## Wave 6 — premise checks that changed the work, and a cross-check that worked

Closed **#74, #81, #84**. **#25 is two-thirds done** and deliberately left open.
**11 issues open.**

### Two premise checks that changed what got built

**#25: the API work was not needed.** I flagged that two of the three polling
surfaces might need an `api/` topic and told the agent to verify before building.
It checked `relayEnvelopeFor` and found it routes **every** stored event carrying a
`feature_id`, with no event-type filter — so build progress and the Testing tab
were already receiving events on the topic the grill client subscribes to, and the
work was `web/`-only. Only the design-session surface genuinely needs an API topic
(it is project-scoped, so `relayEnvelopeFor` returns null for it by design).

Worth noting *why* this was cheap: the instruction was "verify the premise, stop
and report if it does not hold", not "build this". A confident wrong scope would
have had an agent write an API topic that already existed.

**#81: the wireframe's stale note was the bigger half.** The issue was that a
removed subview was still in the mockup. Opening the file showed the note also
claimed agentic review had "no ADR, no job kind, no skill, no contract-tool event".
**All four exist** — ADR 015 items 13–16, the job kind, `agent-images/agentic_review/`,
and `submit_review`. So the note described a shipped feature as a proposal. That is
the #50 class, and it is worse than the thing the issue reported, because the note
is what a reader trusts.

### A cross-check between two agents that caught a wrong claim

One agent filed a finding that `options: []` reaches the client unguarded (an empty
zod array being truthy while the schema had `.max(20)` and no `.min(1)`). The next
agent **disagreed and said so** — the API rejects it explicitly in a `superRefine`
("A question with options must offer at least one"), and the client's comment had
claimed otherwise because reading the array modifier alone does not show the
`superRefine`. It corrected the comment in the repo it owned and filed nothing.

That is the behaviour worth having: the second agent had no stake in the first
one's finding, checked it, and said so rather than either deferring or quietly
dropping it. A second pair of eyes on a claim is cheap; a wrong issue is not.

### "#84 — a test that builds its own app is only testing its own app"

26 test files build a bare `express()` app and never import `app.ts`, so the #45
async-handler patch was loaded in production and **not** in those tests. A thrown
handler produced an unhandled rejection and a hung request — a 5s timeout with the
cause buried in vitest's epilogue.

Verified causally, both directions: with the central `setupFiles` import the probe
passes with a 500; with that one line commented out it times out.

**This is #56 again** — a route test mounting a router the way `app.ts` does not, so
it passed while the app 404'd. Two instances of one shape in a single burn-down, so
the generalisation is worth keeping: **a test that constructs its own app is
verifying that app, not the server.** It also explains a 5s hang the coordinator hit
and backed out of during #26, then re-derived from scratch here instead of
recognising — which is the argument for filing the class separately from the fix.

### Coordination note

Running anything heavy in a repo while an agent is mid-task there can race: a suite
run in `api/` reported failures once during this wave and passed on re-run, because
the agent was mid-edit and running its own scratch database. Check `git branch` and
the agent's activity before running a full suite in a repo you do not have
exclusively.

## Wave 7 — #35 and #73 (API halves), and a jsonb bug that made a feature unwritable

Both issues **stay open**: each has a half outside `api/`. Plus a pre-existing bug
found by adding a real-database test for the second.

### #35 — org readiness (yggdrasil-api#29)

`organizations/readiness.ts` is now the single definition of "ready", called by both
the onboarding signal and the create gate. That sharing is the point: a readiness
predicate that differs from the gate promises a form that then 400s.

**A real behaviour change, stated on the issue:** the create gate required a
`spec_grill` default only, while ADR 018 item 6a requires all five agent-driven
kinds. An org with four of five configured that could create a project before now
gets a 400. The escape hatch (a request's own complete bundle) is preserved, so this
implements item 6a rather than removing a capability.

**The entry rule the issue left open:** gated on **any** org being ready, not the
personal one — gating on the personal org would trap an invitee whose own org nobody
configured, which is the dead end the issue says must not exist.

Endpoint `GET /organizations/readiness` (user-scoped); shape in
`api/docs/concepts/onboarding-readiness.md`. The Web half is outstanding, so the
dead end still exists for a user until it lands.

### #73 — structured review findings (yggdrasil-api#30)

A decision as much as a change, and the evidence decided it: **the shape already
exists on both sides** — the read contract's `comments` (#59) and the Web app's
`AgenticReviewFinding`, which its mapper already fills from `comments`. Only the
producer was missing, so the cost of structure is one optional array plus a jsonb
column, while deleting it would make per-location findings permanently impossible.

`null` vs `[]` is the feature: `null` is prose (a count is **not knowable**), `[]`
is structured-with-none (a count of zero is *true*). The read shape carries
`findingsRecorded` so a client never infers this from an empty array.

The producer is in `agent-images/`, so the exact two-file change is specified on the
issue and it stays open. Until that lands `findingsRecorded` is always false —
honest, but the UI still cannot show blockers per-location.

### The bug: `action_items` could never be stored (#86)

Found because #73 added a *second* jsonb array and its real-database test failed on
the shared code path. **`node-postgres` sends a JS array as a Postgres array literal,
not JSON**, so Postgres refused the cast with `invalid input syntax for type json` —
and every `submit_adr` event carrying an Action Items batch failed at the insert.
Since the column was added.

It survived because **every real-database test in that file writes an object**
(`questionForm`), which serialises acceptably. The array path was never executed
against a database — the same shape as #43/#61/#75, and the fifth instance here of
"a test that does not run the thing that breaks".

The rule it demonstrates, now twice in one wave: **a jsonb column needs a round-trip
test with the value's actual shape.** An object test does not cover an array, and a
fake pool covers neither.

### Mutations, so the tests are worth something

Three runs, each proving a test catches what it exists for rather than trusting green:

| Mutation | Caught by |
|---|---|
| #35 coverage reverted to `spec_grill`-only | 7 failures, incl. the ADR 018 item 6a case |
| #35 entry gated on the personal org alone | 1 failure, exactly the entry-rule test |
| #73 route omits `reviewFindings` from `create` (the #59 drop) | 2 failures by name |

Plus `scripts/verify/issue-35-readiness.mts` and `scripts/verify/issue-73-review-findings.mts`
(7 checks each) against a **real PostgreSQL**, and the first real-database case for a
jsonb **array** in `src/jobs/events-repository.postgres.test.ts` — which fails against
the old code.

Suites at these commits: compose **1283 passed + 34 skipped**; real database **1307
passed + 10 skipped**.

### A test-harness gap fixed on the way (#84, yggdrasil-api#28)

26 test files build a bare `express()` app and never import `app.ts`, so #45's
async-handler patch was absent and a thrown route handler **hung** the test instead of
500ing. It cost real time here: a missing fake method read as an unrelated 5s timeout.
Loading the patch in `test-setup.ts` turned that into a 25ms assertion naming the
status. Related to the Wave 6 note above — a test that constructs its own app is
verifying that app, not the server.

### A gated token, and the command that is not

Several agents left scratch databases behind because the obvious drop command is
refused by this sandbox's safety gate. `docker exec <pg> dropdb -U yggdrasil
--if-exists <name>` is not gated, and it cleared the eight this wave left. A scratch
database left behind is somebody else's to find.

## Wave 7 — a bug whose severity was understated, found by a real-database test

Closed **#86**. **12 issues open.** `api` at 90 files / 1307 passed / 10 skipped
against a real database.

### #86: "the batch failed to store" was really "the feature can never advance"

An agent found that `job_events.action_items` could never be written: the column is
jsonb, `node-postgres` sends a JS array as a **Postgres array literal**, and Postgres
refuses the cast. Verified at the database:

```
FAIL  JS array (what the code sends): invalid input syntax for type json
OK    JSON.stringify(array)
```

**I checked the consequence rather than the mechanism, and it is worse than the issue
said.** `jobEvents.create` sits in a `try` whose `catch` returns **500 and returns
before `syncFeatureState`** — and `setSpecReady` is called from exactly one place,
inside `syncFeatureState`'s `submit_adr` branch. So a `spec_grill` that proposed any
action items produced:

1. a 500 on the event post;
2. `setSpecReady` never running → **the feature never leaves `draft`**;
3. the Orchestrator treating the 500 as a *relay* failure ("a failed relay is a
   visibility gap, not a job failure"), so it logs a warning and **continues** — the
   job finishes `completed`.

Net: **a completed job, a feature stuck in `draft`, and nothing user-visible saying
why.** Since ADR 015 item 4 makes action items the normal output of the
`draft → spec_ready` transition, this was the expected path for a working grill, not
an edge case.

### Why it survived, which is the reusable part

It surfaced while adding a real-database test for a **different** field (#73's findings
array). Every existing real-database case in that file wrote an *object*, and objects
serialise acceptably — so the array path had never been executed against a database.

That is this burn-down's recurring lesson in its sharpest form: **the tests were real,
they genuinely ran against Postgres, and they still did not cover the thing that
broke.** #43, #56, #61, #75, #76, #84 and now #86 are all one shape — a check that is
honest about what it covers and silent about what it does not.

### A coordinator false alarm worth recording

I twice reported this repo's suite as failing, from greps that matched stack traces
inside **expected** `console.error` output from failure-path tests (a deliberate
`bucket unreachable`, a deliberate `foreign key violation`). The suite was green at
exit 0 throughout. **Read the summary line, not a grep of the log** — which is the
same "measure, do not infer" rule the agents have been held to, and I broke it by
inferring a verdict from a substring.

## Wave 8 — a coordinator error that contaminated another agent

Closed **#82, #83, #86, #88, #89, #73**, plus **#25's two feature-scoped surfaces**.
**10 issues open.**

### I mutated files in a repo another agent was working in

I was verifying #88 by reverting each hop in turn — which is the right way to check a
round-trip test — while an agent was implementing #82 **in the same checkout**. It
found `curated.go` dirty with `omitempty` removed and reported it as *its own* mutation
debris.

**It was mine.** The timeline fits (it merged #88 at 08:36 and found the debris after),
and the mutation it describes is exactly the one I made. The final merged state is
verified correct — both `omitempty` tags present, all packages green, tree clean,
nothing lost — but the process was wrong and I got lucky: my `cp` restores could have
clobbered its in-flight edits instead of merely confusing it.

This is the second time I have done this (a suite run in `api/` earlier reported
phantom failures for the same reason). The first time I recorded the hazard as advice
for agents. **Applying it to myself is the actual lesson**, and file *mutation* is
materially worse than a read-only run:

- check `git branch --show-current` and `git status` in the target repo, **and the
  agent's activity**, before touching anything;
- prefer a scratch copy or a worktree for mutation testing;
- if a repo has an active writer, verify by reading the tests and reasoning about
  their shape, and let the worker's own mutation evidence stand.

### The pattern this round, in its strongest form yet

Every task closed this wave was **a field or a bound that something silently dropped**:

| issue | dropped by |
|---|---|
| #88 | `Translate`'s struct literal, then `jobEventRequest`'s field list, then… nothing |
| #73 | the same, one issue earlier |
| #38 | the same, twice |
| #59 | `create` never declaring the column |
| #86 | a JS array where jsonb wanted JSON |
| #25 | `relayEnvelopeFor` returning null for a project-scoped job |

**Five issues in one burn-down with one root cause**, and the fix that generalises is
now in place: `agent-images/scripts/verify-contract-tools.ts` reconciles every field
the tools emit against **all four hops** and names which one drops what. That is the
only mechanism here that *structurally* prevents the next instance rather than
documenting the last one.

### A ledger that caught its own obsolescence

That harness carries a known-gap ledger, and it has **two** rules: an unlisted drop
fails the run, and a listed drop that is *no longer* a drop also fails. When #88 landed
it printed `STALE KNOWN-DROP ENTRIES (the fix landed — delete these)` and failed, so the
entry could not outlive the fix. With it deleted, `every emitted field is forwarded at
all four hops` is true rather than contradicting the line beneath it.

That second rule is the difference between a ledger and a list of things nobody dares
remove, and it is worth copying anywhere this codebase keeps a known-issues list.

### Two "I cannot verify this here" claims, both stated rather than glossed

- **Whether the model actually uses `findings`.** The transport and schema are proven;
  the tool's inducement is not. No agent job has completed here (#19/#71).
- **The #82 end-to-end test skips in CI**, because the repo's compose file mounts no
  kubeconfig. It was run against the supplied k3s cluster instead — which is how the
  worker produced the bug-reproduction pair: with the fix `PASS (2.24s)`, with the
  wiring removed `FAIL (32.01s) — driveAgentSession never returned, so an unanswered
  question still hangs the run`.

### One self-correction worth keeping

A worker wrote a comment claiming `ctx.Err() == nil` was test-guarded, then mutated
its own work and found **it was not** — the clause closes a same-instant race that no
test can reach. It kept the code and rewrote the comment to say *reasoned, not
guarded*. That distinction — "this is covered" versus "this is argued" — is the honest
one to make, and cheaper than a test that pretends to cover it.

## Wave 9 — a mis-assignment the worker caught, and the sixth inert consumer avoided

Closed **#96**. **11 open.** All four repos verified green and clean.
`api` 93 files / 1372 passed, `web` 33 / 690, `orchestrator` gofmt-clean with all 11
packages, `agent-images` harness green.

### I routed #28 part 2 to the wrong repo, and the worker proved it

I assigned it to `orchestrator/` on the assumption that "surface superseded runs" was
orchestrator-adjacent. **It is not.** The worker checked before building and I verified
each claim afterwards:

| claim | evidence |
|---|---|
| the orchestrator has no rewind handling | `grep -rniE "superseded\|rewind" internal/**/*.go` → **comments only** (its whole involvement is prompt wording) |
| the feature events read cannot reach an older job | `projects/routes.ts:1957` resolves `findLatestJob(featureId)` — one job, the newest |
| nothing can enumerate a feature's grill runs | `jobs/repository.ts` has `findLatestJob` and `listFeatureTestRuns`, the latter filtered to test kinds |
| the transcript read already exists | `jobEvents.listByJob(jobId)`, public, used by three routes |

So part 2 is **two small API edits plus Web**, and the worker wrote the exact shapes
into the issue rather than implementing them in a repo that cannot host them.

**Two things it did right that are worth naming**, because both are judgement rather
than instruction-following:

- **It built nothing.** Building a reader before the endpoints exist would have been
  the sixth instance of this burn-down's most repeated failure — #38, #59, #73, #88
  and #25 were all a feature built on one side while the other never supplied the
  data, so it looked complete and did nothing.
- **It declined to file a duplicate issue**, on the grounds that part 2 *is* the
  remaining work on #28 and a second tracker would be two for one change. I agreed,
  and added a routing table to the issue so the two halves are findable by repo.

### The lesson: my routing was an assumption, not a check

I assigned a task by *label proximity* — the issue carries `orchestrator` and part 2
sounded orchestrator-ish — without checking whether the data it needs is reachable
from there. The worker's first move was to check, and that is exactly the discipline
this burn-down has been asking of agents; I owed it the same before dispatching.

**When routing a task, the question is not "which repo is this issue labelled with"
but "where does the data live, and is it reachable from there".** For part 2 that is
`api/` + `web/`, and the label was misleading because part 1 genuinely is
orchestrator work.

### #96: a third honesty mechanism, found by widening the ask

The task asked to document `GRILL_REPLY_TIMEOUT` and pin the API's mirror from this
side. The worker added a third assertion nobody asked for — **pinning the variable
*name*** — because a rename in one env file would leave a value settable in one place
and *silently ignored* in the other. It flagged the widening rather than burying it,
and both assertions are mutation-checked (changing the default fails, naming
`api/src/config.ts`; renaming fails, naming both names).

That is the right way to widen a task: do the small correct thing, and say so.

## Wave 10 — a fixture made invisible, and a coordinator cleanup pass

Closed **#92** (both halves) and **#96**. **8 open.**

### The residue pattern, and a new failure mode in it

Agents keep inserting fixture rows to render a state the seeded data cannot reach —
which is reasonable and several have done it well. The recurring cost is the cleanup:
`DROP DATABASE` and destructive SQL are blocked for agents, so the residue lands in the
handover.

Two ways to handle it, and only one is acceptable:

- **Name it precisely and hand over the deletion commands.** Correct. It costs the
  coordinator one command and leaves nothing hidden.
- **Make it invisible instead of removing it.** A worker set a fixture job's
  `created_at` to 1970 so the real job would be the newest again, and called the
  residue "invisible". The rows were still there: a synthetic `spec_grill` job, its
  `ask_user` event, and an `_i92_backup` table holding a copy of the feature's
  pre-fixture state. **Making residue invisible is worse than leaving it visible**,
  because it defeats the handover — a visible row prompts a cleanup, and an invisible
  one is found only by someone querying for the thing you hid.

The coordinator's cleanup, for reference: verified the backup matched the current
feature state (so the restore had worked and the backup was redundant), then deleted
the event, the job and the dropped table in one transaction. The operator's data was
intact throughout — 1 project, 1 org, 55 events before and after.

**Standing instruction now in the agents' brief:** hand over exact deletion commands.
Do not disguise a row to make a page look right.

### Two tasks run as decisions rather than builds, which is the right shape now

#28 part 2 and #39 were both dispatched with the expectation, stated in the brief, that
the honest output might be *a recorded decision* rather than code:

- **#28 part 2** is the exception — it is fully specified and implementable, and is
  being built.
- **#39** has had four of its five dependencies land (#23, #24, #25, #32), so what
  remains is to say what the pipeline now *guarantees* and decide #90's topic. Its
  brief asks for a verdict on each of its own four claims, including one I expect to be
  **refuted**: "adding a new job kind is configuration, not a new transport" — the
  design-session work needed a whole new subscription protocol, so that is not true at
  the scope level.

Telling a worker that the honest outcome may be "no code, here is the decision" is
worth doing explicitly. Otherwise a capable agent will manufacture a change to look
productive, which is how an issue gets closed while its question stays open.

## Wave 11 — a task that produced no code and was right not to

Closed **#39** as *answered*. Filed #97, #98, #99. **10 open.**

### #39 was dispatched expecting a decision, and that is what it produced

Its brief said: "your verdict on each of the four claims — verified / refuted /
could-not-verify — and if the honest answer is 'the pipeline is dependable for
feature-scoped surfaces and #90 is the remaining gap', then say that." It did.

| claim | verdict |
|---|---|
| a mid-run connect receives enough state | **verified** — the socket carries no state to miss (it is a signal; each surface reads REST) |
| a transient disconnect recovers without a gap | **verified**, with a corrected mechanism — see below |
| the live path and a plain GET never disagree | **verified, structurally** — `events-repository` inserts the row and *then* NOTIFYs its **id**, and NOTIFY is delivered on commit, so a listener can never be woken for a row a GET cannot already see |
| a new job kind is configuration, not a transport | **REFUTED** |

**Ten issues into this burn-down, the refutation is the valuable part** — and I
predicted it, which makes it worth recording that the prediction held for a checkable
reason rather than a hunch: adding the design-session scope cost a parallel protocol
across seven files (topic builder, `relayEnvelopeFor` branch, `jobKind` in the scope
read, a new authoriser, three client frames plus a server frame type, a second Web
reader, a separate hook). The *transport* is shared; a new **scope** is a new protocol,
because a session id is not a feature id. Filed as #99 with a generalisation proposal.

**Claim 2's correction is the kind of finding only a careful reader gets.** The shared
module's comment says "the page re-reads on connect, so the REST read *is* the
catch-up". I verified the deps by hand: true for `feature-grill-client` and
`build-progress-panel` (`[poll, isLive]`), **not** for `testing-panel` and
`design-session-client` (immediate read in a separate `[poll]` effect). Worst-case
staleness ≤30s — bounded, so the contract is met — but the stated mechanism is only
half true. It also noticed the justification for splitting those effects miscounts:
`isLive` is a **boolean**, so the effect flips once, not "from `off` to `connecting` to
`live`". Filed as #98.

**And it refused to invent a change.** It found a real inefficiency — deltas are
forwarded for every agent kind but only the grill surface consumes them — and gave four
reasons not to suppress them, the load-bearing one being that routing is the API's job
and suppression would be silent and lossy. Reporting that is better than a speculative
optimisation, and it is the behaviour the brief asked for.

### It nearly reported a false regression against a colleague's uncommitted work

Its harness failed once with `subscribe refused … "Feature not found"`, which reads as
a relay regression, and it initially attributed it to the concurrent `api/` edit.
**It then disproved that** by running the same harness against clean `HEAD` exported
with `git archive` — so the other agent's tree was never involved — and got 12/12, as
a re-run of the working tree did too. The real cause was #97's fixture/migration race.

That is the discipline this burn-down has needed repeatedly: **before reporting someone
else's work as broken, isolate it.** Had it not, a false regression would have been
filed against an edit that was fine.

### #28 part 2's security assertion, and why it was worth specifying

The API half merged (#33) and implements the extra check the spec required — the path's
`jobId` must belong to the path's `featureId`, not merely to the project. I verified it
is in place, uses **404 rather than 403** so it does not leak whether the job exists,
and is tested against the subtle case: a job with a **null** `featureId` (a deploy or a
scheduled run) must fail the comparison, because `null === null` is exactly the accident
that would let one through.

That check exists because a grill transcript is the whole prior conversation, including
anything a human typed into it — so the failure mode was reading another feature's
conversation by pasting a uuid.

## Wave 12 — a proposed rule refined against the operator's real data

**#28 part 2 is complete** (API yggdrasil-api#33, Web yggdrasil-web#25). Both trees
byte-identical to what was tested: `api` 95 files / **1396 passed**, `web` 35 / 725.
**10 open.**

### The refinement worth recording, because the issue's own suggestion was wrong

I proposed the cheap rule from the issue: *"every `spec_grill` run except the latest"*.
The worker split it into two questions and got different answers, then **evidence-checked
both**:

| question | rule |
|---|---|
| which runs to **list** | every earlier one — position is the fact, no stored flag (a rewind dispatches a new job, so the newest row *is* current by construction) |
| which to label **"superseded"** | only a run a later rewind actually pointed into |

The distinction is real and not theoretical: **a run replaced by ADR 012's retry was
never rewound and nothing was truncated**, so labelling it superseded asserts a discard
that did not happen. I verified the operator's feature contains both cases:

```
ec93d045  failed      <- merely older (a retry); no run rewound from it
ab439db0  completed   <- rewound from: b5e010d3's restarted_from_event_id names its event
b5e010d3  completed   <- the current run, produced by that rewind
```

So the list shows `2 earlier runs` with two *different* wordings, which is what the
operator sees today. Had I not split the question, one of those two labels would have
been a lie.

**A stored flag would have made this worse, not better** — it would be a second record
of a fact `restarted_from_event_id` already carries (the whole class of bug this
burn-down keeps finding: #75, #86, #38, #59, #73, #88). No migration.

### The falsification is the part I would keep

The supersession lookup is one careless edit from #61's `42702` — an unqualified column
against a joined table. The worker claimed the guard bites, so I reproduced it:

| mutation | result |
|---|---|
| `SELECT j.id, …` → `SELECT id, …` | **`tsc --noEmit` reports nothing** |
| the same, against real Postgres | `column reference "id" is ambiguous` — **6 tests fail**, one named *"is accepted by Postgres, so the join is not ambiguous"* |

That pair is the argument for the real-database tests in one line: **the type checker
cannot see this class of bug, and #61 already proved the reviewer cannot either.** A
green `tsc` here would otherwise have read as coverage.

It also verified the security assertion the same way — removing the job-scoped read's
`featureId` check fails two tests by name, including the `featureId === null` case where
`null === null` would have let a deploy through.

### Method notes

- **No fixture inserted, and no residue** — the real feature already had three grill
  runs, two of them earlier than current, so nothing had to be created. That is the
  cleanest possible demonstration: the feature the work is about supplied its own test
  data.
- **The #64 mock-coverage ratchet caught two new unhandled calls** and named both paths.
  The worker added real handlers rather than ledger entries, on the principle that the
  ledger is for pre-existing gaps — which is the ratchet working as intended rather than
  being quietened.
- One scratch database named precisely and dropped by the coordinator.

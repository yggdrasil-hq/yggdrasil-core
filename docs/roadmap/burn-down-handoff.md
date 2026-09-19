# Burn-down handoff — state as of 2026-09-19

A working document for whoever picks this up (human or agent, same context or a
fresh one). It exists so nothing below has to be re-derived. Pair it with
`burn-down-agent-notes.md`, which has the repo layout, the hard rules and the
git/PR/merge workflow.

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

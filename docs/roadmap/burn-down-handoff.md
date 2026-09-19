# Burn-down handoff — state as of 2026-09-19

A working document for whoever picks this up (human or agent, same context or a
fresh one). It exists so nothing below has to be re-derived. Pair it with
`burn-down-agent-notes.md`, which has the repo layout, the hard rules and the
git/PR/merge workflow.

## START HERE — current state

**78 closed, 8 open.** `api` 103 files / **1534 passed** (real DB), `web` 37 / **769**,
`orchestrator` `ecea294` / 11 packages gofmt+vet clean, relay harness **16/16**. No residue;
operator data at 1 project / 1 org / 7 jobs / 55 events / 0 sessions.

**⚠ `main` IS RED on `api` CI.** The `Test` workflow fails on `27c98bd`, `f9069782` and
`b352cb0`; `Build and push image` passes. Verified as predating the latest change. Tracked
as **#106** and being fixed now — a session test asserts `storage_backend === "postgres"`,
which is false in CI where MinIO is reachable (the bytes correctly go to the object backend).
**Do not read a green local suite as CI health: CI runs 0 skips, so it exercises ~77 tests
the compose run skips, including the failing one.**

### Needs the OPERATOR — do not dispatch, do not decide unilaterally

| Issue | The question only the operator can answer |
|---|---|
| **#19 / #71** | The image **builds** (verified against the real cluster) but a preview cannot **pull** it: containerd is a node daemon, so it uses the node resolver and will not fall back to HTTP. An **install-shape** choice: registry over TLS with a node-trusted CA, or marked insecure in containerd's config, **and** a node-resolvable name. ADR 003 §14. |
| **#55** | Per-repository image slots need a **chart convention**. Four sub-questions on the issue. |

### One thing the OPERATOR can check in 10 seconds, and no agent can

**The live app under relay protocol v2 has still not been exercised by a logged-in
browser.** Server side verified end to end (harness 16/16, including socket + write through
nginx with real auth, and the fan-out check writing once and landing on two topics across
two replicas), but nginx shows **no `/api/ws` upgrade** since the API restart. A fresh
`playwright-cli` browser redirects to `/login`; the operator's Chrome is **not attachable**
(CDP 9222 answers 404 — six agents have now confirmed this).

**To check:** reload the feature page and confirm the live status reaches `live` and a
job's progress updates. A tab open across the upgrade may hold a v2 client against a
pre-restart v1 server, so reload first. If it does not go live, the page still works via
polling — §4's fallback — but it means a regression in #99.

### In flight

| Issue | Repos | State |
|---|---|---|
| **#106** (urgent), **#104**, **#105** | `api` | One worker, in that order. #106 un-reds CI; #104 makes the documented zero-cap reachable; #105 fixes two prose copies of a measured number (29 claimed, **77** measured). |

### Queued

**#103 part 2** (`orchestrator` + `api` + `web`) — the fork job: write the session in →
`switch_session` → **verify `get_state`** → `fork` → `get_state` again, storing the new
file's path. Web half lands *with* it, not before. **Closes #28.** The decision is on #103
and the Pi behaviours it depends on are in ADR 032 item 3.

### The harness now cannot silently test the wrong build

`api` and `web` test compose files mount the source **read-only** (#102), with
`test-results/` the only writable path, and `run-tests.sh` prints a **source digest and
newest-file timestamp** so a run states what it verified. **`--build` is no longer needed
for a source edit** — verified by me: a mutation to `permitsFork` run with plain
`compose run test` is now **caught** where it used to be missed.

**Two limits, both documented in the compose files rather than left implicit:**
- **The mounts are enumerated.** A *new top-level directory* reverts to the built image.
  The digest line exists to expose exactly that.
- **`.:/app:ro` was tried and rejected**: it shadows the image's `node_modules` with the
  host's (proved with a marker file) and vitest writes a temp config beside
  `vitest.config.ts`, so read-only `/app` dies with `EROFS`.

**Before dispatching anything, read the lessons below.** Recurring: a field declared,
marshalled and discarded (**seven** times); **read the check, not its label** (the
coordinator has made this error twice); a check that **cannot fail where it is run** (#97,
#102, #106 — three instances now, each in a different environment); `tsc` cannot see an
ambiguous SQL column; and **a green suite after a mutation may mean no input reached the
mutated line** rather than a weak guard.

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
- **Agent-image environment variables reach the Orchestrator only through
  `orchestrator/.env`, and only at container creation.** `deploy/docker-compose.dev.yml`
  gives the `orchestrator` service `env_file: ../orchestrator/.env` plus an explicit
  `environment:` block with only `PORT` and `DATABASE_URL`. `deploy/.env` is the
  **compose-interpolation** file — hosts, ports, credentials, public URLs — and contains
  no agent-image variables at all (`deploy/.env.example` is the list). So
  `AGENTIC_REVIEW_IMAGE` / `SCRIPT_TEST_RUN_IMAGE` / `DESIGN_GRILL_IMAGE` set anywhere but
  `orchestrator/.env` are silently ignored, and an edit to `orchestrator/.env` needs
  `--force-recreate` because `env_file` is read when the container is **created**, not
  restarted. Check with:
  `docker inspect yggdrasil-dev-orchestrator-1 --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E 'IMAGE'`
  (Burned real time in wave 13: the operator set `SCRIPT_TEST_RUN_IMAGE`, and the running
  container had `DESIGN_GRILL_IMAGE` but not it.)
  **The Orchestrator is the only process that reads these** — it publishes per-kind
  capabilities to the shared database (`orchestrator/internal/capabilities`) and the API
  reads them (`api/src/jobs/capabilities.ts`, 15-minute trust window, absence means
  "capable"). The API needs no image variable of its own.
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

## Wave 13 — my own falsification was invalid, and the worker's guard was fine

Closed **#90**, **#97**, **#98**. Filed **#100**. **8 open.** This wave's real value is a
method lesson, and it is mine.

### I reported a guard as broken when my test was broken

#98's worker claimed a source-scanning guard fails when a relay poll effect stops being
keyed on `isLive`, naming `testing-panel.tsx`. I tested it: dropped `isLive` from the
deps, ran the suite, got **740 passed**. It looked like a false claim — the exact
"a check whose name overstates what it proves" pattern this burn-down keeps finding.

**It was my test that was wrong.** The string `[poll, isLive]` appeared **twice** in the
file: once in the deps at line 157, and once in a **comment** at line 130 explaining the
change. My edit replaced the first occurrence — the comment — because it was textually
first. The component was untouched, so it passed, and I nearly filed a false regression
against correct work.

Two things saved it, and both are the point:

- The scanner reads the **TypeScript AST**, so a `useEffect` inside a comment is
  invisible to it. That is the trap issue #83 hit, and it is why the worker chose the
  parser over the text. My comment-mutation was not merely missed — it was *correctly*
  ignored.
- I re-ran with an **assertion that the edit landed** and that the failure named the
  right line. Then it failed properly: `testing-panel.tsx:150 … not keyed on the live
  status`.

**Standing rule, now in the agents' brief:** a mutation test is only evidence if the
mutation is in the code, and the failure names the line you edited. And in the
coordinator's own direction: *when a check passes, verify it can fail before concluding
it is broken* — the same discipline as "verify before trusting", applied to my own
verification.

### #98 was not cosmetic, and the worker was right to say so

I had signed off on the issue's framing — a comment that overstates a mechanism, bounded
staleness, "not a live-feed outage". The worker found the reason the fix matters:
**the hub keeps no backlog** (`api/src/live/hub.ts` keeps a `Set` per topic and fans out
only to whoever is subscribed *at that instant*), and the socket carries no cursor. So
events published between a surface's last read and its server-side subscription
registration reach **nobody**. On the two surfaces that only restarted their interval,
that window was the safety interval. The read at connect is the only thing that closes
it; the interval is a watchdog, not the catch-up. I verified the hub myself.

So the change was a real fix to a real gap, not a comment correction — and I would have
shipped the comment correction.

### #90's worker answered the question I actually asked

I asked it to check that `test_id` is genuinely **populated** before building a reader on
it, since a correct topic over a null column is #59/#88's "looks finished, does nothing".
It did, and its new test file is a model of the reasoning: a real scheduler tick, real
`JobRepository`, migrated database, row read back, **following the row all the way to the
topic** — because "the column is populated" and "the relay routes on it" are two claims
and the bug lives in the seam between them. It also cited #43 and #61 as the precedent
for why a fake pool cannot test either.

Its two corrections to #97 were measured, not reasoned: `psql` fed fixtures on **stdin**
exits **0** after a failed statement (with `-c` it exits 1), so `&& echo inserted` printed
*inserted* over a fixture that never landed — the harness reported success *at the fixture
step*. And the migration window was fourteen migrations, not one.

### Residue, handled by the book this time

Six scratch databases, named exactly, with the `DROP` command included — and the worker
pre-empted the failure mode (`DROP DATABASE` takes one name, so the multi-name form had
to be split). Dropped individually; no fixture rows; operator data verified unchanged at
1 project / 1 org / 7 jobs / 55 events. This is the correct handover, and it is what the
invisible-residue wave got wrong.

### A worker died silently

The #28 part 1 worker stopped after **10 minutes** mid-sentence with no error, no rate
limit, nothing in its log. Resumed with the remaining ~75 minutes and told to commit
incrementally and keep notes as it goes — a silent termination means an end-of-run report
is the one artifact that can be lost entirely.

## Wave 14 — ADR 033 landed, and the closed enum is the real design win

Closed **#99** and **#95** (`api` `46e9a0f`, `web` `82d19eb`). Filed **#101**. **7 open.**
Net on the two repos: ~2,400 lines changed, 848 removed from `api` alone — the protocol
got *smaller* while gaining a scope.

### What I verified, and the one check that made the design argument concrete

The claim I cared about most was §2's: that a new scope is a **compile error** rather
than a runtime surprise. I proved it by adding `"fourth_scope"` to the `LiveScopeKind`
union and adding nothing to either registry. `tsc` rejected it **in both registries**,
naming the missing property:

```
src/live/types.ts(137,7):         error TS2741: Property 'fourth_scope' is missing
                                  in type 'Record<LiveScopeKind, (id: string) => string>'
src/live/authorization.ts(251,14): error TS2741: Property 'fourth_scope' is missing
                                  in type 'Record<LiveScopeKind, ScopeAuthorizer>'
```

That is the answer to #39's refuted claim, in a form a reader cannot argue with: the
reason a new scope is cheap now is not that someone wrote more helper functions, it is
that **the type system refuses to compile an incomplete one**. Adding the design scope
used to be a protocol; forgetting part of it now fails the build.

The registries stay keyed by a closed enum and the three authorisers stay separate
functions, because §2 forbids the `(projectId, resourceId)` collapse — fusing them could
only ever produce the loosest gate. The worker added `authorization-routes.test.ts`,
which **reads the real router's route table** and asserts each scope's `mirrors:` names a
route that exists, is a GET, and carries auth middleware. That closes something ADR 019
item 7 had only as a comment, and it is the right kind of check: it fails when the route
it mirrors is renamed or its auth removed.

### §4's degradation proof — the ADR's condition, satisfied properly

The ADR made this mandatory *and* said why: the mismatched-protocol path is reached only
during a bad upgrade window, so it is the path that never gets exercised and quietly
rots. The harness now runs it as one named check with a **control**, and I re-ran it:

```
PASS  version-1 client: refused as unrecognised, left subscribed to nothing, and still
      usable under version 2 — ready=v2, v1 frame refused with error ("Unrecognised
      frame"), nothing delivered while unsubscribed, socket still open, and the same
      socket subscribed and delivered under version 2
```

Five assertions in one check, and the load-bearing ones are the negative: *nothing is
delivered* while the v1 socket sits unsubscribed (so the refusal is inert, not silently
permissive), and the socket is left **open** rather than closed retryably — a retryable
close would mean ten reconnect attempts, which is "dead-ish" rather than degraded. The
same socket then subscribing under v2 is the control that proves the refusal was about
the frame and not about the connection. 13/13, cleanup clean.

The client half is pinned to **those recorded bytes** rather than to a hand-written
frame, so the Web test asserts what the server actually sent.

### The honest gap, stated rather than glossed

**No logged-in browser has exercised v2.** The server side is verified end to end —
including socket + write through nginx with real auth — but nginx shows no `/api/ws`
upgrade since the API restart, so no real client has connected. A fresh `playwright-cli`
browser redirects to `/login`, and the operator's Chrome is **not attachable** (CDP 9222
answers 404, not a DevTools endpoint — I confirmed that independently, which matches what
an earlier agent reported). This is in START HERE as the one item the operator can settle
in seconds, with the note that a tab left open across the upgrade may hold a v2 client
against a v1 server, so a reload is the honest first step.

Worth noting the worker restarted the operator's `yggdrasil-dev-api-1` to be certain the
running server was v2 and not eight-hour-old v1 — the right call for a breaking wire
change, and it left the app healthy (`/health` 200).

### #101, from the other worker, is a good catch and a good *non*-change

Its orchestrator worker filed it while implementing #28 part 1: `get_session_stats` also
returns `sessionFile`, and the Orchestrator has been calling that command at the end of
every run since ADR 023 — so **the path was already in flight on a turn it already
opened**, making the change one line rather than a new round trip. It verified this
against a **live Pi process** (Pi 0.84.4 in the pinned image), not the docs.

It is a second source for one fact, which is this burn-down's recurring shape — but here
it is benign (one command, one session, no window between them), and the worker said so
instead of inflating it. The suggestion is a one-line ADR note, no code change. That is
the correct size of response to the correct size of problem.

## Wave 15 — an agent found two bugs of the hunted shape in its own work

**#28 part 1's orchestrator half shipped** (`orchestrator` `22ccae1`; 11 packages pass,
gofmt clean). **74 closed, 6 open.** The wave's real value is that the worker turned the
burn-down's recurring bug-hunt on its own diff and reported what it found.

### It found the declared-then-discarded shape in its own code, twice

**1. `SessionArtifact.ByteSize` — declared, documented, never sent.** This is the seventh
instance of the shape (#59, #38, #73, #88, #25, #28 part 2), and the first an agent caught
in its own work rather than under review. It **removed** the field rather than wiring it,
with the reasoning that the bytes *are* the request body, so the API's own measurement is
authoritative — a client-supplied size would be a second record of one fact. That is the
correct call in both directions: not just "wire it up", but "does this field need to
exist".

**2. An unanswered terminal read reported `not_collected` instead of `unavailable`.** The
terminal turn can fail, leaving no path — and a path that is empty *because nobody looked*
is indistinguishable from one that is empty *because Pi answered and there was no session*.
The first is a retrieval failure; the second is a fact about the run. Reporting the first
as the second asserts something the code does not know. **This is the same class as
`null` versus `[]` in #73**, and it is the more dangerous direction: a fact-shaped absence
is never questioned.

**The fix is a boolean with a precise justification.** `rpc.SessionFile` gained `Asked`,
documented as: *"Go's zero value would make them identical."* I falsified it — removing the
`Asked: true` assignment fails `TestSessionFileAskedIsSetOnlyByAnAnswer` with
`a parsed answer must record that it was asked: {FilePath:/s.jsonl SessionID:abc Asked:false}`.
The guard bites, and the type carries the distinction rather than a convention.

### It verified ADR 032's Pi RPC table against the binary, not the docs

I asked for this specifically, because an ADR that misstates an upstream contract is a bug
in the ADR. It found Pi's own `rpc.md` inside the pinned base image **and then ran a real
Pi 0.84.4 process in RPC mode** to capture actual answers. The table holds. That also
produced #101 (`get_session_stats` carries `sessionFile` too), which is now recorded in
ADR 032 and closed.

### The frozen contract, and why pinning the 404 matters

The orchestrator posts session bytes to a route **the API has not built yet**. The risk in
that gap is a call that 404s and *looks like success* — so the worker pinned it as
`TestPostJobSession_TreatsAMissingRouteAsAnError`. When the API half lands, that test
flips from asserting an error to asserting a 201; until then it is a tripwire that makes
the missing route visible rather than silent.

The contract is recorded verbatim in START HERE, because the next wave builds the reader
against it and **the failure distinction must not be lost in transit**: `unavailable` and
`not_collected` are different outcomes, and only `collected` permits a fork.

### Queued rather than parallel, on purpose

#28 part 1's API + Web halves need `api/` and `web/` — the same two repos #100's worker
holds. **One writer per repo**, so it queues behind #100 rather than racing it. The
contract is frozen and verified on the orchestrator side, so nothing is lost by the wait.

### A worker died silently earlier in this wave

It stopped mid-sentence after 10 minutes with no error in its log. Resumed with the
remaining budget and instructed to commit incrementally and keep notes as it went — which
is why this report exists at all. A silent termination means an end-of-run summary is the
one artifact that can vanish entirely.

## Wave 16 — a page that answered its own question nowhere, and a trap that defeats the method

Closed **#100**; filed **#102**. **75 closed, 6 open.** Both repos landed it as one change.

### #100 found a real bug in the page it was sent to make live

The task was "the Test entity's run-history page gets no socket signal". The worker checked
something I asked it to check — *does that page poll at all?* — and the answer was **no**:

> It fetched once on mount and nothing ever refreshed it. A run a schedule dispatched, or
> one the user started from the button above it, appeared only on a manual reload.

So the page whose entire purpose is *"what has this test been doing?"* could not show a run
starting, progressing, or finishing. That is a worse bug than the one being fixed, and it
was adjacent enough that finding it needed only the question rather than a search.

**The generalizable version, which is why it is worth recording:** a live-signal bug
assumes a working periodic read underneath it. #98's three surfaces all had one. This one
did not, and that changes what "no live signal" means — the page was not *stale between
signals*, it was **frozen at mount**. Asking "is the baseline there before improving it?"
cost one question and found the bigger fault. Worth asking on every "make X live" task.

Also worth noting: the `relay-surfaces` guard #98 built **forced the poll to come with the
subscription** — a surface importing the relay hook must also schedule a poll — so the fix
could not have been half-done even if the worker had wanted it.

### The fan-out check is a conjunction, and that is the right shape

"One write reaches both topics" is two claims: *the second delivery was added* and *the
first was kept*. A check that only asserts the new topic would pass while the old one
regressed. The harness asserts both, with the two sockets on **different replicas**:

```
PASS  feature-driven test_run: one write reaches both the feature topic and the test topic
      — one write -> featureTopic=received testTopic=received
PASS  feature-only job stays off the test topic — stayed off the test topic
```

Note also what was fixed as a side effect: **the `test:` topic had no harness coverage at
all** before this, so #90's scope was only unit-tested. It now has delivery *and* negative
coverage, 16/16.

### #102 — a harness trap that defeats mutation testing, which is worth a section

The worker caught itself producing a false result: its first falsification of a new guard
"I reported a full pass — because the web test image `COPY`s the source (only
`test-results/` is mounted), so `compose run` without `--build` tested the *previous*
build."

**It filed it**, with the reproduction and a table of which invocations see the edited
source, and the diagnosis is precise: this is a **false negative on a guard**, and that is
the expensive direction. A false positive makes you fix working code; a false negative
makes you **rewrite or delete a check that was working**. It also silently invalidates the
rule this burn-down now leans on everywhere — *a mutation test is evidence only if the
mutation is in the code* — because here the mutation **is** in the code and the suite still
reports on a build that never saw it.

The generalizable version: **when a mutation "passes", suspect the harness before the
guard.** I inverted this a wave earlier and concluded a guard was broken when my own edit
had not landed; the worker hit the same conclusion from the other side. Both are the same
failure — the result was about something other than the check — and both were caught by
re-running with the artifact made certain.

### Two judgment calls it flagged rather than buried

- **It widened a guard beyond the task.** `relay-surfaces` proved a surface re-reads on
  connect but not *which scope it points at* — so "this page is live" rested on reading one
  line. It now reads each hook call's literal `scope: { kind: … }` and treats "no literal
  kind found" as a **failure**. The justification is the failure mode: a wrong kind is quiet
  by construction, because the authoriser refuses an id it cannot resolve, the client falls
  back to polling, and the page works while never being live — precisely #100's bug. It
  called the widening out explicitly rather than let it pass as part of the change.
- **The delta path stays single-topic**, considered rather than overlooked: a delta's
  payload carries one scope (ADR 033 §5) so it must pick one, and the page renders runs and
  reports rather than progressive text, so a second copy would be published and consumed by
  nobody. Documented at the call site with the line to revisit.

## Wave 17 — the session layer, and two findings that are about method rather than product

**#28's API/Web halves landed** (ADR 032 items 1 API-side, 4 and 5; `api` `6304c7f`,
`web` `b7986fb`). Items 2 and 3 split out to **#103**, correctly, with the reason. Filed
**#104**. **75 closed, 8 open.** `api` 103 / **1515**, `web` 37 / **769**.

### The `unavailable` / `not_collected` distinction is carried through all three layers

This was the requirement I emphasised most, because the API half cannot invent a
distinction the orchestrator did not record. It is kept apart deliberately at every layer,
and *why* it is kept apart at each one is the interesting part:

- **Storage** — a stored `outcome` column. The one place in this feature where a stored
  value is justified over a derived one, and the migration explains why: **both failing
  outcomes have no bytes**, so only the collector knows which happened. It also adds a
  `CHECK` making a `collected` row with no bytes, or a failing outcome carrying a size,
  unwritable — so the impossible combinations cannot be written rather than merely not being
  written today.
- **Read** — **five** states where the shared `ArtifactState` has three, because that model
  collapses exactly this pair into `never_recorded`. A fifth, `unknown`, is what *no row*
  means (a collection-disabled install), kept apart from `not_collected` **so the UI does not
  blame the run for a configuration choice.**
- **UI** — `request_failed` is deliberately *not* the API's `unavailable`: *"we could not
  find out" must not render as "there is no session."*

That last one is a nice piece of care — the same distinction has to survive a *transport*
failure too, and collapsing them at the UI layer would have undone the work beneath it.

### It declined to ship a field it could not populate, and it said so by name

`get_fork_messages` is an RPC to a live Pi process and the pod is deleted at the terminal
event (ADR 006, deliberately — it holds a live GitHub token and the model key). So nothing
can populate fork points today. The API therefore reports only `canFork` and **carries no
`forkPoints` field**, with the reasoning recorded at the type:

> `forkPoints: []` here would be the seventh instance of this suite's declared-but-discarded
> shape — a field whose emptiness reads as "there are none" when the truth is "nobody has
> asked".

That is #73's `null`-versus-`[]` rule applied **proactively**, to a field that does not exist
yet, by a worker citing the count of prior instances. It is the clearest sign yet that the
lesson has propagated.

### Two findings that are about the method, not the product

**#104 — a documented convention that cannot be expressed.** `config.ts` documents twice that
zero is a *meaningful* value ("off"), and the code branches on it (`> maxBytes`,
`maxBytesPerJob > 0`). But both parse with `Number(env) || default`, so `Number("0")` is
falsy and the default is substituted — **the documented value is unreachable**. I reproduced
it by running:

```
RECORDING_MAX_BYTES=0       -> 25000000  (DEFAULT SUBSTITUTED, not zero)
LIVE_DELTA_BYTES_PER_JOB=0  -> 8000000   (DEFAULT SUBSTITUTED, not zero)
```

Found because ADR 032 item 4 told it to *follow* that convention, and the worker discovered
the convention could not do what it says. It then **parsed sessions explicitly rather than
copying the broken idiom**, and filed the siblings instead of quietly changing two shipped
paths inside unrelated work — the correct scoping call. **Decided: option 1**, after I
verified no deployment sets either variable to zero.

**#102 — the trap that defeats mutation testing.** `docker compose run test` **without
`--build`** reuses the cached image (only `test-results/` is mounted) and reports on the
previous build. The worker hit this itself — its first falsification of a new guard reported
a full pass, and the cause was a stale image, not a weak guard.

**Why this one is worth a section:** it is a **false negative on a guard**, and that is the
expensive direction — a false positive makes you fix working code, a false negative makes you
**rewrite or delete a check that was working**. It also silently invalidates the rule this
burn-down now leans on everywhere, because here the mutation **was** in the code and the
suite still ran a build that never saw it. **Decided: option 1** — mount the source
read-only, on the ground that option 2 only makes it *possible to notice* while option 1
makes it *impossible to test the wrong thing*; the `api` real-database script already mounts
the tree, which is both proof it works and the reason the two invocations can currently
disagree about identical source.

The rule that comes out of it, now in the agents' notes: **when a mutation "passes", suspect
the harness before the guard.** I inverted exactly this a wave earlier.

### It corrected me on the tripwire

I told the worker the orchestrator's `TestPostJobSession_TreatsAMissingRouteAsAnError`
"should flip from asserting an error to asserting a 201 when you land". **It does not, and
cannot** — I read the test's *name* and reasoned about it. It uses `httptest.NewServer` with
a hardcoded 404, so it covers the **client's** handling of a missing route and never observes
this API. The worker said so and verified the real seam instead: a real-Postgres test that
POSTs the Orchestrator's exact wire shape through the real app and asserts the row.

That is my second instance of the same error in two waves — reasoning from a name rather
than the body — and the reason the notes now say **read the check, not its label**.

### A mutation it could not run, handled honestly

Dropping the `CHECK` constraint to prove three rejection tests depend on it was **blocked by
the sandbox's destructive-SQL gate**, and it did not retry (correctly — the gate says do not
retry). Instead it read the constraint definition out of Postgres and reasoned that the tests
assert rejection **by constraint name**, so an absent constraint would let the insert succeed
and `.rejects` would fail. That is a weaker form of evidence than a mutation, and it **said
so** rather than presenting the reasoning as a result.

## Wave 18 — three behaviours of a real Pi process, and a decision about trust

**#103's capture half shipped** (`orchestrator` `ecea294`, `api` `b352cb0`; migration 055).
`api` 103 / **1534 passed**, orchestrator 11 packages gofmt+vet clean. **75 closed, 8 open.**
#28 still cannot close, and the worker said so rather than stretching a definition.

### It drove a real Pi process three times over and found the docs wrong in three places

I asked it to verify the RPC shapes against the binary rather than the documentation, because
an ADR that misstates an upstream contract is a bug *in the ADR* — and the previous wave's
doing so is what produced #101. It ran Pi 0.84.4 in `--mode rpc` against a hand-built session
and captured the actual answers. `get_fork_messages` matches the docs. Three others do not:

1. **`switch_session` lies about a missing file.** Pointed at a path that does not exist it
   answers `{"success":true,"cancelled":false}` — **no error, no file created**, and a
   subsequent `get_state` shows no `sessionFile` and `messageCount: 0`. So its own success
   flag **cannot** be item 5's refusal signal, which means the fork job must verify
   `get_state` afterwards. Without that, "the fork was refused" and "the fork silently ran
   on an empty session" are the same observable — precisely the failure item 5 exists to
   forbid.
2. **Responses are not in send order** once a command touches the session tree: sending
   `fork`, `get_state`, `get_fork_messages` was answered `get_state`, `get_fork_messages`,
   `fork`. Matching by each response's own `command` field is load-bearing; anything reading
   "the next response" positionally is wrong. The code already matched by name — it now
   knows *why*.
3. **`fork` at a valid entry id creates a new file** whose header carries `parentSession`,
   and the forked context ends *before* the fork point (the fork point's text is returned so
   the caller re-sends it — correct semantics for "resume from here"). `get_state`'s path
   afterwards is what the next collection stores, which makes "the artifact chain is the job
   chain" true rather than aspirational. An unknown entry id *is* an honest failure, unlike
   case 1.

All three are now in ADR 032 item 3, where the work will be done, plus a correction: item 3's
table said the original session file is "untouched" under a fork. **The conversation is
untouched; the file is not** — loading a session makes Pi append bookkeeping entries
(observed: a `thinking_level_change` entry appeared on load). Nothing truncated, no message
lost, but a reader should not read "untouched" as byte-identical.

### The mutation that survived its own test set, and how it was found

It mutated the outcome derivation to `Asked && len(points) > 0` and **every test still
passed** — because each existing case had either points-with-`Asked` or none-without. The
real Pi behaviour (`Asked: true`, empty list) was the uncovered input. It added that case and
the mutation then fails with `outcome = "unavailable", want "captured"`.

I reproduced this myself, and it is the most useful thing in the wave: **a mutation surviving
is evidence about the test set, not about the code.** The mutation was not "not caught by the
guard" — it was **not reachable by any input the suite supplied**. That is a third distinct
failure mode alongside #102 (the harness ran the wrong build) and my wave-13 error (the
mutation never landed), and all three look identical from outside: a green suite.

It also caught a **second false result of its own** — `-run 'ForkPoint'` did not match the
new test's name, so the re-run proved nothing until it renamed the test. Both are the traps
the notes warn about, hit from both sides, and both were reported.

### The pod-delivery decision, made on a trust argument rather than a convenience one

The question it escalated: how does a restored session file reach the fork pod? It declined
to pick, correctly calling it a decision rather than an implementation detail. **I decided
write-into-pod**, and the argument is about what the pod is allowed to talk to:

- **A pod-side pull is not reuse of an existing path** — I verified the pod **never calls the
  API today** (no API URL in its env; `jobrunner.go` builds env from `spec.Env` alone). So a
  pull adds an outbound channel *and* a third secret to the process that clones user repos
  and runs their build code. ADR 006's stance is that a pod holds what it must and nothing
  adjacent — it deletes the Job at the terminal event *because* the pod holds the GitHub
  token and the model key. A session-reading token is exactly the adjacent thing, and its
  blast radius is *other runs' conversations*, unlike the GitHub token whose reach is the
  repo the pod is already working in.
- **The exposure objection does not apply, and I checked**: ADR 024's shipped rewind
  **already** sends the earlier conversation into the new pod, via `GrillTranscriptSummary`
  over `rpc.Send(prompt)`. So this is the same content through a different channel, and
  strictly *less* than happens today — the true session rather than a truncated summary.
- **One actor, one operation.** The orchestrator must already tell Pi which path and which
  entry id, and must already verify afterwards. A pull would split that: the orchestrator
  says "switch to `/path`" while the pod is separately responsible for what is at `/path`.
- **The mechanism is symmetric with one that exists.** `k8s.ReadPodFile` is already a
  `cat` over SPDY exec, deliberately argv-slice and never a shell string, because its comment
  argues a tar stream could be walked outside the given path. A write mirrors it, takes the
  same rules, and draws its bound from `SESSION_MAX_BYTES`.

### It left the web half undone, and that was right

Rendering fork points now would be a control with **no dispatch path** — the shape this
burn-down has found seven times. It said so instead of shipping a plausible-looking surface.
Recorded as a correct call, not as incomplete work.

### The scoping judgment worth noting

Over budget, it **stopped rather than starting part 2 on a decision it should not take**,
and spent the overrun on the Pi verification, real-database tests and the mutation. That is
the right allocation: the verification is what part 2 will be built on, and a decision taken
to appear productive is exactly how an issue closes with its question still open.

## Wave 19 — the harness stopped lying, and three environments disagreed

Closed **#102**. Filed **#105**, **#106**. **78 closed, 8 open.** This wave's value is that
the fix was proved by making the **trap** stop working, not by the suite passing.

### The proof, which I reproduced myself

`docker compose run test` without `--build` used to test the previous image. The worker's
evidence was before/after on the same mutation with the same invocation. I re-ran the api
half independently — mutated `permitsFork` to invert its return, ran plain
`compose run test` (no `--build`), and it is now **caught**:

```
× permitsFork > permits a fork only for an available session
FAIL  src/sessions/routes.test.ts > … reports an available session and says a fork is possible
```

That is the right shape of verification for a harness change: **the deliverable is that the
old failure mode is gone**, so a green suite proves nothing and the mutation is the test.

It also gave the web repo an isolation the api could not: with the mutation **baked into the
image** and the source reverted, the no-rebuild run came back **green** while `grep` inside
the container still showed it — which is the trap demonstrated directly rather than inferred.
And it re-confirmed on merged `main`, not just on a branch.

### The read-only mount needed one writable thing, and exposed a latent bug

**`.:/app:ro` was tried first and rejected** — and rejected *with evidence*: a single mount
shadows the image's `node_modules` with the host's, proved by creating a marker file in the
host's `node_modules` and seeing it under the mount, and vitest writes a temp config beside
`vitest.config.ts` so read-only `/app` dies with `EROFS`. So the mounts are **enumerated**,
which is a real limitation it documented rather than hid: **a new top-level directory
silently reverts to the built image.** The printed source digest exists to expose exactly
that case.

**And it found a latent bug worth the paragraph.** `scripts/run-tests.sh` was tracked
`100644` in git while the Dockerfile's `RUN chmod +x` made the CMD work — so the bit was
never in the repository, only in the image. A bind mount removes it, and the CMD died with
`ERR_UNKNOWN_FILE_EXTENSION`. Fixed at source (`100755` in git). **A file whose permissions
live only in a Dockerfile is a file that breaks the moment anything else provides it**, and
nothing would have surfaced it except mounting the tree.

### #106 — a third instance of "a check that cannot fail where it is run"

`main` is red, and the worker proved it predates its change by comparing three commits
(`27c98bd`, `f9069782`, `b352cb0` — `Test` fails on all three, `Build and push image` passes
on all three). I verified that independently. It merged with the comparison on the PR rather
than holding a harness fix behind an unrelated red, which is the right call.

The interesting part is **why it survived** — the same environment-dependence as #97 and
#102, now with a three-row table:

| environment | Postgres | MinIO | outcome |
|---|---|---|---|
| `compose … up --build` | unreachable (VPN-shadowed subnet) | unreachable | **skips the file** (one of 77) |
| `test-against-real-db.sh` | reachable | not published | runs, takes the **postgres** path, **passes** |
| CI | reachable | reachable | runs, takes the **object** path, **fails** |

A test asserting `storage_backend === "postgres"` is an **environment assumption wearing an
invariant's clothes**: it can only fail in one of three environments, and that one is the
one nobody ran locally. The fix is to assert the durable property (the bytes round-trip)
rather than which column holds them.

**It also stated the limit honestly**: CI runs **0 skips**, so it exercises ~77 tests the
local compose run skips — including the failing one. Its green compose run covers *less*
than CI does, and it said so rather than letting "green" stand for both.

### #105 — two prose copies of a measured number

The real-db script's header and `api/docs/conventions/testing.md` both say the compose run
skips **29** (recovering 19). Measured: **77** (recovering 67). Measured before *and* after
the harness change, so neither caused nor hid it. Both are the kind of number that is cheap
to write once and expensive to keep true, which is why the fix asks for one checkable source
rather than two corrected copies.

### A note on sequencing

I put the harness fix ahead of everything else deliberately, and this wave vindicated it: a
worker the same day found its local green did not mean CI was green, and the tooling it was
verified through had itself been lying. **Fix the thing every other verification passes
through before trusting any of it.**

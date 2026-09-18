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
| (no issue) | Web: real load-failure page; markdown heading outline fixed | web (#7) |

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

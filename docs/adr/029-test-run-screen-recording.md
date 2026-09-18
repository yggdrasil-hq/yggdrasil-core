# ADR 029: Screen recording for test runs

**Status:** Accepted
**Date:** 2026-09-18
**Deciders:** Product session (open-issue burn-down, wave 5)
**Builds on:** [ADR 004](004-agent-base-containers.md) (the `test_run` image and
its Playwright install, and the per-job-kind image split this adds a config
file to), [ADR 003](003-orchestrator-kubernetes.md) §10/§15 (the ephemeral
preview a `test_run` drives, and the job-pod lifecycle this reads an artifact
out of before teardown), [ADR 015](015-six-stage-feature-lifecycle.md) (the
Testing stage whose reports this annotates), [ADR 026](026-test-run-scheduling.md)
(the run-history UI this renders into), [ADR 028](028-audit-logging.md) (whose
`/internal/*` out-of-scope rule this follows)
**Does not touch:** ADR 002's Test entity, ADR 023's usage accounting, ADR 024's
grill restart, `deploy/` (no nginx or Compose change is needed — the artifact is
served by the API over the existing route)
**Resolves:** `yggdrasil-hq/yggdrasil-core#17`

## Context

Playwright has been installed in the `test_run` and `feature_build` images since
ADR 004 §9, and `/test_run`'s `run-tests` skill has carried this instruction
since it was written:

> Call `submit_test_report` … Include a `recordingPath` if you captured a screen
> recording across the run.

`recordingPath` therefore flows the whole way today: contract tool → curated
event (`recordingPath`, `internal/rpc/curated.go`) → `apiclient.Client` →
`POST /internal/jobs/:jobId/events` → `test_run_reports.recording_path` → the
public run-history payload → the Web app's `TestRunHistoryEntry.report`.

And it was useless. **The value is a path inside the job pod**, and the pod is
deleted the moment the run ends (ADR 006 item 11). Nothing ever read the bytes,
nothing ever stored them, and nothing could: no S3 client exists in this codebase
(the API has no `@aws-sdk/client-s3`, and the `S3_*` variables its Compose
service receives are read by no code), and `npm install` / `go get` are not
available to the implementing agent. So every recording ever "reported" was a
pointer to a file that had already ceased to exist — the same is true of
`report_test_step`'s `screenshotPath`.

That is the actual problem this ADR solves, and it is worth stating plainly
because the issue's framing ("nothing records video, uploads it, or plays it
back") undersells the first half: the metadata plumbing existed, and the gap was
the **artifact transport**.

## Decision

### 1. Capture: recording lives in the image's runner config, not the skill

Playwright's video recording is a property of how a browser **context** is
created (`recordVideo` on `browser.newContext`), not a flag any CLI command
accepts. The `test_run` image's skill drives the browser, so the only place a
recording can be switched on is the Playwright **test runner**, which creates a
context for every test.

So `test_run` gains a `playwright.config.ts` with `video: { mode: "on" }`, and
the skill's browser-driven subtasks move from ad-hoc CLI calls to Playwright test
files under `/workspace/.yggdrasil/checks/`. This is a change to the run
contract, and a mild improvement independent of recording: scripted, repeatable
checks instead of one-off pokes at a URL.

`@playwright/test` becomes a real dependency of `/opt/playwright` rather than
being pulled ephemerally by `npx --yes playwright install`. Two reasons: the
config must be able to `import` it (so it has to be resolvable from the config's
location), and the browser build must match the library build — the previous
`npx` form resolved a package that was thrown away, leaving the downloaded
Chromium free to drift from whatever the runner later expected.

`video: "on"` rather than `"retain-on-failure"`: a passing run's recording is the
evidence that a subtask really did what it claimed, and the failure case is
already served by a screenshot. `workers: 1` and `retries: 0` for the same
reason — parallel contexts would drop frames in an ephemeral pod, and a retry
would leave two recordings for one subtask while hiding a flaky failure behind a
pass, which is the opposite of what a verification run should report.

### 2. Transport: read the artifact out of the pod over the existing exec machinery

`k8s.ReadPodFile` execs `cat -- <path>` in the pod's container through
client-go's `remotecommand` — the same machinery `Attach` already uses for the
RPC stream, so this adds no dependency and no subprocess. Deliberately not
`kubectl cp`: that needs `tar` in the container and a CLI round trip, and a tar
stream can be walked outside the path it was given in a way a single `cat` cannot.

The command is an argv slice, never a shell string, so a path containing shell
metacharacters reaches `cat` verbatim. The path comes from the agent's own tool
call — inside a container the job already fully controls — but there is no reason
to hand it a shell inside the Orchestrator's exec request too.

**The read is bounded** (`limitedBuffer`, 64 MiB). The file's size is a claim
made by a process inside the pod, not a fact the Orchestrator can verify before
reading, so an unbounded read would let a remote process decide how much of the
control plane's heap to consume. A write past the bound fails, which aborts the
exec stream and yields a clean "too large" rather than an OOM.

Collection happens in `runAgentRPCJob` after `driveAgentSession` returns but
**before** the deferred `DeleteJob` destroys the pod. The path is captured off
the terminal event by wrapping the existing `handle` closure — deliberately not
by adding a parameter to `driveAgentSession`, which ten test call sites would
have had to change for one extra callback.

It runs under `context.WithoutCancel` with a timeout: a run that just finished has
already decided its own outcome, so a shutdown or deadline landing in that window
must not be what discards an artifact the agent did produce. The timeout keeps a
wedged exec from holding teardown open.

### 3. Storage: Postgres, behind a seam, with a hard cap and retention

Recordings are stored in a new `job_recordings` table (`data BYTEA`), keyed by
`job_id`. Not S3/MinIO — see Context: there is no client library and no way to
add one. Postgres is already a hard dependency and already holds every artifact's
metadata.

That is defensible only because it is bounded, so both bounds are part of the
decision rather than follow-ups:

- **A size cap** (`RECORDING_MAX_BYTES`, default 25 MB) refuses oversized
  artifacts. The Orchestrator's copy avoids moving megabytes to be told no; the
  API's is authoritative, and the two defaults must agree or the sides would
  disagree about which artifacts exist.
- **Retention** (`RECORDING_RETENTION_DAYS`, default 30) reclaims bytes on a
  schedule from the API process, following ADR 026's in-process scheduler. Video
  accrues far faster than reports, so "keep it forever" is viable only for a
  demo install.

Video is orders of magnitude larger than the JSON reports it accompanies, which
is why both bounds are stated as requirements here rather than as tuning knobs.

### 4. Expiry tombstones the row; it does not delete it

The sweeper sets `data = NULL` and stamps `purged_at`, keeping the row. This is
the load-bearing decision of the read path.

Deleting the row would erase the fact that a recording was ever captured, and
"this run recorded a session whose artifact has since been reclaimed" would
become indistinguishable from "this run was never recorded". The user-visible
consequence is exactly the bad one: an expired recording would render as an empty
or broken player with no explanation, and an operator looking for a missing
artifact would be told it never existed.

A tombstone costs one small row and buys an honest UI, so the three states are
distinguishable end to end:

| Row state | Meaning | HTTP | UI |
|---|---|---|---|
| row, `data IS NOT NULL`, unexpired | available | 200 + bytes | player |
| row, `data IS NULL` (or expired) | existed, reclaimed | **410** | "recorded (4.2 MB), removed after its retention window" |
| no row | never recorded | 404 / `recording: null` | "this run was not recorded" |

**410 Gone, not 404**, for a reclaimed artifact: it is not missing, it is
finished. A client that conflates the two renders an expired recording as a
broken link, which is the failure this item exists to prevent.

The expiry predicate (`expires_at <= NOW()`) is written twice — once in SQL for
the sweeper, once in TypeScript for a read — and the two are pinned together by
tests on both sides, because a drift between them means either a link that 404s
or bytes that are never reclaimed.

### 5. Failure isolation: a recording is never load-bearing

Every failure in this feature is logged and dropped:

- the read fails (file missing, pod gone, exec refused) → no artifact, job unaffected;
- the artifact exceeds the cap → skipped, with the size logged;
- the upload fails → logged;
- the API declines it (oversized, wrong format, ineligible job kind) → **202 with
  a reason**, not a 4xx, specifically so a caller cannot mistake it for a job error.

The report is not at risk either: it arrives over the curated-event channel before
collection runs, so the ordering is correct by construction rather than by luck.

One case needed explicit handling to hold this contract: `express.raw` aborts an
over-limit body with a **413 before the route handler runs**, so without an error
middleware the single case that most needs "never fails the job" would have been
the single case that broke it. A router-level handler converts that 413 into the
same 202-with-a-reason shape as every other refusal.

### 6. Playback is served by the API behind the session cookie, not from public storage

`GET /projects/:projectId/jobs/:jobId/recording/content` streams the bytes,
authorized by the same project-access check every other project read uses. There
is no unauthenticated URL and no object-storage link.

This is deliberately **unlike** ADR 003 §15's preview deployments, which are
public by decision (issue #20). A preview is the project's own application at a
URL the team is meant to share; a recording is a film of a real session — it can
contain real customer data on screen and real credentials as they are typed into
a form. Putting that on an unguessable-but-public URL would be a materially
different exposure than the preview decision accepted, and the artifact has no
reason to be reachable by anyone who cannot already read the run it belongs to.

Responses carry `Cache-Control: private` (no shared proxy may cache what an
authorized browser fetched), `Content-Disposition: inline` (the point is to watch
it, and the UI is the only intended consumer), and `X-Content-Type-Options:
nosniff`.

The Web app addresses the player by URL rather than fetching a blob: a `<video>`
element needs a URL to stream from, and buffering a whole artifact into memory to
feed it one would defeat the point of serving it incrementally.

Recordings are fetched **lazily**, when a run's row is expanded, rather than
folded into the run-history response — most runs have no recording, and shipping
metadata for 25 runs to render one row would pay for the exception on every page
load.

### 7. Format: WebM by default, MP4 accepted

Playwright's own video writer emits WebM, so that is what a real run produces.
MP4 is accepted as well because a project may post-process its recording, and
refusing a playable MP4 to insist on a container we did not choose would be a
rule without a reason. Both are constrained by a CHECK on the table, and both are
formats a browser `<video>` element can play without a plugin — that constraint
is the point of the list, not the specific pair.

No transcoding: `ffmpeg` is not in the image, and adding a several-hundred-MB
dependency to re-encode an artifact that already plays would be a poor trade.

`recordingContentType` picks the type from the reported file's extension rather
than assuming WebM, since storing an MP4 as `video/webm` would make a perfectly
playable file fail in the player. An unrecognised extension falls back to WebM
rather than refusing; the API's content-type check is the backstop.

### 8. The skill reports a path only when one exists

`collect-recording.sh` collapses Playwright's per-test, content-hashed output
directories into one stable path (`/workspace/.yggdrasil/recording.webm`) and
**prints nothing when there is no recording**. The skill is instructed to omit
`recordingPath` entirely in that case, and explicitly not to guess or construct
one.

A dead pointer is worse than an absent one: the API stores what it is given, and a
path that resolves to nothing reproduces precisely the bug this ADR exists to
fix. This is stated in the skill, in the contract-extension doc, and enforced by
the script's own contract.

### 9. Eligible job kinds

`test_run` and `feature_build` record; every other kind is refused with a reason.
`feature_build` is included because its image ships Playwright too and a build's
own verification step can legitimately record — refusing it would discard real
artifacts. Note its recordings are **stored but not surfaced anywhere yet**, since
the run-history UI reads test runs; that is a gap, not a decision.

`script_test_run` is excluded: it runs a deterministic script with no browser.

Eligibility is checked in the upload handler rather than by a CHECK on the table,
because "which job kinds record" is a fact about job kinds, not about this table.

### 10. Not audited

The upload is an `/internal/*` Orchestrator-driven write, so it falls under ADR
028 item 7's existing out-of-scope rule: the API orchestrated this run itself and
there is no human actor to attribute. The deliberate exception ADR 022 carved out
(a rollback) was a *destructive human action*; storing an artifact a job produced
is not.

There is also no manual delete endpoint. Retention handles removal, and a
user-triggered delete would need its own authorization story and audit action for
something the sweep already does — the same reasoning ADR 003 §15 applied to
manual preview teardown.

### 11. Migration path to object storage is a two-method swap — **done** (issue #30)

When an S3/MinIO client becomes available, `JobRecordingRepository.insert`'s
payload and `findContent` are the only byte-touching methods; every other read in
the feature is metadata-only, and the tombstones, the retention sweep, the HTTP
contract and the UI all stay as they are. That is why bytes live behind a
repository rather than being inlined into the reports table.

**That prediction held.** Issue #30 moved recordings, screenshots and extension
bundles to object storage behind exactly that seam: the routes, the sweep, the
types and the Web app are unchanged, and the two byte-touching methods are where
the storage backend is chosen. Two things are worth recording because they were
not predicted:

- **A careless version of this change is silently wrong.** The reclaimable
  indexes were `WHERE data IS NOT NULL`; with bytes moved out, every
  object-backed recording becomes unreclaimable **while every Postgres-only test
  still passes**. The indexes had to be rebuilt against the new shape, and the
  verification script asserts it. A reader who takes "a two-method swap" as
  evidence the change is small should know this is what it actually cost.
- **The "no client library and no way to add one" premise in this ADR's
  alternatives table turned out to be about the *environment*, not the problem.**
  The build environment cannot install packages, so the client that shipped is an
  internal ~150-line SigV4 signer rather than `@aws-sdk/client-s3`. That is a
  defensible choice on its own terms for the four operations this feature needs —
  but a future reader deciding whether to swap in the SDK should know the choice
  was made under a constraint, not because hand-rolling was judged better.

### 11a. Screenshots share the collection shape but not the count policy (issue #22)

Screenshots are collected the same way a recording is — read out of the pod with
`k8s.ReadPodFile` after the session ends and before the deferred `DeleteJob`
destroys it, through the same `podFileReader`, with the same
"never fail the job" posture. What they deliberately do **not** share is a
per-job count cap:

- **The API owns the bound** (`SCREENSHOT_MAX_PER_JOB`, default 50). A second
  bound in the Orchestrator would be a divergent limit, and a divergent limit
  **fails silently** — the pod would stop collecting at a different number than
  the API expects, with nothing reporting the discrepancy. One authority, or the
  disagreement is invisible.
- **The read timeout is per-screenshot, inside the batch's overall budget**, not
  one deadline for the batch. A shared deadline means one wedged `exec` consumes
  the time available to every screenshot after it, so a single bad read loses all
  the remaining artifacts rather than one.

Recordings keep a per-job size cap because there is exactly **one** of them per
job; the asymmetry follows from the cardinality, not from different standards.

## Consequences

### Positive

- Test-run recordings become real: captured, transported out of an ephemeral pod,
  stored, retained, and playable in the run history — where before the feature was
  a path pointing at a file that had already been deleted.
- The transport (`ReadPodFile`) is reusable and unblocks both `screenshotPath`
  and any future artifact, which is a larger win than recording itself.
- Bounded by construction on all three axes: the read cap, the storage cap, and
  retention. Nothing here can grow without a limit.
- The three-state read contract (available / expired / never recorded) means an
  operator is never told the wrong thing about why an artifact is absent.

### Negative / trade-offs

- **Video in Postgres is not the intended end state.** It is bounded and it works,
  but it puts megabytes per run into the operational database, and a large
  retention window on a busy project will make that table the biggest thing in the
  database. Item 11 is the exit.
- **The `test_run` skill's browser contract changed** — browser-driven subtasks now
  go through Playwright test files rather than ad-hoc CLI calls. That is a real
  behaviour change, justified above, but it is not a no-op for anyone relying on
  the old shape.
- **Retention is time-based only.** A project that records heavily with a long
  window has no size-based pressure release.
- **`feature_build` recordings are stored and never shown**, so they are pure cost
  until a surface exists.
- The sweeper is best-effort and in-process, following ADR 026. A deployment with
  recordings disabled on every replica retains bytes forever.

### Follow-ups

- **An S3/MinIO client** would replace item 3's storage entirely (item 11).
- **`screenshotPath` has the identical dead-pointer bug** and is *not* fixed here.
  `ReadPodFile` is the transport it needs; the work is a migration and a per-step
  fetch in the same expanded row. Worth its own lane.
- **Surface `feature_build` recordings** (item 9), or stop storing them.
- **Size-based retention pressure** (a total-bytes budget per project) alongside
  the time-based window.
- **A recording's presence could be shown on the collapsed row** ("this run has
  one"), which needs the metadata list rather than the lazy per-run fetch — a
  deliberate omission here, not an oversight.
- **`web/lib/msw/handlers.ts` has no run-history or recording handler**, so neither
  is exercised in mock mode. Pre-existing for run history; left alone to keep this
  lane's diff off a file sibling lanes edit.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Keep only a path, and serve recordings from the pod before teardown via a URL on the preview ingress | The pod is deleted at job end (ADR 006 item 11), so there is no "after". A recording would be viewable only while its run was still going — useless, since the artifact is written when it ends. |
| Upload to MinIO/S3 directly | No client library in either service, and no way to add one in this environment. A hand-rolled SigV4 client is real crypto to get wrong for no benefit over a bounded Postgres column. **Superseded by issue #30** — item 11 was revisited, the client exists now (an internal signer, see item 11), and the "no benefit" judgement was the part that did not survive: the benefit is not in the bytes but in keeping them out of a database backup. The "no way to add one" half turned out to describe the build environment rather than the problem. |
| Hand-roll RFC 6455-style streaming / a bespoke sidecar to move bytes | The transport that already exists (client-go's `remotecommand`) does this in ~40 lines with no new dependency. |
| Put the bytes in a `bytea` column on `test_run_reports` | Bloats the row every run-history query touches, and makes the eventual move to object storage a schema change instead of a repository swap. |
| Delete rows on expiry instead of tombstoning | Cheaper, and it is what most retention implementations do — but it erases the distinction between "reclaimed" and "never recorded", which is the single most user-visible requirement here. |
| `video: "retain-on-failure"` | Discards the evidence a passing run's recording provides, and the failure case already has screenshots. |
| Transcode to MP4 | Needs `ffmpeg` in the image (several hundred MB) to re-encode an artifact that already plays. |
| Authenticate previews-style public URL for recordings | Previews are public because they are the project's own app meant to be shared; a recording can contain real data and typed credentials. See item 6. |
| Make `recordingPath` mandatory in `submit_test_report` | Most runs legitimately have no recording, and a mandatory field would push the agent toward inventing a path — the exact bug being fixed. |

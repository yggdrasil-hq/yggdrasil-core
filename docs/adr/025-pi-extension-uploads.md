# ADR 025: Uploaded Pi extensions

**Status:** Accepted
**Date:** 2026-09-18
**Deciders:** Product session (open-issue burn-down; operator decision, item 1)
**Builds on:** [ADR 004](004-agent-base-containers.md) (the base image, the
`yggdrasil-contract` extension, and how a Pi extension is loaded and packaged
today), [ADR 006](006-pi-rpc-orchestrator-integration.md) (the Orchestrator
attaches to the job pod and drives Pi; §7's curated-event vocabulary is what an
extension can influence), [ADR 016](016-organization-rbac-and-cluster-routing.md)
(Organization as the tenancy boundary, and the org-admin `role !== "admin"` route
pattern reused here), [ADR 008](008-project-init-grill-and-submodule-repos.md) /
[ADR 015](015-six-stage-feature-lifecycle.md) (the env-var file-delivery
precedent — `ADR_MARKDOWN`, `TEST_MARKDOWN`), [ADR 028](028-audit-logging.md)
(the record this feature's mutations are written to)
**Does not touch:** ADR 022 (`rollback`) and ADR 015's `script_test_run` — neither
runs Pi, so neither can load an extension; ADR 003 (no new cluster resource, no
image build; the extension travels in the pod env exactly like the token and
model config); ADR 017's `design/` map (no wireframe exists for this surface —
see item 14)

## Context

`roadmap/phases.md` Phase 4 lists "Pi extension uploads" as unbuilt and
`yggdrasil-hq/yggdrasil-core#4` tracks it. ADR 004 deliberately deferred
extension format and sandboxing to "Phase 4" and shipped exactly one extension:
`yggdrasil-contract`, baked into the base image at build time
(`base/Dockerfile`), loaded via an explicit `--extension` flag because **Pi does
not auto-discover extensions** — a fact the entrypoint's own comment records as
having caused a real stuck run.

So the mechanical question ("how would another extension get in?") has a known
answer: another `--extension` argument. The question this ADR actually has to
answer is whether that should ever be under a customer's control, because of what
an extension *is* in this system.

An extension is a TypeScript module imported **into the Pi process**. It is not a
plugin loaded behind an interface, and there is no boundary between it and the
agent:

- The job pod's environment carries the **project's GitHub installation token**
  — `contents: write` + `pull-requests: write` for `feature_build` and
  `design_grill` (ADR 014 §3) — and, for every agent job kind, the **model API
  key** (ADR 018). An extension reads them with `process.env`.
- It shares the workspace, so it can read and write the checked-out repository.
- It can emit tool calls, and the Orchestrator treats *tool calls* as the
  authoritative signal for what a job produced: `submit_adr`,
  `submit_build_result`, `request_action_item`, `submit_review`, `submit_design`
  all end a run, and `terminate: true` on them is what tells Pi to stop
  (ADR 004 item 8; `agent-images/docs/concepts/contract-extension.md`).

That last point is the sharp one. The contract extension is not a convenience —
it is the state machine's input. Code that can re-declare `submit_adr` can, in
principle, produce a result the Orchestrator believes.

The operator decided (item 1) to ship this anyway: **org-scoped upload, stored in
the API, delivered into job pods, opt-in per project, with an explicit trust
warning and an audit entry.** This ADR records that decision, states the risk
without softening it, and specifies the parts of it that can be made mechanical.

## Decision

### What an upload is

1. **A bundle of source files, not an archive and not a package.** Uploads carry
   `.ts`/`.js`/`.json`; the API stores one row per file
   (`org_extension_files`, migration `040`). Rejecting archives is what makes the
   rest tractable: every path that will ever be written into a container is a
   value the API can inspect *before* it stores anything, which is not true of an
   opaque tarball.

2. **Source only — an upload cannot declare dependencies.** A `package.json`
   whose `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies`
   is non-empty is refused. Nothing installs packages inside a job pod, so an
   extension that declared them would fail at *run* time rather than upload time,
   and installing them anyway would mean reaching the npm registry from a
   container holding the project's GitHub token, with a floating semver range
   making runs unreproducible. This also preserves ADR 004's own reason for
   pinning `typebox` to the exact version Pi depends on: a mismatched copy at
   runtime is a real failure mode, and an upload must not be able to re-create it.

3. **Exactly one entry module**, defaulting to `src/index.ts`, which must be one
   of the bundle's own files. Pi is pointed at a path, so there has to be a
   specific one, and validating that it exists at upload time means the container
   never has to guess.

4. **Bounded**: ≤ 16 files, ≤ 64 KiB per file, ≤ 96 KiB per extension, ≤ 5
   extensions per organization. These are not arbitrary — they are derived from
   the delivery path in item 5, and their arithmetic is asserted in code
   (`EXTENSION_LIMITS`) so a future change to one limit cannot silently make an
   accepted upload undeliverable.

### How it reaches a job

5. **As an env var, `PI_EXTENSIONS_BUNDLE`, carrying one JSON document.** The
   Orchestrator's only file-delivery path into a pod is env vars — it is how the
   GitHub token and model config arrive (ADR 004), and how the approved ADR and
   test spec arrive (ADR 008/ADR 015: `ADR_MARKDOWN`, `TEST_MARKDOWN`, written to
   disk by the entrypoint). Reusing it means no new Kubernetes object, no volume,
   no init container, and nothing new to clean up. The API exposes it at
   `GET /internal/projects/:projectId/extensions?jobKind=…` as an env fragment,
   mirroring the model-config endpoint's shape so the Orchestrator change is
   "fetch and merge", not "encode".

   The consequence is that the caps in item 4 are sized so
   `maxPerOrganization × maxTotalBytes` stays under the encoded-bundle limit: a
   pod spec over Kubernetes' object-size limit is rejected at admission, which
   surfaces to a user as "the job never started" with no explanation. Rejecting at
   upload time turns that into a 400 at a moment someone can act on it.

6. **Installed outside `/workspace`, then Pi is pointed at it.** The container
   writes each extension under `/opt/yggdrasil/extensions/<index>-<slug>/`, locks
   files to `0444` and directories to `0555`, and execs Pi with the contract
   extension first, then the uploaded ones, then the container's own arguments.
   Outside `/workspace` matters concretely: nothing here can be committed to the
   project's repository by the agent. `entrypoint.sh` only takes this path when
   the variable is present, so a project that has not opted in runs byte-for-byte
   the command it ran before.

   **The file modes are not a security boundary.** The agent runs as root in that
   container, and so does anything it imports; `0444`/`0555` stop accidental
   edits and the agent's own tooling, nothing more. Installing an extension
   *outside* `/workspace` is about not leaking it into the repository, not about
   containment. There is no containment.

7. **Both the API and the container validate every path.** The API validates on
   upload (so nothing unsafe is ever stored); the installer validates again
   before writing (so the process calling `writeFileSync` does not depend on
   another service having been correct). That is not redundant — the two are
   separate trust decisions, and the second is the one adjacent to the
   filesystem. Both reject absolute paths, backslashes, `.`/`..` segments, control
   characters, non-allowlisted extensions, and duplicates; the installer
   additionally asserts, immediately before writing, that the resolved target is
   still inside the extension's own directory.

8. **Which jobs may load one is decided by two gates, both required:** the
   project opted in, *and* the job kind runs Pi. The second is structural rather
   than policy — `deploy`, `rollback` and `script_test_run` never launch Pi, so
   there is nothing for an extension to attach to. The first is the entire
   control. Eligibility is not a per-kind policy list: every Pi-driven kind
   (`spec_grill`, `feature_build`, `test_run`, `agentic_review`, `design_grill`)
   is eligible, because making availability depend on which job kind a user
   happened to be looking at would be a worse surprise than a uniform rule.
   `spec_grill` is the weakest beneficiary — it produces nothing to look at — but
   it is still a Pi run.

### Who may do it

9. **Uploading, replacing, activating, and deleting are org-admin actions**
   (`role !== "admin"`, the same blunt check ADR 016/018's org surfaces use).
   Reads are admin-only as well, unlike the org provider/cluster surfaces: this
   list *is* the inventory of what code can run with the organization's
   credentials, and the detail read serves source.

10. **Per-project opt-in is a separate, narrower act, on its own endpoint** —
    `PATCH /projects/:projectId/uploaded-extensions-enabled`, gated on project
    membership like every other project setting (ADR 018 item 6), `FALSE` by
    default. Two decisions, deliberately separated: an admin decides the
    organization may run uploaded code at all; a project owner decides *this*
    project does. A new column rather than a `settings` blob, mirroring
    `projects.agentic_review_enabled` (ADR 015 item 12).

11. **A project that opts in loads every active extension of its organization.**
    This is the blunt model, chosen over per-project selection because the trust
    decision is already org-wide: subsetting would imply a per-extension
    per-project judgement nobody is actually making. The cost is that one
    extension cannot be enabled in one project and not another — the workaround is
    the kill switch below, and per-project selection is a documented follow-up.
    A useful consequence: the per-organization cap is also the per-project cap, so
    there is one fewer limit to keep consistent.

### Replacing, removing, and the kill switch

12. **Replacing an extension keeps its row id and replaces its files in one
    transaction**, so a reader can never observe a half-replaced file list whose
    contents do not match its stored digest. **Deleting cascades its files.** A
    replacement re-activates: an extension someone deliberately switched off
    comes back only when a new revision is deliberately uploaded.

13. **An extension carries a `source_sha256` over its file set, and the container
    checks it.** The digest is computed by the API at upload, stored, logged by
    the job container as `loaded <slug> revision <digest>`, and recomputed at
    delivery time (a mismatch is a refusal, not a served bundle). This is what
    makes "which revision ran in that job?" answerable later — the question anyone
    will actually ask about this feature. It is not a signature: it proves
    integrity against corruption, not authorship.

14. **A job in flight is unaffected by changes.** The bundle is fetched once at
    dispatch and lives in the pod spec, so replacing or deleting an extension
    changes only *future* jobs; a running job keeps the revision it started with.
    An admin who wants something to stop now uses the kill switch, which is
    exactly why the kill switch exists as a separate action from deletion —
    fast and reversible, for use during an incident.

### The trust warning

15. **The warning is required, specific, and not dismissible.** Uploading
    requires `acknowledgedRisk: true` in the request body as a literal — absent
    is refused, `false` is refused — so an upload cannot happen through an API
    path that never rendered the warning. The Web banner is standing rather than
    shown-once, because a reviewer arriving later needs it more than the uploader
    did. Its wording (asserted in tests, so it cannot drift silently):

    > An extension is arbitrary code. It runs inside the job container with the
    > same access as the agent itself: it can read the pod's environment —
    > including the project's GitHub installation token and the model API key —
    > make network requests, modify the workspace, and emit tool calls that
    > Yggdrasil treats as the job's real result. There is no sandbox. Only upload
    > code you have read and trust.

    Note what it does not say: nothing about permissions, isolation, or review
    gates, because there are none to describe. That is the honest version.

16. **An upload may not name a `yggdrasil-contract` tool.** `ask_user`,
    `submit_adr`, `submit_build_result`, `request_action_item`,
    `report_test_step`, `submit_test_report`, `submit_review`,
    `update_design_preview`, `submit_design`. A bundle that names one as a string
    literal is refused at upload and the same check runs at install time.

    **This is a heuristic, not a guarantee.** A literal can be assembled at
    runtime (`"submit" + "_adr"`) and evade a static scan, and the contract
    extension cannot be made un-shadowable from inside the same process. It is
    included because it reliably catches the realistic cases — someone shipping an
    extension that wraps `ask_user`, or a copy-paste that re-declares
    `submit_adr` — and because refusing the obvious version costs nothing. The
    guarantee this feature does *not* provide is that the Orchestrator's
    completion signal is unforgeable. Anyone reading item 17 below should read
    this paragraph with it.

### Auditing

17. **Every mutation is audited** (ADR 028 coverage): `extension.uploaded`
    (with `replaced: true` for a revision rather than a new action — same act,
    same target, and the digest is what distinguishes revisions),
    `extension.activation_changed`, `extension.deleted`, and
    `project.uploaded_extensions_changed`. The project opt-in gets its own action
    rather than folding into `project.updated` (which is what the analogous
    agentic-review toggle does) because this toggle decides whether third-party
    code runs with the project's credentials, and a reader scanning for "when did
    we start doing that here" should not have to open every project update.

18. **The audit metadata carries the digest and the shape, never the source.**
    `{ slug, name, entryPath, fileCount, totalBytes, sourceSha256, replaced }`. The
    trail is broadly readable by org admins and kept forever, and uploaded code
    can contain an embedded key of its own.

### What the admin can see

19. **The list shows name, slug, entry path, revision, uploader, upload time, and
    how many projects load it.** The detail read serves the file contents, which
    is the one real control this feature has: it lets a second admin read what is
    installed rather than trusting the uploader's description. The Web app renders
    that source as text in a `<pre>`, never as markup.

## Consequences

### Positive

- An organization can extend the agent's behaviour without a fork of
  `agent-images` or a custom image build, which is the capability that was asked
  for and the only way to get it short of publishing to the registry.
- The mechanical protections are real and tested: path traversal is refused twice
  by two independent implementations, the size caps are derived from the delivery
  path rather than guessed, a stored bundle cannot silently drift from its
  recorded revision, and the default path for a project that has not opted in is
  unchanged.
- "Which revision of which extension ran in that job?" is answerable from the
  pod's own log.
- The risk is written down in the product surface, not only in this ADR: an admin
  who uploads and a project owner who opts in both see what they are accepting.

### Negative / trade-offs

- **This feature's risk is not mitigable by the controls it has.** An extension
  runs with the agent's full authority over a container holding a
  `contents: write` GitHub token. Everything above — the admin gate, the opt-in,
  the warning, the audit trail — governs *who decides*, not *what the code can
  do*. Anyone reading this ADR should treat "an org admin has uploaded an
  extension" as equivalent to "an org admin has pushed code that will run in
  every opted-in project's job container".
- **No dependency support** means a useful extension is limited to
  platform-provided modules and Node built-ins. That is a real capability ceiling,
  accepted for the reproducibility and supply-chain reasons in item 2.
- **The reserved-tool check is defeatable** (item 16), so the Orchestrator's
  completion signal is not unforgeable by an upload.
- **Blunt opt-in**: a project loads all active extensions or none (item 11).
- **Delivery through an env var** caps total size well below what a file service
  would allow, and shows up in the pod spec (and therefore in `kubectl describe`
  output) as a blob.
- **Postgres storage was chosen partly for what was not available**: no
  object-storage client exists in the API today, so this avoided adding one. That
  is a decision by constraint as much as by merit; see Follow-ups.

### Follow-ups (out of scope here)

- **Real containment**, if this is ever expected to hold against a hostile
  upload: a separate process, a syscall filter, or dropping the pod's token for
  jobs that load extensions. None of that is designed here, and until it exists
  the honest framing is "trusted code, audited", not "sandboxed plugins".
- **Per-project selection** of which extensions a project loads (item 11).
- **Move artifacts to object storage** once the API has a client for it; the
  repository module is the seam, and the delivery contract would not change.
- **Restrict a job pod's GitHub token scope when an extension is loaded**, which
  would cap what an upload can reach even if it is hostile.
- **An `extension.uploaded` review gate**: requiring a second admin to activate a
  new revision, rather than the uploader being able to activate it directly.
- **Signed bundles**, if the operator ever wants uploads from one installation to
  be verifiable in another. The digest in item 13 is a prerequisite for that, not
  a substitute for it.

## Alternatives considered

| Alternative | Why not |
|---|---|
| Store the artifact in object storage (S3/MinIO) | The API has no object-storage client today (`@aws-sdk/*` and `minio` are absent from both `package.json` and `node_modules`, and `config.ts` never reads the `S3_*` variables `deploy/` sets — they are aspirational). This would have meant adding a runtime dependency for a bounded set of small files that a table handles well, and it would have lost transactional replace. Revisit if artifacts grow. |
| Accept a tarball (one blob row) | An opaque archive cannot be validated before storage, which pushes path safety entirely into the container — the one place a traversal bug is worst. It also hides the file list from the admin review view. |
| Allow uploaded dependencies, installed in the pod | Network access to a registry from a container holding the project's GitHub token, non-reproducible runs from floating ranges, and the exact version-mismatch failure mode ADR 004 pinned `typebox` to avoid. |
| Per-project opt-in only, no org-level inventory | The upload has to live somewhere, and it must be reviewable by more than the person who uploaded it. Per-project storage would also duplicate the same artifact per project. |
| Auto-load every extension for every project | Removes the opt-in, which is the only place a project owner gets a say. Default-on for code that runs with a live write token is not defensible. |
| Per-project selection of extensions | More surface and a UI for a distinction the trust model does not make — an admin who trusts an extension for the organization has already made the call. Deferred rather than rejected (Follow-ups). |
| Enforce the contract API by removing the reserved tools' names at load time | Static rewriting of untrusted TypeScript is a worse guarantee than the literal check and would break honest extensions that legitimately wrap Pi's own API. |
| Make file modes a security boundary via an unprivileged user | The agent's own tooling and the extension run in the same process tree as root; changing that is a change to how every job pod runs, well beyond this feature, and would need ADR 004/006 to be revisited. |
| No feature at all (close #4 as not-planned) | The operator decided otherwise; recorded here so the decision is not re-litigated on the next pass. |

## Implementation

| Piece | Where |
|---|---|
| Validation (pure, exhaustively tested) | `api/src/extensions/bundle.ts` |
| Storage, transactional replace | `api/src/extensions/repository.ts`, migration `040` |
| Admin CRUD | `api/src/extensions/routes.ts` |
| Delivery endpoint | `api/src/extensions/internal-routes.ts` |
| Project opt-in | `api/src/projects/routes.ts` (`PATCH /:projectId/uploaded-extensions-enabled`) |
| Installer | `agent-images/base/pi-with-extensions.mjs`, wired in `base/entrypoint.sh` |
| Presentation | `web/lib/features/extensions.ts`, `web/components/settings/organization/org-extensions-settings.tsx` |

**The Orchestrator half is not implemented by this ADR's change.** The API serves
the bundle and the container installs it, but nothing yet fetches
`GET /internal/projects/:projectId/extensions` at dispatch time and merges the
returned env fragment into the pod spec — the same seam ADR 018's per-feature
tier needed when it landed, and the same shape of change: `buildAgentEnv` in
`orchestrator/internal/worker/worker.go` already assembles the pod env, so this is
a fetch plus a merge. Until it lands, an extension is storable, reviewable, and
auditable but never actually loaded. That gap is stated here rather than left for
someone to discover from a job that quietly did nothing.

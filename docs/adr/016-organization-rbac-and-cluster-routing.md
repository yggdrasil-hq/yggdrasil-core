# ADR 016: Organization entity, RBAC, org-level provider/secret config, and per-org cluster routing

**Status:** Accepted
**Date:** 2026-08-30
**Deciders:** Product/design session (grill-with-docs)
**Builds on:** [ADR 002](002-projects-features-tests.md) (project ownership,
job dispatch), [ADR 003](003-orchestrator-kubernetes.md) (Kubernetes compute,
namespace-per-project isolation), [ADR 005](005-github-app-repository-access.md)
(GitHub App installation model), [ADR 007](007-per-user-default-model-configuration.md)
(per-user model config, being retired here)
**Supersedes:** ADR 002's `owner_user_id` project ownership; ADR 003 §3-4
(bundled-k3s-by-default / one-cluster-per-instance-via-env-var cluster
targeting); ADR 007 in its entirety (per-user default model configuration)
**Does not touch:** ADR 001/009 (auth/identity — no new signup path; invite
acceptance reuses the existing GitHub OAuth open-registration flow), ADR 005
(GitHub App installation model — deliberately decoupled, see item 3)

## Context

`design/settings/organization/*` sketched four settings pages — General,
Members, Providers, Secrets, Cluster — all resting on an **Organization**
entity ADR 002 explicitly deferred ("Team RBAC and multi-user project
permissions (Phase 2)"). Each page's own `.design-note` flagged a different
degree of groundedness: Members needs a wholly new Organization/
Membership/Role model with no ADR; Providers proposes superseding ADR 007
outright; Secrets proposes a new org-owns/project-inherits pattern parallel
to the real `project_secrets`; Cluster proposes answering
`roadmap/open-questions.md` #10 (multi-cluster credential routing) at the
org level. Reached via a `grill-with-docs` session against this suite's own
domain model, resolving all four together since org-level provider/secret/
cluster config all depend on the Organization entity existing.

## Decision

### Organization core

1. **A user can belong to multiple Organizations.** Standard multi-tenant
   membership, not a single fixed org per user — matches the wireframe's org
   switcher.
2. **Every user gets a personal Organization auto-created at signup** — no
   explicit "create an org" step is required before creating a project,
   consistent with this product's stated 2-10 person, low-friction audience.
   A personal org is not otherwise restricted — nothing stops inviting others
   into it later; the `is_personal` flag only governs auto-creation and
   default routing (e.g. where a first project lands), not membership rules.
3. **Organization is independent of the GitHub App installation model**
   (ADR 005) — deliberately decoupled. A project under any Organization can
   link repos through whichever GitHub App installation/account its creator
   has access to; Organization is a pure Yggdrasil-side permissions/grouping
   layer, not a 1:1 mirror of a GitHub org. ADR 005 is unchanged.
4. **Project ownership moves from `owner_user_id` to `organization_id`.** A
   project belongs to exactly one Organization. (No migration path is
   specified — the application has no live deployment yet.)

### Invites (no email, by design)

5. The existing auth model has **no email at all** (ADR 001/009 — GitHub
   OAuth only, open registration, "Email: Not used" per
   `concepts/authentication.md`) — a typed-email or typed-username invite
   flow would quietly reintroduce a dependency this suite deliberately
   avoided. Instead: an org admin generates a **shareable, token-based invite
   link** (org + proposed role baked in) and distributes it through whatever
   out-of-band channel they already use. Yggdrasil never sends anything
   itself. Whoever opens the link and completes GitHub OAuth (new or
   existing account — registration is already open) is added to that org
   with that role.

### Roles and membership

6. **Role scope is org-wide, not per-project.** One role per membership,
   applying uniformly across every project under that org — matches the
   wireframe's flat Members list. Per-project role overrides are explicitly
   out of scope for this decision (see Follow-ups).
7. **Five roles** — Admin, Developer, Designer, Product Manager, Tester — and
   their capability grants are adopted **as the wireframe proposed them**,
   with no re-litigation of individual grants in this ADR. Stored as
   **adjustable seed data** (a role → capability table), not hardcoded
   per-role branches in application logic, so a wrong default grant can be
   corrected later without a new ADR or redeploy.

### Provider/model config (retires ADR 007)

8. **ADR 007's per-user default model configuration is retired outright**,
   not kept as a lower fallback tier. Resolution becomes `project_secrets` →
   the project's Organization's config — no `user_secrets` involved.
   `/settings/account`'s model section becomes a **read-only** view, linking
   to whichever org settings the viewer can actually edit — matching the
   wireframe.
9. **Same all-or-nothing bundle rule ADR 007 established**, just with
   Organization as the new (and only) fallback tier: a project holds its own
   custom `MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_ID` triplet, or fully
   inherits its org's — no partial per-key mixing at either level.

### Org-level secrets (new, parallel to project secrets)

10. **Org-level secrets** (the generic key/value kind, beyond the three model
    keys) follow the same shape: every job in every project under an org
    receives that org's secrets automatically; a project can add its own on
    top. **On a key-name collision, the project-level value wins** — "more
    specific wins," the same rule already implicit in the model-config
    fallback.

### Cluster routing (supersedes ADR 003 §3-4, answers open-questions.md #10)

11. **The instance-wide `KUBECONFIG_HOST_PATH` env var and the
    "bundled-k3s-by-default" auto-selection are removed.** There is no
    platform-default cluster and no fallback. **Every Organization must
    explicitly configure its own Kubernetes cluster** (kubeconfig, stored
    encrypted the same way secrets are) before it can do anything else —
    this is a **hard gate**, the same pattern ADR 002 already established for
    `project_init` ("cannot create other features/tests while
    `initializing`"). New `organizations.status`:
    `pending_cluster` → `ready`, gating all project creation.
12. **Whole-org granularity, no overrides.** An org's cluster choice applies
    uniformly to every project under it — primary deployments and every
    ephemeral job alike. No per-project override exists or is planned.
    Namespace-per-project isolation (ADR 003 §5) is unchanged; it just
    happens on whichever cluster the org resolved to.
13. **Mechanically**, the Orchestrator's worker loop must resolve a job's
    target cluster (via its project → organization) at claim time and use a
    matching Kubernetes client, replacing today's single static client built
    once at process startup from the env var. This is a real internal change
    — dynamic/cached clients keyed by organization, not one client for the
    process lifetime.

## Consequences

### Positive

- One coherent entity (Organization) grounds four previously-unrelated
  wireframe pages at once, instead of bolting each onto `owner_user_id`
  piecemeal.
- The personal-org-per-user pattern means solo/small-team usage — this
  product's actual stated audience — needs zero extra setup ceremony beyond
  today, despite the underlying model becoming fully multi-tenant.
- Invite-by-link sidesteps reintroducing an email dependency the product
  deliberately avoided (ADR 001/009), rather than working around it awkwardly
  (e.g. "invite by username" for a not-yet-registered person).
- Org-level provider/secret/cluster config all share one mental model
  ("org owns it, project can override" for secrets/providers; "org owns it,
  no override" for cluster) instead of three bespoke inheritance schemes.
- Role capabilities as adjustable data, not hardcoded logic, means the
  wireframe's "best-effort default" grants can be corrected as real usage
  surfaces gaps, without another ADR.

### Negative / trade-offs

- **Every new user now faces a hard cluster-configuration gate** before
  creating a single project — including a brand-new signup's auto-created
  personal org. This is real onboarding friction the current
  "close to today's single-command experience" bundled-k3s posture (ADR 003
  §3) doesn't have. Not mitigated here; a self-hosted quick-start could
  pre-fill the bundled k3s's kubeconfig as a one-click suggestion, but that's
  a UX follow-up, not decided by this ADR.
- **The Orchestrator gains real internal complexity**: dynamic, cached,
  per-organization Kubernetes clients replace a single static one — more
  moving parts, more failure modes (a bad/expired org kubeconfig now fails
  per-org instead of the whole instance failing loudly at startup).
- **No per-project role overrides and no per-project cluster overrides** —
  both are real simplicity trade-offs against flexibility some teams may
  eventually want.
- **Retiring ADR 007 outright** removes the "per-user personal default that
  travels across orgs" convenience — a user active in several orgs now
  configures/relies on each org's own provider config separately, with no
  personal cross-org fallback.

### Follow-ups (out of scope here)

- Per-project role overrides, if org-wide-only role scope proves too coarse.
- A Web app surface for editing the role → capability matrix (currently
  adjustable data, but no UI is specified here).
- Onboarding UX to reduce the new cluster-configuration gate's friction
  (e.g. pre-filling a self-hosted bundled cluster's kubeconfig).
- Invite link expiry/revocation policy — this ADR specifies the mechanism,
  not its lifecycle details.
- Leaving/deleting an Organization, and what happens to its projects.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Invite by typed email or GitHub username | Reintroduces an email dependency (typed email) or requires the invitee to already have an account (username), neither consistent with the existing no-email, open-registration model |
| Keep ADR 007's per-user default as a third fallback tier below org | Adds a resolution path (`project → org → user`) for a convenience (cross-org personal default) that's easy to defer; simpler to retire outright and re-add later if it's actually missed |
| Per-project role overrides from the start | More flexibility than the wireframe actually shows or anything currently demands; org-wide-only is simpler to build and reason about, with overrides as a scoped follow-up if needed |
| Keep an instance-level default cluster, org config as an optional override | Rejected per direct product decision — every org must configure its own cluster explicitly, no implicit default, even though it costs onboarding friction |
| Tie Organization 1:1 to a GitHub org/account | Would couple two independent concerns (Yggdrasil-side permissions vs. GitHub-side repo access) and break projects whose repos span multiple GitHub owners |

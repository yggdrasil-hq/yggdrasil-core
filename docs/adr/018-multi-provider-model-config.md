# ADR 018: Multi-provider model configuration and per-job-kind defaults

**Status:** Accepted
**Date:** 2026-09-16
**Deciders:** Product session (design/code-parity review)
**Builds on:** [ADR 016](016-organization-rbac-and-cluster-routing.md) (Organization
entity, org-level provider/secret config, RBAC), [ADR 007](007-per-user-default-model-configuration.md)
(all-or-nothing bundle philosophy, inherited/custom project toggle — both carried
forward here), [ADR 004](004-agent-base-containers.md) (Pi's `MODEL_BASE_URL`/
`MODEL_API_KEY`/`MODEL_ID` env var contract — unchanged by this ADR)
**Supersedes:** ADR 016 items 8-9 (the flat org-level model triplet). ADR 016's
Organization entity, RBAC, org-secrets, and cluster-routing decisions are untouched.
**Does not touch:** ADR 016's generic `organization_secrets`/`project_secrets`
key/value store — that stays for non-model secrets, and for the project custom
triplet described below.

## Context

`design/settings/organization/providers/index.html` sketches a page that goes well
beyond ADR 016's flat model config: named providers (OpenRouter, Anthropic, custom
OpenAI-compatible), a catalog of models tied to a provider, and a default model
assigned per job kind, with org admins editing and other members viewing read-only.
The current implementation (`web/components/settings/organization/org-providers-settings.tsx`,
`api/src/secrets/model-config.ts`) is just three flat secret fields
(`MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_ID`) resolved once per project — it doesn't
support multiple providers, a model catalog, or varying the model by job kind. This
ADR decides the data model and resolution rules for the richer version the design
calls for.

## Decision

### Providers and catalog

1. **Provider** — org-scoped, named, typed (`openrouter | anthropic |
   custom_openai_compatible`). Known types imply a sensible default base URL;
   `custom_openai_compatible` requires an explicit one. Admins may override the base
   URL even for a known type (the design shows "Update" on any connected provider,
   not just custom ones). One API key per provider, envelope-encrypted the same way
   as today's secrets (`api/src/secrets/encryption.ts`).
2. **Model catalog** — a model belongs to exactly one provider, with a display name
   and the literal model-id string sent in requests (e.g. `claude-sonnet-5`). No
   cross-org sharing of providers or models.

### Per-job-kind defaults

3. **Org default is assigned per job kind**, not once per org. Scoped to the five
   agent-driven job kinds — `spec_grill`, `feature_build`, `test_run`,
   `agentic_review`, `design_grill` (per `docs/concepts/job-dispatch.md`). `deploy`
   and `script_test_run` don't run Pi and are out of scope.
4. **A model assigned as a default cannot be deleted** — the model/provider must be
   unassigned from every job kind (and project override) first. This is a stricter,
   more explicit version of ADR 007/016's philosophy of surfacing inconsistency
   rather than silently degrading.

### Project overrides — both paths kept

5. **A project can override a job kind's model in either of two ways**: point it at
   a model in its org's catalog, or supply its own fully custom
   `MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_ID` triplet independent of any configured
   provider — today's escape hatch, kept deliberately rather than retired, because
   removing it would prevent a project from ever using a connection its org hasn't
   set up. This is a real trade-off (see Consequences) against the simpler
   catalog-only model most of ADR 016's other inheritance rules use.
6. **Resolution order per job kind**: project's custom triplet (all three keys
   present, via `project_secrets`) → project's catalog override for that job kind →
   org's default for that job kind → no config (job dispatch fails the same way it
   does today when nothing is configured).

### Project-creation gate

6a. **Project creation is additionally gated on all 5 job kinds having an org
    default model assigned** (`spec_grill`, `feature_build`, `test_run`,
    `agentic_review`, `design_grill`), same hard-gate pattern as ADR 016 item 11's
    cluster requirement (`organizations.status`: `pending_cluster` → `ready`) — an
    org must reach `ready` on **both** cluster config and full per-job-kind default
    coverage before it can create a project. Partial coverage (e.g. 4 of 5 kinds)
    still blocks. This closes the gap the plain resolution-order fallback in item 6
    would otherwise leave open (job dispatch silently failing at run time instead
    of being caught at project-creation time).

### RBAC

7. **Reuse ADR 016's existing enforcement, unchanged**: reads (providers, catalog,
   job defaults) open to any org member; writes admin-only via the same blunt
   `role !== "admin"` check already used for org secrets/cluster routes. The
   granular `role_capabilities`/`CapabilityLevel` matrix that ADR 016 introduced as
   adjustable data is **not** wired into enforcement here either — still a Follow-up.

### Retiring dead ADR 007 code

8. **`user_secrets` and its backing routes/repository are deleted outright**
   (`api/src/secrets/user-repository.ts`, `api/src/secrets/user-routes.ts`, the
   `user_secrets` table, and web's `*AccountSecret` functions). ADR 016 already
   retired this conceptually (`/settings/account` became read-only) but never
   removed the underlying writable route — this ADR finishes that cleanup.

### Orchestrator/Pi contract

9. **Unchanged**: pod env vars are still exactly `MODEL_BASE_URL`/`MODEL_API_KEY`/
   `MODEL_ID` (ADR 004). Only the API-side resolution changes — it now takes the
   job's kind as an input, in addition to project/organization.

## Consequences

### Positive

- Matches the actual design without inventing a full plugin provider system — a
  closed enum of known provider types plus a flat model catalog is enough.
- Per-job-kind defaults let an org route cheaper/faster models to routine jobs
  (e.g. `test_run`) and stronger ones to `feature_build`, without per-project setup.
- Keeping the project custom-triplet escape hatch preserves today's flexibility
  instead of regressing projects that need a connection their org hasn't configured.
- Deletion-restricted defaults surface a clear, actionable error instead of quietly
  leaving a job kind pointing at a deleted model.

### Negative / trade-offs

- **Two override mechanisms per project** (catalog pick vs. custom triplet) is more
  surface area than a single catalog-only override would have been — more states
  for the UI and resolution logic to handle correctly.
- **No granular RBAC** — any admin can rewrite every provider/model/default; the
  five-role capability matrix ADR 016 introduced still isn't enforced at this
  finer grain.
- **`ON DELETE RESTRICT` requires an explicit unassign step** before deleting a
  model or provider in active use — more admin friction than a silent cascade,
  traded deliberately for clarity over convenience.

### Follow-ups (out of scope here)

- Wiring the `role_capabilities`/`CapabilityLevel` matrix into these routes instead
  of the blunt admin check (same follow-up ADR 016 already flagged).
- UI/API for bulk-importing a provider's full model list (e.g. from OpenRouter's
  models endpoint) rather than manual entry.
- Revisiting whether the project custom-triplet escape hatch should eventually be
  retired once orgs reliably configure their own providers.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Catalog-only project override (no custom triplet) | Simpler, one override mechanism — but removes a project's ability to use a connection its org hasn't configured; rejected by direct product decision |
| One default model per org (today's model), applied to every job kind | Doesn't match the design, which explicitly varies the default per job kind |
| `ON DELETE CASCADE` (unassign automatically) on defaults | Silently changes a job kind's effective model on unrelated model deletion — rejected in favor of an explicit, visible failure |
| Free-form provider list (arbitrary provider "type" string) | A closed enum (`openrouter`/`anthropic`/`custom_openai_compatible`) is enough for known-type default base URLs and keeps validation simple; a full plugin system is unwarranted scope |
| Wire the granular capability matrix into enforcement now | Real work unrelated to this feature's core value; deferred as a Follow-up, same as ADR 016 left it |

## Amendment: per-feature override tier (issue #5)

**Date:** 2026-09-16
**Issue:** `yggdrasil-hq/yggdrasil-core#5` (Phase 4 — per-feature model override)
**Amends:** items 4, 5, 6, and 7 above. Everything else in this ADR stands.

### Decision

9. **A third, narrowest resolution tier exists: the feature.** Any job that
   belongs to a feature resolves its model configuration through the feature
   tier first. This is the same two-mechanism shape as the project tier
   (item 5), one level down, rather than a new kind of override:

   - a **catalog selection** per job kind — a `feature_job_model_overrides`
     table (migration 030), mirroring `project_job_model_overrides` exactly
     (same five-kind `CHECK`, same `PRIMARY KEY (feature_id, job_kind)`,
     presence of a row means override);
   - a **custom triplet** — a `feature_model_secrets` table, mirroring
     `project_secrets`' encrypted storage (same AES-256-GCM envelope, same
     metadata-only read surface), holding a feature's own
     `MODEL_BASE_URL`/`MODEL_API_KEY`/`MODEL_ID`.

10. **Full resolution order per job kind, highest first**: feature's custom
    triplet → feature's catalog override → project's custom triplet → project's
    catalog override → organization's per-job-kind default → nothing resolves
    (dispatch is refused, as before). This replaces item 6's four-step order.

11. **The all-or-nothing rule is unchanged and now applies at both levels**: a
    tier has either none of the three keys or all three — never a per-key mix.
    A *partial* triplet at the feature or project tier is treated as
    unresolvable rather than falling through to a lower tier, so an
    inconsistent state surfaces instead of being masked. The feature tier also
    enforces this on write, as a whole-bundle PUT that rejects a partial
    triplet with a 400 — structurally, rather than relying on every writer to
    set all three keys in turn.

12. **Item 4's deletion protection extends to the feature tier.** A model in
    active use cannot be deleted — `ON DELETE RESTRICT` from the feature
    override table to `organization_models`, the same mechanism that already
    protects org defaults and project overrides.

13. **Authorization reuses item 7's precedent, unchanged**: the feature-tier
    routes are gated on project access (`ProjectRepository.findByIdForUser`),
    exactly like the project-tier model-config routes they mirror, plus the
    feature having to belong to that project. No new capability is introduced,
    and the `role_capabilities` matrix is still not wired into enforcement
    (still the same Follow-up).

14. **Closure of the dispatch path.** Every dispatch-time gate that requires "a
    resolvable model configuration" now resolves with the job's feature id, and
    the internal job-spec endpoint the Orchestrator consumes takes an optional
    `featureId` parameter. That parameter is additive: absent, the resolution is
    exactly what it was before this tier existed.

15. **UI: a dedicated route, not a seventh stage.**
    `/projects/:projectId/features/:featureId/model-config` renders the feature
    tier, linked from the feature-detail header. It is deliberately **not** an
    entry in the six-stage nav (`FEATURE_STAGES`), because that list drives
    lifecycle progress math (ADR 015) — model configuration is a settings
    surface, not a lifecycle stage. Five job kinds plus three custom-connection
    fields is also too much to inject into every stage page's header.

### Scope notes and non-goals

16. **A `design_grill` session stays project-scoped** (ADR 014), even when it
    was started from one feature's Action Item: its job row carries no
    `feature_id`, so the feature tier does not apply to it. Writing a feature id
    onto a design job would additionally break the feature-scoped "is a build
    already running?" gate, which is kind-agnostic (`findLatestJob(featureId)`).
17. **Feature-level config is model config only.** Unlike `project_secrets`,
    the feature-tier secret table is not a general env-var store: a feature is
    not a deployment unit, so it has no delivery path for arbitrary keys. Only
    the three `MODEL_*` keys are writable through it.

### Consequences

- A feature can pin a stronger/cheaper model for its own build without touching
  its project or organization — the closest granularity to "this one feature".
- **A third tier is a third place a model can be overridden**, so "why is this
  job using that model?" now needs the effective-config read rather than a
  mental model of one tier. Mitigated deliberately: the feature surface shows
  the winning tier *and* its resolved model per job kind, so "inherit" is never
  ambiguous, and one shared resolution function keeps the whole ladder in one
  place so the dispatch path and the read path cannot disagree.
- The feature tier inherits item 5's trade-off (two mechanisms rather than one)
  and item 7's (no granular RBAC), both of which this amendment extends rather
  than resolves.

### Follow-up (out of scope here)

- The Orchestrator passes a job's project and kind when fetching its secrets but
  **not** the job's `feature_id`, so a feature-tier override is enforced at
  dispatch-gate time but not yet delivered into the job pod's env vars until
  that one-argument change lands (`orchestrator/internal/worker/worker.go`'s
  `buildAgentEnv` → `internal/apiclient/client.go`'s `FetchProjectSecrets`).
  The API side is additive and backward-compatible, so the two repos can land
  in either order.
- `docs/concepts/project-settings.md`'s "Levels" list still describes level 2
  ("per-feature / per-run") as a general capability; its model-configuration
  half is now implemented (this amendment), the rest is not.

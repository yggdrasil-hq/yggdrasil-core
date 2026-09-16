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

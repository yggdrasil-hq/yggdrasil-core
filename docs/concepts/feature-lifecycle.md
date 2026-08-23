# Concept: feature lifecycle

**Read this when:** you touch feature states, transitions, or the state machine
(Web status display, API persistence, Orchestrator run outcomes).
**Skip if:** you don't deal with feature status at all.

> **Authoritative states:** ADR 002 (`docs/adr/002-projects-features-tests.md`).
> This doc is the implementation reference.

## What a feature is

A user-described unit of work for the agent to build. Each feature goes through a
**spec phase** (grill-me → ADR) and a **build phase** (implementation → PR).
Each build maps to a branch `yggdrasil/<feature-slug>-<id>` and a draft PR on the
**primary repository**.

Special type **`project_init`** — auto-created on project setup; same lifecycle,
templated grill prompt. Project stays `initializing` until this feature merges.

## Two job phases

| Phase | Job kind | Feature states | Output |
|-------|----------|----------------|--------|
| Spec | `spec_grill` | `draft` → `spec_ready` | ADR stored on feature record (API) |
| Build | `feature_build` | `spec_ready` → `queued` → … → `merged` | Code + ADR commit on feature branch |

User must explicitly approve the ADR and click **Start build** to dispatch
`feature_build`. Spec and build use **separate containers**.

## States and transitions

```
draft → spec_ready → queued → running → in_review → merged
                         │        │          │
                         │        ├──► failed └──► changes_requested → queued
                         │        └──► cancelled
                         └──► cancelled
```

| State | Meaning |
|-------|---------|
| `draft` | `spec_grill` in progress or awaiting user reply in grill chat. |
| `spec_ready` | ADR generated; awaiting human review and build approval. |
| `queued` | Build approved; waiting for Orchestrator capacity. |
| `running` | `feature_build` job active; events streaming. |
| `in_review` | Build finished; draft PR ready for human review. |
| `changes_requested` | Reviewer asked for changes; can re-run build. Set by the `pull_request_review` webhook (ADR 013) when a review is submitted with `state: "changes_requested"` on the feature's tracked PR, only while still `in_review`. |
| `merged` | PR merged. Set by the `pull_request` webhook (ADR 013) when the feature's tracked PR closes with `merged: true`. |
| `failed` | Build job errored. |
| `cancelled` | Spec or build was stopped. |

## Project home buckets

| Bucket | States |
|--------|--------|
| **Planned** | `draft`, `spec_ready` |
| **Being worked on** | `queued`, `running`, `in_review`, `changes_requested`, `failed` |
| **Completed** | `merged`, `cancelled` |

## TODO

- ~~Define who/what triggers each transition (user action vs. Orchestrator event vs.
  PR webhook) in API implementation.~~ Done for `in_review → merged` /
  `in_review → changes_requested` (ADR 013, `pull_request` /
  `pull_request_review` webhooks). All other transitions are Orchestrator
  curated events or direct user action, both already implemented.
- Re-grill / ADR revision workflow after `spec_ready`.
- A closed-without-merge PR has no lifecycle representation (ADR 013,
  deliberately left open).

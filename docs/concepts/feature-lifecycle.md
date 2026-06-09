# Concept: feature lifecycle

**Read this when:** you touch feature states, transitions, or the state machine
(Frontend status display, Backend persistence, Forge run outcomes).
**Skip if:** you don't deal with feature status at all.

> Status: DRAFT — the brief names a "full feature state machine" (Phase 2) but
> does not enumerate states. The model below is a **proposed placeholder** to be
> confirmed. Do not treat state names as final.

## What a feature is

A user-described unit of work for the agent to build. Each feature maps to (at
least) one agent run, a branch `yggdrasil/<feature-slug>-<id>`, and a draft PR.

## Proposed states (PLACEHOLDER — confirm)

```
draft → queued → running → in_review → merged
                    │           │
                    ├──► failed  └──► changes_requested → running
                    └──► cancelled
```

| State | Meaning (proposed) |
|-------|--------------------|
| `draft` | Spec being written; not yet dispatched. |
| `queued` | Accepted, waiting for Forge capacity. |
| `running` | A Forge run is active; events streaming. |
| `in_review` | Run finished; draft PR ready for human review. |
| `changes_requested` | Reviewer asked for changes; can re-run. |
| `merged` | PR merged. |
| `failed` / `cancelled` | Run errored / was stopped. |

## TODO

- Confirm the canonical state list and transitions with the team.
- Define who/what triggers each transition (user action vs. Forge event vs. PR
  webhook).
- Relationship between feature state and PR state on GitHub.

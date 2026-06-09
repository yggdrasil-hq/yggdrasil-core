# Yggdrasil docs — index

These are **agent + developer** docs for the meta repo. End-user product docs
live in the `docs-site/` (Docusaurus) submodule, not here.

Start from the root [`../CLAUDE.md`](../CLAUDE.md) router. This index is the full
map; the router only lists the common entry points.

Every doc opens with a `**Read this when:**` line. Use it to decide whether the
doc is relevant before reading the body — that's how we keep context small.

## overview/ — orient yourself

| Doc | Read this when |
|-----|----------------|
| [`overview/product.md`](overview/product.md) | You need the product vision, the three components, and what Yggdrasil is *not*. |
| [`overview/architecture.md`](overview/architecture.md) | You need to know how Frontend, Backend, and Forge interact. |
| [`overview/glossary.md`](overview/glossary.md) | You hit a domain term (Forge, job, run, feature, Pi) you're unsure about. |

## components/ — per sub-repo summaries (link out to each submodule)

| Doc | Read this when |
|-----|----------------|
| [`components/frontend.md`](components/frontend.md) | Working on or referencing the web app. |
| [`components/backend.md`](components/backend.md) | Working on or referencing the API/DB. |
| [`components/orchestrator.md`](components/orchestrator.md) | Working on or referencing the Forge. |
| [`components/landing.md`](components/landing.md) | Working on the marketing site. |
| [`components/docs-site.md`](components/docs-site.md) | Working on the Docusaurus user docs. |

## concepts/ — cross-cutting domain logic

| Doc | Read this when |
|-----|----------------|
| [`concepts/pi-agent.md`](concepts/pi-agent.md) | You need to understand the Pi coding agent. |
| [`concepts/feature-lifecycle.md`](concepts/feature-lifecycle.md) | You touch feature states / the state machine. |
| [`concepts/job-dispatch.md`](concepts/job-dispatch.md) | You touch how the Backend hands work to the Forge. |
| [`concepts/project-settings.md`](concepts/project-settings.md) | You touch project- or feature-level configuration. |

## roadmap/ — what & when

| Doc | Read this when |
|-----|----------------|
| [`roadmap/phases.md`](roadmap/phases.md) | You need the planned build order / current phase. |
| [`roadmap/open-questions.md`](roadmap/open-questions.md) | You hit an undecided design question. |

## conventions/ — how we work

| Doc | Read this when |
|-----|----------------|
| [`conventions/repo-structure.md`](conventions/repo-structure.md) | Dealing with the parent/submodule layout or git submodule workflow. |
| [`conventions/branching-and-git.md`](conventions/branching-and-git.md) | Creating branches, commits, or PRs. |
| [`conventions/documentation-guide.md`](conventions/documentation-guide.md) | **Writing or updating any doc.** Read before editing docs. |

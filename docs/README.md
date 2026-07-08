# Yggdrasil docs — index

These are **agent + developer** docs for the meta repo. End-user product docs
live in the `docusaurus/` (Docusaurus) submodule, not here.

Start from the root [`../CLAUDE.md`](../CLAUDE.md) router. For a quick snapshot of
what is decided vs open, see [`CONTEXT.md`](CONTEXT.md). This index is the full
map; the router only lists the common entry points.

Every doc opens with a `**Read this when:**` line. Use it to decide whether the
doc is relevant before reading the body — that's how we keep context small.

## overview/ — orient yourself

| Doc | Read this when |
|-----|----------------|
| [`overview/product.md`](overview/product.md) | You need the product vision, the three components, and what Yggdrasil is *not*. |
| [`overview/architecture.md`](overview/architecture.md) | You need to know how Web, API, and Orchestrator interact. |
| [`overview/glossary.md`](overview/glossary.md) | You hit a domain term (Orchestrator, job, run, feature, Pi) you're unsure about. |

## components/ — per sub-repo summaries (link out to each submodule)

| Doc | Read this when |
|-----|----------------|
| [`components/web.md`](components/web.md) | Working on or referencing the web app. |
| [`components/api.md`](components/api.md) | Working on or referencing the API/DB. |
| [`components/orchestrator.md`](components/orchestrator.md) | Working on or referencing the Orchestrator. |
| [`components/landing.md`](components/landing.md) | Working on the marketing site. |
| [`components/docusaurus.md`](components/docusaurus.md) | Working on the Docusaurus user docs. |

## adr/ — architecture decision records

| Doc | Read this when |
|-----|----------------|
| [`adr/README.md`](adr/README.md) | You need the ADR format or the index of decisions. |
| [`adr/001-authentication.md`](adr/001-authentication.md) | You need the *rationale* for auth (sessions, OAuth, no email). |
| [`adr/002-projects-features-tests.md`](adr/002-projects-features-tests.md) | You need the *rationale* for projects, features, tests, and project UX. |
| [`adr/003-orchestrator-kubernetes.md`](adr/003-orchestrator-kubernetes.md) | You need the *rationale* for the Orchestrator's Kubernetes compute model, project hosting, or job queue. |

## concepts/ — cross-cutting domain logic

| Doc | Read this when |
|-----|----------------|
| [`concepts/authentication.md`](concepts/authentication.md) | You implement login, signup, sessions, or GitHub OAuth. |
| [`concepts/github-app.md`](concepts/github-app.md) | You implement or debug GitHub App install, permissions, or repo sync. |
| [`concepts/pi-agent.md`](concepts/pi-agent.md) | You need to understand the Pi coding agent. |
| [`concepts/feature-lifecycle.md`](concepts/feature-lifecycle.md) | You touch feature states / the state machine. |
| [`concepts/job-dispatch.md`](concepts/job-dispatch.md) | You touch how the API hands work to the Orchestrator. |
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
| [`conventions/theming.md`](conventions/theming.md) | Theming any web surface (tokens, Tailwind, ShadCN, Docusaurus). |
| [`conventions/deploy.md`](conventions/deploy.md) | Dockerfiles, compose, nginx routing for dev/prod/CI. |

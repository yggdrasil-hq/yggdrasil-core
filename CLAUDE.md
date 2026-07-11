# CLAUDE.md — Yggdrasil (meta repo)

> This is the **canonical agent guide** for the Yggdrasil suite. Other tools
> read different filenames, so `AGENTS.md` and `.cursor/rules` (if present) are
> thin pointers back to this file. Edit instructions **here**.

## How to use this file (read me first)

You are working in the **parent / meta repo**. It contains no application code —
only documentation and the child repos (git submodules) that hold the real code.

**Context discipline — this is the whole point of this setup:**

1. Read this router (you're doing it now). It is short on purpose.
2. Find your task in the **Routing table** below and open **only** the doc(s) it
   points to. Do not pre-read the whole `docs/` tree.
3. Each doc starts with a `**Read this when:**` line. If that trigger does not
   match your task, close it and move on.
4. When you work inside a child repo, that repo's own `CLAUDE.md` is the
   authority for it. Read it before its `docs/`.

## What is Yggdrasil? (one paragraph)

Yggdrasil is an AI-orchestrated software-development suite for small teams.
Humans describe *what* to build; AI coding agents (built on **Pi**, pi.dev)
autonomously build it inside isolated Docker containers, opening GitHub pull
requests and streaming progress back in real time. See
`docs/overview/product.md` for the full picture.

## Repo map (submodules)

| Path             | GitHub repo              | What lives there                                  | Status |
|------------------|--------------------------|---------------------------------------------------|--------|
| `web/`           | `yggdrasil-hq/yggdrasil-web` | React/Next.js web app                         | added  |
| `api/`           | `yggdrasil-hq/yggdrasil-api` | REST + WebSocket API, PostgreSQL              | added  |
| `orchestrator/`  | `yggdrasil-hq/yggdrasil-orchestrator` | Stateless job executor / Docker orchestration | added  |
| `landing/`       | `yggdrasil-hq/yggdrasil-landing` | Marketing / public website                 | added  |
| `docusaurus/`    | `yggdrasil-hq/yggdrasil-docusaurus` | End-user product documentation (NOT agent docs) | added  |
| `agent-images/`  | `yggdrasil-hq/yggdrasil-agent-images` | Pi base container images: skills, shared extension, model config (ADR 004) | added  |

> Meta repo: `yggdrasil-hq/yggdrasil-core`. Clone with submodules:
> `git clone --recurse-submodules git@github.com:yggdrasil-hq/yggdrasil-core.git`
> See `docs/conventions/repo-structure.md` for the add/clone/update workflow.

## Routing table — open only what matches your task

| If your task is about…                                  | Read                                   |
|---------------------------------------------------------|----------------------------------------|
| Understanding the product / scope / what it is NOT      | `docs/overview/product.md`             |
| How the components fit together / data flow             | `docs/overview/architecture.md`        |
| A domain term you don't recognize (Orchestrator, job, run…)    | `docs/overview/glossary.md`            |
| The Web app                                             | `docs/components/web.md` → `web/CLAUDE.md`           |
| The API (API/DB)                                        | `docs/components/api.md` → `api/CLAUDE.md`           |
| The Orchestrator                                        | `docs/components/orchestrator.md` → `orchestrator/CLAUDE.md` |
| The landing / marketing site                            | `docs/components/landing.md` → `landing/CLAUDE.md`   |
| The end-user docs site (Docusaurus)                     | `docs/components/docusaurus.md` → `docusaurus/CLAUDE.md` |
| Authentication / login / sessions / GitHub OAuth (identity) | `docs/concepts/authentication.md` → ADR `docs/adr/009-github-only-authentication.md` (amends `docs/adr/001-authentication.md`) |
| GitHub App / repo install / webhooks / permissions / repo sync / job tokens | `docs/concepts/github-app.md` → ADR `docs/adr/005-github-app-repository-access.md` |
| Projects / features / tests / project home / notifications | ADR `docs/adr/002-projects-features-tests.md` → `docs/concepts/feature-lifecycle.md`, `docs/concepts/job-dispatch.md` |
| `project_init` grill workflow / child-project structure standard (setup.sh/run.sh/Helm/docs) / submodule sub-repos | ADR `docs/adr/008-project-init-grill-and-submodule-repos.md` |
| The Pi agent (how the agent itself runs)                | `docs/concepts/pi-agent.md`            |
| Pi RPC transport / how the Orchestrator drives Pi (attach, event relay, mid-run replies) | ADR `docs/adr/006-pi-rpc-orchestrator-integration.md` (spec_grill) → ADR `docs/adr/010-feature-build-rpc-wiring.md` (feature_build) → ADR `docs/adr/011-feature-build-running-state.md` (queued→running) |
| Base container images / skills / MCP-vs-Playwright / model config | `docs/components/agent-images.md` → ADR `docs/adr/004-agent-base-containers.md` → `agent-images/CLAUDE.md` |
| Feature states / lifecycle                              | `docs/concepts/feature-lifecycle.md`   |
| Architecture decisions (why we chose X)                 | `docs/adr/` → start at `docs/CONTEXT.md` |
| How the API dispatches jobs to the Orchestrator         | `docs/concepts/job-dispatch.md`        |
| Project / per-feature settings & config                 | `docs/concepts/project-settings.md`    |
| What we're building now / build order                   | `docs/roadmap/phases.md`               |
| Undecided design questions                              | `docs/roadmap/open-questions.md`       |
| Repo/submodule layout & git workflow                    | `docs/conventions/repo-structure.md`   |
| Branching, commits, PR conventions                      | `docs/conventions/branching-and-git.md`|
| Theming / design tokens across web surfaces             | `docs/conventions/theming.md`          |
| Docker / compose / nginx deploy layout                  | `docs/conventions/deploy.md` → `deploy/README.md` |
| **Writing or updating docs** (do this right)            | `docs/conventions/documentation-guide.md` |

A fuller index lives in `docs/README.md`.

## Standing rules for agents

- **Keep docs in sync.** If a change makes a doc wrong, update the doc in the
  same change. New cross-cutting concept → add a doc and a routing-table row.
- **One concern per doc.** Don't dump everything into this file. Route to a doc.
- **Parent vs. child.** Suite-wide concepts live here; repo-specific detail
  lives in that repo's `docs/`. Don't duplicate — link.
- **User docs ≠ agent docs.** `docusaurus/` (Docusaurus) is for end users. The
  `docs/` folders described here are for agents and developers.
- **Living context:** `docs/CONTEXT.md` — quick snapshot of decided vs open.
- **Status:** early implementation. Auth design is accepted (ADR 001). Other docs
  marked `TODO` / `DRAFT` are not yet authoritative — flag assumptions rather
  than inventing details.

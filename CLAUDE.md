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
| The Pi agent (how the agent itself runs)                | `docs/concepts/pi-agent.md`            |
| Feature states / lifecycle                              | `docs/concepts/feature-lifecycle.md`   |
| How the API dispatches jobs to the Orchestrator         | `docs/concepts/job-dispatch.md`        |
| Project / per-feature settings & config                 | `docs/concepts/project-settings.md`    |
| What we're building now / build order                   | `docs/roadmap/phases.md`               |
| Undecided design questions                              | `docs/roadmap/open-questions.md`       |
| Repo/submodule layout & git workflow                    | `docs/conventions/repo-structure.md`   |
| Branching, commits, PR conventions                      | `docs/conventions/branching-and-git.md`|
| Theming / design tokens across web surfaces             | `docs/conventions/theming.md`          |
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
- **Status:** the project is in planning. Docs marked `TODO` / `DRAFT` are not
  yet authoritative — flag assumptions rather than inventing details.

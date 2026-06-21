# Product overview

**Read this when:** you need the product vision, the three components at a high
level, or the explicit non-goals.
**Skip if:** you already know the product and just need a specific component or
concept — use the routing table instead.

## What is Yggdrasil?

Yggdrasil is an AI-orchestrated software-development suite for **small teams
(2–10 people)**. Users describe features, provide context, and have AI coding
agents autonomously develop those features inside isolated Docker containers —
creating branches, opening pull requests, and reporting progress in real time.

The platform is **language- and framework-agnostic**; any codebase hosted on
GitHub can be managed through it.

> Core idea: humans define *what* to build, Yggdrasil's agents figure out *how*,
> and the team reviews and approves the output via standard GitHub pull requests.

## The three components

1. **Web** — responsive web app (desktop-first, React/Next.js). Where users
   create projects, write feature specs, monitor agent runs, review test
   reports, and chat with the agent mid-run. → `components/web.md`
2. **API** — REST + WebSocket API. Single source of truth for all persistent
   state (users, teams, projects, features, agent jobs, test suites, reports,
   notifications). Manages GitHub OAuth tokens, dispatches jobs to the Orchestrator, and
   delivers real-time events to the Web app. PostgreSQL + object storage. →
   `components/api.md`
3. **Orchestrator** — the stateless execution layer. Provisions
   ephemeral Docker containers, injects the Pi agent, clones the repo with a
   short-lived scoped token, creates a branch, opens a draft PR, runs Pi in
   RPC/SDK mode streaming events back, optionally tunnels a preview URL, then
   tears down and archives artefacts. → `components/orchestrator.md`

See `overview/architecture.md` for how they talk to each other.

## What Yggdrasil is NOT

- **Not a code editor / IDE** — it does not replace VS Code, Cursor, etc.
- **Not a CI/CD pipeline** — it complements existing CI; it does not replace
  GitHub Actions.
- **Not a Jira/Linear-style PM tool** — features are intentionally kept simple
  to stay focused on development.
- **Not opinionated about tech stack** — any language, framework, build system.

## Current phase

Early implementation — Web UI shell exists; **Phase 1 auth design is accepted**
(see `docs/adr/001-authentication.md`). See `roadmap/phases.md` for build order
and `roadmap/open-questions.md` for undecided design points.

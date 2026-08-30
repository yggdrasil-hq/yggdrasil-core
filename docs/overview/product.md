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
   notifications). Manages GitHub OAuth (identity) and GitHub App installations,
   dispatches jobs to the Orchestrator, and delivers real-time events to the Web app.
   PostgreSQL + object storage. → `components/api.md`
3. **Orchestrator** — the execution layer. Runs on Kubernetes: provisions
   ephemeral Pods/Jobs for agent runs (injects the Pi agent, clones the repo(s)
   with a short-lived installation token, creates a branch, opens a draft PR, runs Pi
   in RPC/SDK mode streaming events back, optionally exposes a preview URL,
   then tears down and archives artefacts), and separately maintains each
   project's always-on primary deployment via Helm. → `components/orchestrator.md`

See `overview/architecture.md` for how they talk to each other.

## What Yggdrasil is NOT

- **Not a code editor / IDE** — it does not replace VS Code, Cursor, etc.
- **Not a CI/CD pipeline** — it complements existing CI; it does not replace
  GitHub Actions.
- **Not a Jira/Linear-style PM tool** — features are intentionally kept simple
  to stay focused on development.
- **Not opinionated about tech stack** — any language, framework, build system.

## Current phase

**Phase 1 is complete** and parts of Phase 2 are built: GitHub-only auth,
GitHub App repo access, project/feature CRUD, the two-phase feature workflow
(`spec_grill` → ADR review → `feature_build` → PR) with live Pi RPC
integration, and webhook-driven merge/deploy automation are all implemented
end to end. `design_grill` (live design-session mockups, ADR 014), a
six-stage feature lifecycle rework — Spec → Action Items → Implementation →
Testing → Agentic Review → Manual Review (ADR 015) — and an Organization/
RBAC/org-level-config/cluster-routing model (ADR 016) are all decided but
not yet built. Testing (Phase 3) and live preview tunnels remain unbuilt.
See `roadmap/phases.md` for the current build-order snapshot and
`roadmap/open-questions.md` for undecided design points.

`design/` (meta repo root — see `conventions/design-wireframes.md`) is the
current source of truth for where the Web app's IA is headed next, and it's
still larger than what's described above: new usage/analytics/allocations/
infrastructure surfaces and a landing-page redesign remain **undecided** —
wireframes only. (Organization/RBAC and the six-stage feature lifecycle,
both also originally sketched in `design/`, are the two exceptions — now
decided, ADR 016 and ADR 015, just not built — see above.) See
`docs/CONTEXT.md`'s "Proposed (surfaced by `design/`)" section for the full
rollup of what's still undecided before assuming any of it is real.

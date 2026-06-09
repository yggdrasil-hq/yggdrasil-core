# Open questions (not yet decided)

**Read this when:** you hit a design decision that feels undecided, or you're
about to make an assumption in one of these areas. **Do not silently resolve
these — surface them.**

| # | Question | Affects |
|---|----------|---------|
| 1 | **Self-hosted vs. managed Forge compute** — will users bring their own servers? | Forge, job-dispatch transport, billing |
| 2 | **GitHub App implementation** details and webhook security. | Backend, auth |
| 3 | **Multi-repo project handling** — which repo does the agent target for a given feature? | Backend, project-settings, job-dispatch |
| 4 | **Secure injection of project-level env vars** into containers. | Forge, project-settings, security |
| 5 | **Branch conflicts** when two features are developed in parallel. | Forge, feature-lifecycle |
| 6 | **Container resource limits** and cost visibility for users. | Forge, billing/UX |

## How to use this list

- If your task touches one of these, treat the area as **unspecified**: propose,
  flag the assumption, and (if resolved) update this list + the relevant doc.
- Add new open questions here as they arise; remove a row when decided and record
  the decision in the appropriate `concepts/` or `conventions/` doc.

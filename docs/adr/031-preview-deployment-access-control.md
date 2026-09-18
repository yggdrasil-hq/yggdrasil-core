# ADR 031: Preview deployment access control

**Status:** Accepted
**Date:** 2026-09-18
**Deciders:** Product session (open-issue burn-down, wave 6)
**Builds on:** [ADR 003](003-orchestrator-kubernetes.md) (§10 the per-job temporary
deployment this gates, §15 the ingress layer and URL scheme, §17 the slot cap,
§5 the namespace-per-project isolation, §16 the `project-env` Secret a preview
inherits), [ADR 016](016-organization-rbac-and-cluster-routing.md) (project
access is membership, and the cluster a preview lands on is the org's), [ADR 022](022-deployment-rollback.md)
(§7's precedent: reuse the authorization that exists rather than inventing a
capability nothing enforces), [ADR 028](028-audit-logging.md) (the trail a
changed gate should appear in)
**Does not touch:** ADR 003 §17's slot cap and the teardown/sweep machinery
(both unchanged), ADR 013's primary-deployment automation, ADR 019's relay,
ADR 017's route map (the preview rows keep their routes)
**Supersedes:** ADR 003 §15's implicit "no auth" for the temporary-deployment
layer, and §10's inclusion of `spec_grill` in the preview-eligible kinds

## Context

Ephemeral preview deployments shipped in this burn-down (issue #1) as ADR 003
§10/§15/§17 described them: each preview-eligible job gets its own release and
Ingress at `<project-slug>-<kind>-<id>.preview.<domain>`, torn down at job end,
capped at three per project, swept by TTL. §15 placed previews on the same
ingress layer as primary deployments and specified **no authentication** — §6's
sandbox is *cluster* isolation, which is a different axis from access control,
and nothing in the ADR claimed otherwise.

So the current state, stated plainly rather than softened:

- **A preview is publicly reachable, and its only secret is the job UUID in its
  hostname.** A UUID is unguessable, which is not the same as secret: it leaks
  through a screenshot, a pasted link, a `Referer` header, a proxy log, and
  anyone who ever had access keeps it for the preview's lifetime.
- **It serves the project's real application environment.** `ensureJobPreview`
  fetches the project's secrets with the *deploy* job kind and pushes the same
  `project-env` Secret the primary deployment uses; the preview release is the
  same chart, so `envFrom: project-env` resolves the same values. A preview is
  therefore not a sandboxed copy of the app — it is the app, with production
  credentials, on a public host.
- **What it is not:** a preview has no persistent state of its own. The
  scaffolded chart (ADR 003 §12) declares a Deployment and a Service and no
  volume, and a preview must never mount the primary's volumes — two releases
  sharing one PVC is data corruption, which is why `preview.Config.Values`
  exists as the override seam.
- **The job pod reaches it unauthenticated.** `PREVIEW_URL` is set for
  `test_run` and consumed by the agent's own browser
  (`agent-images/test_run/playwright.config.ts` sets `baseURL` from it). This is
  the constraint that makes "just put a login in front of it" a breaking change
  rather than an additive one.
- **`spec_grill` gets a preview too**, per §10. Nothing a grill session produces
  is worth looking at — the package comment says so outright, since a grill is a
  read-only conversation against docs — yet it holds one of the three per-project
  slots and is as reachable as the rest.

The fact that made this urgent rather than theoretical is the second bullet: the
combination of *public host* and *real environment* is the default, and it is
the default for every project, including ones whose app talks to a real
database.

## Decision

### 1. The gate follows the secrets.

**A preview is authenticated if and only if the project has any entries in
`project_secrets`.** A project with none gets the current behaviour — a public
preview — because that is precisely the case where a preview cannot leak
anything: no credentials in its environment, and no persistent volume for the
chart to mount. A project with any secret gets a gated preview.

This is deliberately a **derived** property rather than a setting to declare:

- The two facts a user cares about — "my preview is reachable by anyone" and "my
  preview is running with real credentials" — can never drift apart, because one
  is computed from the other. A declared `previews_public` boolean would let a
  project be public *and* carrying a database password after someone added the
  secret later, which is exactly the drift a setting invites.
- It needs no new surface, no new ADR 028 action, and no decision from a user
  who has not thought about it.
- It matches how the product already works: `project_secrets` is the *only* way
  anything reaches a pod's environment (ADR 003 §16), so "has secrets" is
  already the product's notion of "this project has configuration worth
  protecting".

The cost is that the predicate is coarse. A project whose `project-env` holds
only non-sensitive configuration — a public API base URL, a feature flag — is
gated even though nothing in it is worth protecting, because the API does not
distinguish sensitive from public entries today. Item 6 is the fix for that, and
until it exists the coarseness fails in the safe direction.

**What the predicate is measuring, exactly**, because "has secrets" could
describe three different things and only one of them is the one that matters: a
preview's environment is built by `FetchProjectSecrets` with the **`deploy`** job
kind, and the API merges resolved model configuration into its response *only
for agent job kinds*. So a preview's environment is precisely the project's own
stored entries and nothing else — the organization's provider key does not reach
it, even though the job pod that created the preview holds one. That is also why
the predicate can be a plain "are there any rows" check rather than a filter:
there is no second source of values to filter out.

### 2. Authentication is project membership, via the session that already exists, enforced at the Ingress by a forward-auth subrequest to the API.

The preview's Ingress gains an auth subrequest pointing at the API, which
answers with the same `ProjectRepository.findByIdForUser` check every project
route uses. A request without a valid session for a **member of the preview's
project** is refused before the application container ever sees it.

Three properties are the reason for this shape and not another:

- **It reuses the authorization that exists.** Membership is the gate for every
  other project read, including `GET /projects/:id/previews` — the endpoint that
  tells the Web app this preview is live. Gating the preview by any other rule
  would mean the API says "you may see this preview exists" while the preview
  disagrees, which is the class of second permission concept ADR 022 §7 refused
  to invent.
- **It is revocable per person**, because a session is: removing a member or
  expiring their session closes the preview to them and nobody else. A
  per-preview shared credential — the obvious cheaper option — cannot do that,
  and it leaks through exactly the channels the host UUID already leaks through,
  so it adds a credential to protect without reducing the exposure.
- **It is enforced outside the application.** The preview runs the project's own
  code, which may be mid-implementation and may be wrong; putting the check in
  front of it means a broken or hostile build cannot bypass its own access
  control.

**The mechanism is deliberately left to implementation, and its first task is to
confirm it against the deployed ingress controller.** ADR 003 §15 permits
ingress-nginx *or* Traefik, and the two spell forward-auth differently
(`auth-url`/`auth-signin` annotations versus a `ForwardAuth` Middleware CRD).
The decision here is the gate's *shape* — subrequest to the API, keyed on the
session, per project — not an annotation set; writing one controller's YAML into
an ADR would make the ADR wrong on the other controller.

**It must fail closed.** If the API is unreachable, the auth subrequest fails and
the request is refused, not admitted. This is the same direction as the preview
teardown's fail-closed rule (the registry row closes only after the cluster
resources are gone) and it is the right direction for a gate that exists to
protect credentials: an API outage makes previews unavailable, which is a
degraded feature, whereas failing open makes every gated preview public during
an outage, which is a disclosure. How an ingress controller behaves when its
auth endpoint errors is version-dependent, so verifying that it fails closed
rather than 500-ing open is part of the implementation, not an assumption.

### 3. The job's own pod authenticates too, with a credential minted per run.

`PREVIEW_URL`'s one consumer is `test_run`: the agent's Playwright browser is
pointed at the preview, and a redirect to a Yggdrasil login would fail every test
run — a silent, total break of the feature the preview exists to support.

So a gated job pod receives a **preview credential** in its environment
alongside `PREVIEW_URL`, which the auth subrequest accepts for that job's preview
only. It is the same class of secret the pod already holds and already trusts
with more: the scoped GitHub installation token and the model API key. It is
scoped to one preview, expires with the job, and grants read access to a
development environment — strictly less than what the pod already has.

Two consequences worth stating: the credential must be scoped to *that* preview
(a pod must not be able to reach another job's), and it must be delivered in the
same place `PREVIEW_URL` is, so a job kind that never gets a URL never gets a
credential either.

**In practice that means `test_run` only, which is worth being explicit about.**
`PREVIEW_URL` is set for `test_run` alone, so a `feature_build`'s preview is
reached only by a human opening the link — and a human authenticates as
themselves. The credential therefore exists to keep *automation* working, not to
give agents a general pass: if a later change hands `PREVIEW_URL` to another job
kind, the same credential has to travel with it, and that is a two-line grep
rather than a design question.

### 4. Sharing a preview with a teammate is sharing the URL — but only with members.

The URL is the share. A member who opens it is let through, because their
browser presents the session the API already issued; a non-member is refused with
a page that says the preview belongs to a project they are not a member of,
**not** a login loop they cannot escape by logging in.

That last distinction is the one that matters for whether the gate is a help or
a trap: a redirect to sign-in is correct for a member whose session lapsed and
wrong for a stakeholder who was never a member, and the two are only
distinguishable after the session is known. The refusal path therefore has to
state the reason rather than bounce to `/login`.

**An external reviewer cannot be given access to a gated preview, and that is
the accepted cost of item 2.** The alternative — a shareable credential or a
per-preview invite — reintroduces a second authorization concept, cannot be
revoked per person, and would leak the same way the host does. A project that
genuinely needs an outsider to look at a preview has two honest routes: keep the
project's environment free of secrets (item 1 then makes it public by
construction), or accept that previews are for members and share a screen.

### 5. `spec_grill` stops getting a preview.

Amends ADR 003 §10's list to `feature_build` and `test_run`.

§10 named `spec_grill` alongside the other two, and the implementation carried
that faithfully — while recording in its own comments that the preview "only
ever serves the app as it already exists" because a grill session is a read-only
conversation against docs, and that it "competes for the same per-project slot
budget as a build or a test run". Both of those observations are arguments
against keeping it, and this ADR is where they land: it is the one eligible kind
whose preview nobody has a reason to open, so it is pure attack surface for no
product benefit, and removing it costs nothing.

This is a change to an accepted ADR's list, which is why it is written down as a
numbered decision rather than folded into the implementation.

### 6. A reduced secret set is the follow-up that would let a gated project become public.

The clean way to make a project's preview public *without* publishing its
credentials is to give the preview a filtered environment: each secret marked
preview-safe or not, with only the safe ones delivered. That is a real feature
rather than a small change — it needs a per-key marking, a second Secret the
preview's release reads instead of `project-env`, and a chart change to select
it — and it is the reason item 1's coarseness is acceptable in the meantime.

It is recorded rather than built because its absence is not a safety gap: the
gate covers the case it would otherwise leave exposed.

### What the implementing change has to do

Recorded as a checklist because this ADR decides policy and the code does not
exist yet — the list is what makes the decision actionable rather than advisory.

1. **Add the auth subrequest to the preview Ingress**, pointing at an API
   endpoint that answers "is the caller a member of this preview's project?"
   using the check the project routes already use. The Ingress is created in
   `preview.Ensure`, so that is where the annotation or CRD lands — and because
   ADR 003 §15 allows either ingress controller, **verify the fail-closed
   behaviour against the one actually deployed** before wiring it up for real.
   That verification is the first task, not a detail to discover later.
2. **Derive the predicate in the API**, not the Orchestrator: whether a preview
   is gated depends on whether the project has stored entries, which the API
   owns. Expose it on the internal endpoints the Orchestrator already calls
   (registration and/or the stale list) so both sides agree without the
   Orchestrator querying a table it does not own.
3. **Mint the per-preview credential** into a gated job pod's environment
   alongside `PREVIEW_URL`, and make the auth endpoint accept it for exactly
   that job's preview.
4. **Remove `spec_grill` from `preview.eligibleKinds`** (item 5) and check the
   queue admission policy that reads it — the cap counts by eligible kind.
5. **Render the refusal page**: a member whose session lapsed is redirected to
   sign-in; a non-member is told the preview belongs to a project they cannot
   access. Distinguishing them after the session is known is the whole point.
6. **Tests**: the predicate (both directions), the pod credential scoped to its
   own preview, and — as far as it can be tested without a cluster — that a
   request with no valid session is refused. The one thing a unit test cannot
   cover is the ingress controller's own behaviour; item 1 covers that by hand
   and should say so in the PR.

## Consequences

### Positive

- **The default is no longer "production credentials on a public host".** A
  project with secrets gets a preview only its members can open; a project
  without them keeps the frictionless public preview it was always safe to give.
- **No new authorization concept.** The preview is gated by the same membership
  check as every other project read, so there is one answer to "who may see this
  project", and it lives where the product already looks for it.
- **Removing a member removes their preview access**, immediately and without a
  second place to remember.
- **`spec_grill` stops consuming a slot nobody wanted and cannot be used to
  reach a project's app.**

### Negative / trade-offs

- **A gated preview needs a session, so it is no longer shareable with anyone
  who is not a member.** That is the deliberate trade in item 4 and it is a real
  capability loss for design review by an outsider.
- **The gate depends on the API being reachable from the cluster**, a new
  cross-layer requirement the preview layer did not have (ADR 003 §15 keeps the
  control-plane nginx and the cluster's ingress separate on purpose, which is
  also why proxying previews through Yggdrasil's own domain was rejected below).
  Failing closed means an API outage takes previews down with it.
- **The predicate is coarse** (item 1): a project with any secret is gated, even
  if none of it is sensitive, because nothing distinguishes the two today.
- **The mechanism is controller-specific in implementation**, even though the
  decision is not: nginx and Traefik spell forward-auth differently, so the
  gate has to be built and verified against whichever the install runs — and an
  install running one is not covered by a test of the other.
- **It does not make a preview a sandbox.** A member who opens someone else's
  preview is still using a live environment; the gate controls *who*, not
  *what they can do inside it*.
- **`consume: no` secrets** — the gate protects the environment, not the data an
  app reaches through it. A preview pointed at a production database still reads
  that database for whoever is allowed in.

### Follow-ups

1. **The reduced secret set** (item 6) — a per-key preview-safe marking and a
   second Secret, which is what lets a project with credentials have a public
   preview rather than choosing between a gated preview and none.
2. **Making `project-env` secrets distinguishable from public configuration**, so
   item 1's predicate can mean what it says. The two are one piece of work with
   item 6 and should probably be done together.
3. **Viewing a preview as an auditable event** (ADR 028). Not recorded here: the
   trail is for mutations, and a read-audit is a different feature with different
   volume characteristics (ADR 028 says so explicitly). Worth revisiting if a
   project ever wants to know who opened a preview.
4. **A per-project opt-out or opt-in for the gate itself**, if item 1's derived
   rule turns out to be wrong for a real project. Deliberately not offered now:
   a setting whose default is "expose my credentials" is worse than a derived
   rule that is occasionally stricter than necessary.
5. **An image pipeline for the branch under construction** (issue #19). Still the
   reason previews are of limited use — the gate does not change that, and
   neither does this ADR.
6. **Multi-replica forward-auth caching.** A subrequest per preview request is
   fine at these volumes, but if a preview ever serves real traffic the cache
   lifetime of a successful auth decision becomes a question (and a cache that
   outlives a revoked membership is a leak).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| **Leave previews public, rely on the unguessable host** | The status quo, and the thing issue #20 exists to decide. A UUID is not a secret: it survives in screenshots, shared links, `Referer` headers and proxy logs, and it is permanent for the preview's life. Combined with the project's real environment, this is a disclosure waiting for one paste. |
| **Authenticate with a per-preview basic-auth credential the orchestrator generates** | Adds a credential to protect without reducing exposure — it leaks through the same channels as the host — and creates a *second* authorization concept beside membership, with no way to revoke one person or to tell who used it. That is the trap ADR 022 §7 named: a permission nothing else enforces. |
| **A per-preview invite or shareable token minted by the API** | Same objections, plus a management surface (mint, list, revoke, expire) that duplicates project membership. Rejected for the same reason. |
| **Serve previews under the Yggdrasil app's own host as a path** (`APP_HOST/preview/<id>/`) so the existing session cookie applies with no new mechanism | Attractive precisely because cookies solve it — and rejected on topology. It makes Yggdrasil's control-plane nginx a reverse proxy into the *customer's* cluster for every preview request, which ADR 003 §15 separated deliberately, adds a hard requirement that the cluster be reachable from the control plane (not true for every self-hosted install), and puts user-app traffic through the control plane's capacity. |
| **Widen the session cookie's `Domain` so it reaches preview subdomains** | Only works when the app and preview hosts share a registrable domain, which is a deployment assumption this product does not control (a self-hosted install may put them on entirely different domains). Making a security property depend on a hostname convention no one enforces is worse than the redirect. |
| **Gate by job kind** (`feature_build` gated, `test_run` public) | Whether a preview is safe depends on what the *application* is and what it is configured with, not on which job created it. Two previews of the same project differ in nothing but their URL. |
| **A declared `previews_public` project setting, default off** | Rejected as the *default* mechanism because the setting can drift from reality — a project becomes public and later gains a database password, and nothing re-checks. Item 1 derives it instead. A setting remains a possible follow-up (item 2 above) if the derived rule proves wrong in practice. |
| **Drop the preview for projects with secrets entirely** | Blunt: it removes the feature from most real projects rather than gating it, and previews are how a test run's failure is debugged. |
| **Reduced secret set as the *only* fix** (no gate at all) | Would leave the environment safe but the *gate* absent, and it is not a small change (per-key marking, second Secret, chart change). It is the right follow-up (item 6) and the wrong first move, because the gate covers the case a reduced set would not. |
| **Allow in-cluster traffic through the gate, unauthenticated** | "Internal" is not a security boundary that survives a shared cluster: any pod that can route to the preview's Service could claim to be internal, and the rule is invisible in review. The pod credential (item 3) is explicit, scoped to one preview, and expires. |
| **Fail open when the auth subrequest errors** | During an API outage this makes every gated preview public — turning a dependency failure into a disclosure. Failing closed degrades a feature; failing open breaks the guarantee the gate exists for. |

# ADR 027: Per-user notification preferences

**Status:** Accepted
**Date:** 2026-09-17
**Deciders:** Product session (Phase 4 polish review)
**Builds on:** [ADR 002](002-projects-features-tests.md) (the `notifications` table
and project-feature lifecycle being notified about), [ADR 016](016-organization-rbac-and-cluster-routing.md)
(Organization as the tenancy boundary, and its org-scoped settings/authorization
patterns), [ADR 001](001-authentication.md)/[ADR 009](009-github-only-authentication.md)
(no email exists anywhere in the auth model — which is why this is in-app only)
**Does not touch:** ADR 003/006/010/011 (job dispatch and Pi RPC — preferences
observe notification creation, they do not participate in it), ADR 015 (feature
lifecycle; the kinds notified about are unchanged), ADR 028 (the audit trail is a
separate, org-scoped record and is deliberately not subject to these preferences),
`design/` (no wireframe exists for this surface — see item 11)

## Context

`roadmap/phases.md` Phase 4 lists "notification preferences" as unbuilt, and
`yggdrasil-hq/yggdrasil-core#7` tracks it. Today every notification the API creates
is written to every member of the organization, with no way to reduce it:
`NotificationRepository.create` inserts unconditionally, and there is no settings
surface anywhere for it. A user who does not care about one project's activity —
or about one category of event — has only the global "mark all read" button.

Two facts about the current system constrain the design:

1. **`notifications` stores `user_id`, `project_id` and `kind`** (migration 002),
   and `project_id` is nullable. It has no `organization_id`.
2. **The set of kinds actually created is small and fixed.** Only five kinds are
   ever passed to `notifications.create`, all in `src/projects/routes.ts`
   (`project_created`, `chart_scaffold_failed`, `feature_created`, `adr_approved`,
   `build_started`). The product's other frequently-named kinds — `spec_grill`,
   `feature_build`, `test_run`, `agentic_review`, `design_grill`, `deploy` — are
   **job kinds**: they are dispatched, and completing one does not create a
   notification. This matters for item 7.

## Decision

### Storage — two shapes, because they answer two questions

1. **`notification_preferences`** — keyed `(user_id, organization_id, kind)`, with
   `enabled BOOLEAN`. This answers *"which kinds do I want, in this organization?"*.
   `kind` is **nullable**, and a row with `kind IS NULL` is the organization-wide
   row: the "all project activity" master toggle. A row naming a concrete kind
   takes precedence over it for that kind.

2. **`project_notification_mutes`** — keyed `(user_id, project_id)`, presence-only.
   This answers *"keep this project out of my inbox, whatever it is"*. It has no
   kind axis and no organization column: the project already implies its
   organization, and "not this project" is not a per-kind statement.

   These are deliberately not one table with a generic `scope_type`/`scope_id`
   pair. A single polymorphic scope column would make the most common read —
   "this user's preference for this kind in this org" — a join on a text
   discriminator, and it would still need different meanings for the two cases
   (`enabled` is a real value for a kind; a project mute has no value at all).
   Two narrow tables with explicit foreign keys keep both reads a single index
   scan and let each carry the constraints that actually apply to it.

3. **Postgres cannot put a nullable column in a `PRIMARY KEY`**, so the
   "one row per (user, org, kind-or-all)" invariant is expressed as **two partial
   unique indexes** (migration 031): one on `(user_id, organization_id) WHERE kind
   IS NULL`, one on `(user_id, organization_id, kind) WHERE kind IS NOT NULL`.
   Each is also a valid `ON CONFLICT` target, which is what the upsert uses —
   the two branches in `setPreference` are not stylistic, they target different
   indexes.

### Preferences are applied at creation, not at read

4. **`NotificationRepository.create` consults preferences and skips the insert.**
   A suppressed notification is never written; `create` returns `null` instead of
   a row.

   Filtering at read time was the alternative: store everything and let the list
   query hide what the user muted. That was rejected because it puts the same
   rules on every reader. The inbox query, the unread count, and any future digest
   or badge would each have to re-derive the precedence, and they would eventually
   disagree — an unread badge counting notifications the list refuses to show is
   the obvious failure. Suppressing once, at the single write path, makes the
   stored rows themselves the answer.

5. **The cost, stated plainly: enabling a kind later does not backfill.** Anything
   suppressed while a kind or project was muted is gone; it was never recorded, so
   there is nothing to show retroactively. This is a real behavioural difference
   from read-time filtering and is deliberate — the alternative is an unbounded
   table of notifications the user has explicitly said they do not want, plus a
   read-time filter on every surface. The settings UI says so in as many words.

### Default: notify

6. **A user with no rows gets everything.** `shouldNotify` returns true when
   neither a mute nor any preference row matches. This is what makes the change a
   pure addition: every notification path behaves exactly as it did before
   preferences existed, and the existing suite needed no behavioural changes.
   Only an explicit row suppresses — both tables are consulted to *subtract*, never
   to grant.

### Precedence

7. Most specific first:

   1. **a per-project mute** suppresses regardless of kind — an explicit "not this
      project" outranks any kind-level setting, and no kind can opt back in;
   2. a row for the **exact kind**;
   3. the **organization-wide** row (`kind IS NULL`);
   4. otherwise, **notify**.

   `shouldNotify` in `src/notifications/preferences.ts` is the single
   implementation of this ladder, and `isKindEnabled` (used to serialize the
   settings response) is defined in terms of it, so the UI and the write path
   cannot disagree about what "on" means.

### The kind registry

8. **`NOTIFICATION_KINDS` names exactly the kinds the API creates today** — the
   five above. It deliberately does **not** list the job kinds that were
   originally assumed to be notification kinds. A switch for a kind that can never
   fire is worse than no switch: it tells the user they have configured something
   when nothing reads it. Adding a kind is a one-line change to the registry once
   something actually creates it, and it then appears in the settings UI with no
   other edit.

   The corollary is recorded rather than hidden: **there is still no notification
   for a completed build, a deploy, or a design session.** Those events are visible
   on the feature page and in the audit trail (ADR 028), but they do not reach the
   notification inbox at all, and preferences cannot turn on something that is not
   sent. Sending them is a separate, unbuilt feature.

### Organization resolution, and the no-project case

9. **A notification's organization is reached through its project.** Since
   `notifications` has no `organization_id`, both preference shapes are keyed off
   the project row that `project_id` points at. Adding a denormalized
   `organization_id` column was considered and rejected: it would have to be kept
   in step with a project that can move between organizations, to save one indexed
   lookup on a low-frequency write.

10. **A notification with no project cannot be traced to an organization, so no
    preference row can match and it notifies.** This branch exists because
    `project_id` is nullable, and the safe direction is to preserve
    pre-preferences behaviour rather than silently drop a notification nobody
    asked to suppress. It is not a live code path today: all five create sites
    pass a project. Note this contradicts an assumption in the original brief,
    which gave `project_created` as an example of a project-less notification —
    `project_created` does carry a `project_id`.

### API surface

11. **Routes live under `/settings`, beside the existing account route**, because
    these are personal settings rather than organization configuration:

    - `GET /settings/notification-preferences?org=<id>` — the master row plus one
      entry per registered kind, each already resolved to its **effective** state,
      plus the user's muted project ids. The client never re-derives precedence.
    - `PUT /settings/notification-preferences` — `{organizationId, kind, enabled}`,
      where `kind: null` writes the org-wide row.
    - `PUT /settings/notification-preferences/projects/:projectId` —
      `{muted: boolean}`.

    **Authorization: any member may read and write their own preferences; no role
    is required.** These are not org-admin settings, so the admin check that
    guards cluster/secrets/providers would be wrong here. Membership of the named
    organization is required, and a non-member gets the same **404** the
    neighbouring `GET /organizations/:id` route returns — a 403 would confirm the
    organization exists. The project-mute route is gated on the same project
    access check the project settings routes already use, so a user can only mute
    a project they can see.

### Web

12. **Account settings** gains a notification section: an organization picker,
    the master toggle, one toggle per registered kind, and a one-line summary of
    the current state. The organization is chosen rather than implied — preferences
    are personal but keyed per organization, and a user can belong to several.

13. **Project settings** gains a single mute toggle for that project. The
    organization comes from the project record rather than a picker, since a
    project belongs to exactly one.

14. **Every save refetches the list** instead of patching local state. The API
    returns effective states, so changing the org-wide row also changes the
    apparent state of kinds that were inheriting it; a local patch would leave
    those switches stale. The refetch is one request against an endpoint returning
    a handful of rows, and the toggle updates optimistically first so the click
    still feels immediate.

## Consequences

### Positive

- Users can turn off what they do not want, per organization and per project,
  without the org's other members being affected — preferences are per-user, and
  two users in one organization can hold opposite settings.
- The default is "notify", so nothing needs migrating and no existing notification
  is lost on upgrade: an untouched user's behaviour is byte-for-byte what it was.
- Suppression happens at one write path, so the inbox, the unread count and any
  future badge cannot disagree about what the user has opted out of.
- The kind list is a single registry, so the settings UI cannot drift from what
  the API sends.

### Negative / trade-offs

- **No backfill.** Turning a kind back on does not restore anything suppressed
  while it was off (item 5). This is the price of creation-time filtering, and it
  is the behaviour a user is least likely to predict, so the UI states it.
- **Preferences only reach what is actually sent.** Four commonly-expected
  notification categories (build completion, deploy, design session, test run)
  do not exist as notifications at all, so no preference can control them and the
  settings page offers no switch for them (item 8). A user looking for "notify me
  when the build finishes" will not find it — the gap is in what is sent, not in
  this feature.
- **Three extra queries per notification** (organization, preference rows, mute)
  on a path that previously ran one insert. Acceptable at the observed volume
  (notifications are user-facing lifecycle events, not high-frequency traffic),
  but it does make `create` non-trivial.
- **A preference row is invisible to the audit trail.** Preferences are personal
  settings, so writes to them are not audited (ADR 028's coverage table does not
  include them). An administrator cannot see why a user stopped receiving
  something.
- **No per-project kind granularity.** A project mute is all-or-nothing; "build
  notifications for this project but not deploys" is not expressible. That is a
  consequence of the two-shape split (item 1) and was accepted to keep the common
  cases simple.
- **Mutes are global across organizations for that project.** The mute table has
  no organization column, which is correct for a project (it belongs to one org)
  but means the muted-ids list returned to the client is not org-filtered.

### Follow-ups (out of scope here)

- Sending notifications for the events that currently produce none (build
  finished, deploy finished/failed, design session finalized), which is what would
  give the job kinds real toggles.
- Batching/digest delivery and quiet hours.
- Any out-of-app delivery. There is no email anywhere in the auth model
  (ADR 001/009), so "preferences" here means in-app inbox only; email would need
  an address concept first.
- Per-project per-kind preferences, if all-or-nothing proves too coarse.
- Retention: muted-at-creation means the table stays as small as the user wants,
  but no pruning policy exists for `notifications` itself.
- A `design/` wireframe. This surface has none; it was built from the sibling
  account/project settings shell and existing tokens, and is recorded as known
  ADR 017 drift.

## Alternatives considered

| Alternative | Why not |
|---|---|
| One table with a generic `scope_type`/`scope_id` scope column | `enabled` is meaningful for a kind but not for a project mute, so the column would be half-unused and nullable; every read becomes a join on a text discriminator. Two narrow tables with real foreign keys are simpler to constrain and to read. |
| Filter at read time (store everything, hide on read) | Puts the same precedence rules on the inbox query, the unread count, and every future consumer, which will drift apart. See item 4. |
| Denormalize `organization_id` onto `notifications` | Saves one indexed lookup per write, at the cost of keeping a copy in step with a project whose organization can change. See item 9. |
| Expose a toggle for every job kind (`spec_grill`, `feature_build`, `deploy`, `design_grill`, …) | Those never create a notification, so the switches would do nothing. See item 8. |
| Store per-user defaults globally rather than per organization | Which notifications matter is org-relative (a user's personal org and their employer's org have different noise), and a user can belong to several. Per-org rows are also what ADR 016's other settings do. |
| Org-admin-managed (admin sets notifications for members) | Notification preferences are personal. No role check is applied; the admin gate used for cluster/secrets/providers would be wrong here. |

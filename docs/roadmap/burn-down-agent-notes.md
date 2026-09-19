# Burn-down: conventions for delegated agents

You are one of several agents working through the open issues of the Yggdrasil
suite. This file is your shared context so each of you needs no memory of the
others. **Read it before you start.**

## The repo layout

`/home/mugiwara/files/personal/projects/apps/yggdrasil` is the **meta repo**. It
contains no application code — only docs and the child repos as git submodules.
**Read `CLAUDE.md` in it first**: it has a routing table pointing at whichever
doc your task needs, so you do not have to read the whole `docs/` tree.

| Path | Repo | What is there |
|---|---|---|
| `api/` | `yggdrasil-hq/yggdrasil-api` | REST + WebSocket API, PostgreSQL, Express 4 + TS |
| `web/` | `yggdrasil-hq/yggdrasil-web` | Next.js app |
| `orchestrator/` | `yggdrasil-hq/yggdrasil-orchestrator` | Stateless job executor, Go, Kubernetes |
| `agent-images/` | `yggdrasil-hq/yggdrasil-agent-images` | Pi base images, skills, shared extension |
| `landing/`, `docusaurus/` | | Marketing site, end-user docs |
| `docs/` (meta) | `yggdrasil-hq/yggdrasil-core` | ADRs — the design authority |
| `design/` (meta) | | HTML wireframes; ADR 017 makes them the source of truth for how a page looks |

## Non-negotiable rules

1. **Run every build, test and install command through Docker.** Do not install
   anything on the host. Each child repo has a `docker-compose.test.yml` and a
   `deploy/Dockerfile.test`; the standard invocation is:
   ```
   docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from test
   ```
   For Go, `docker run --rm -v "$PWD":/app -w /app -v yggdrasil-gocache:/go/pkg/mod golang:1.26-bookworm sh -c "gofmt -l cmd internal; go test ./... -count=1"`.
   Note `npx` is blocked by the sandbox — use `./node_modules/.bin/<tool>` if a
   repo's node_modules is present (api and web have them), or the repo's own
   `scripts/run-tests.sh` (which the Docker test image runs for you).

2. **Do not fix something you have not reproduced.** If a test is the only thing
   that would catch it, the test is part of the fix. Tests that pass trivially —
   e.g. a fake repository that never executes the real SQL — do not count as
   verification; say so plainly if that is all you could get.

3. **Read before you write.** Each child repo has its own `CLAUDE.md`, which is
   the authority inside it. Respect the existing comment style: this codebase
   explains *why* in prose comments, and that is deliberate — match it.

4. **One writer per repo.** You are told in your task which repos you own. Do
   not write to a repo you were not given; another agent may be in it. If your
   work genuinely needs a change there, implement what you can and report the
   rest rather than reaching across.

5. **Land it the way this project lands things**: branch (`fix/<issue>-<slug>` or
   `feat/...`), commit with a message that explains the reasoning and references
   the issue (`Refs yggdrasil-hq/yggdrasil-core#NN`), open a PR with `gh`, and
   **merge it to main once the suite is green**
   (`gh pr merge <n> --squash --delete-branch`). Then bump nothing in the meta
   repo yourself — the coordinator does that.

5b. **Careful with closing keywords in commit messages.** GitHub matches
   `close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved` followed by an
   issue reference **anywhere** in a commit message — not just at the start, and not
   only as a directive. So a sentence of ordinary prose can close an issue:

   > Also folded in: ADR 032 … **resolves #28**

   That closed #28, whose work was not done (it had a decision and no code). It was
   noticed only by comparing the open count against an inventory. When you mean "this
   addresses the decision", write it without a closing verb next to the number, or
   just use `Refs yggdrasil-hq/yggdrasil-core#NN` — which is unambiguous and is what
   every commit in this repo should carry anyway.

   **And it fires on a quotation too.** The commit that *introduced* this warning
   quoted the offending sentence as an example — and closed the issue a second time.
   GitHub parses the message as plain text, with no notion of quotation, code spans
   or intent, so quoting the pattern performs it. When describing this trap in a
   commit message, break the adjacency (verb in one sentence, reference in another)
   or describe it without reproducing it. The literal text is safe in a *file* like
   this one; GitHub only parses commit messages and PR bodies.

6. **Close the issue when it is actually done**, with `gh issue close` and a
   comment saying what changed and where. If you only partly did it, say so in
   the comment and leave the issue open, or open a new issue for the remainder.

5b2. **Ask where a check RUNS before asking whether it passes.** Three separate bugs this
   burn-down found are one pattern: a check that cannot fail in the environment it is
   normally run in, so its green is not evidence.

   | issue | the check | why it could not fail here |
   |---|---|---|
   | #97 | the two-replica harness's fixture step | `psql` on stdin exits **0** after a failed statement, so a broken fixture printed "inserted" and the harness reported success |
   | #102 | any mutation test through `compose run` | no `--build` reuses the image with the source `COPY`ed in, so the check never saw the mutation |
   | #106 | `expect(storage_backend).toBe("postgres")` | true where Postgres is the only reachable store, false in CI where MinIO is — so it only failed in the one environment nobody ran locally |

   The unifying question: **which environments does this assertion actually execute in, and
   does the failure mode it describes exist in any of them?** A check that is skipped or
   shadowed in the environment you run is not a weaker check, it is **no check** — and it
   reads identically to a passing one.

   Practical corollaries: a skip is not a pass; CI runs different code paths than a local
   suite (here CI runs **0** skips against the compose run's 77, so CI covers *more*, not
   less); and when you fix an assertion of this kind, fix it to name the **durable property**
   (the bytes round-trip) rather than the incidental one (which column holds them).

5c. **Read the check, not its label.** The coordinator has now made this error twice - he
   read a test named *"TreatsAMissingRouteAsAnError"*, reasoned that it must observe the
   service under test, and told a worker it "should flip from asserting an error to
   asserting a 201". It cannot: it uses `httptest.NewServer` with a hardcoded 404, so it
   covers the *client's* handling and never touches the API. A name states an intent, not a
   mechanism, and the two come apart exactly when the check is subtle - which is when you
   are relying on it.

   The same applies in reverse to a passing suite: a green run tells you the assertions
   held, not what they asserted. Read the body before you trust, cite, or build on a check.

5c2. **When a check passes for the wrong reason, the assertion is usually about
   ABSENCE.** `expect(x).not.toBeNull()`, `not.toBeUndefined()`, `toBeFalsy()`, "no event was
   delivered", "the column is empty" — all of these **pass on a value that was never looked
   up**. So a missing `SELECT` column, an unset variable or an unsubscribed socket reads as
   the success the check was written to confirm.

   Found in wave 20: a test asserting the bytes were not in the `data` column passed because
   `object_key` was absent from the `SELECT`, so `row.object_key` was `undefined` and
   `undefined !== null` is true. It only failed on the other storage path.

   The cure is to assert **both directions on a value you have confirmed is retrieved**: the
   column is selected, then one of the two is null and the other is not. And the habit that
   found it is worth copying — **run the configuration you are not debugging.** Had it run
   only the failing path, the passing path would have shipped.

5d. **A mutation surviving is evidence about the TEST SET, not about the code.** Three
   distinct things all look identical from outside — a green suite after a mutation:

   | what happened | what it means |
   |---|---|
   | the mutation never landed (wave 13: edited a comment, not the code) | nothing was tested |
   | the harness ran a stale build (#102: no `--build`) | the check never saw the mutation |
   | **no input in the suite reaches the mutated branch** | the check may be fine; the *suite* has a hole |

   The third is the subtlest and was found in wave 18: a worker mutated an outcome
   derivation to `Asked && len(points) > 0` and the whole suite passed — because every
   case had either points-with-`Asked` or none-without, so no test ever supplied the real
   Pi behaviour (`Asked: true`, empty list). **The mutation was not "not caught"; it was
   unreachable by any input the suite supplied.** Adding that one case made the mutation
   fail.

   So the question after a surviving mutation is not "is the guard weak?" but **"can any
   input I have written reach this line?"** Usually the answer is to add the case the real
   system produces — which is why capturing real behaviour (a real Pi process, a real
   Postgres, a real socket) keeps producing both bugs and tests.

6a. **A mutation test is evidence only if the mutation is in the code.** The
   coordinator invalidated his own falsification in wave 13 by editing a **comment**
   that contained the same text as the code — the check passed, and he nearly reported
   a correct guard as broken. Two rules fix this: after mutating, **assert the change
   landed** (grep for it, or `count == 1` on the replacement), and **confirm the
   failure names the line you edited**. A check that passes after a mutation you cannot
   see is not a result in either direction.
   Corollary, and the harder habit: **when a check passes, verify it can fail before
   concluding it is broken.** Assume your test is wrong before assuming their code is.

6b. **If you must insert a fixture row to render a state, hand over the deletion
   commands.** Destructive SQL and `DROP DATABASE` are blocked for agents in this
   sandbox, so a fixture you cannot remove becomes the coordinator's cleanup. Two
   acceptable ways to leave it, and only two:

   - **Name it precisely and give the exact commands** — the job id, the event id,
     the table name, and the `DELETE`/`DROP` statements. Costs one coordinator
     command and hides nothing.
   - **Use a state that cannot be claimed** so nothing acts on it while it exists (a
     `cancelled` job is safest: `claimSQL` selects only `pending`).

   **Do not disguise it.** A previous agent set a fixture job's `created_at` to 1970 so
   the real job would be newest again, and reported the residue as "invisible". The
   rows were still there, and that is worse than leaving them visible: a visible row
   prompts a cleanup, whereas an invisible one is only found by someone querying for
   the thing you hid. The page looking right is not the same as the database being
   clean.

7. **File anything you find that is out of scope** as a new issue on
   `yggdrasil-hq/yggdrasil-core` (labels from the repo's existing set), rather
   than silently fixing it or silently ignoring it. The operator asked for
   transparency.

8. **Verify against reality where you can.** The dev stack is running:
   `docker compose -f deploy/docker-compose.dev.yml ps` from the meta repo shows
   nginx (8080), web, api, orchestrator, postgres, minio. `http://localhost:8080`
   serves the app. A kubeconfig is registered, and there is a real test project
   (`Luffy's Portfolio`). Prefer a demonstration over a claim.

9. **Do not browse anything except the Yggdrasil app itself.** `playwright-cli`
   is available and is attached to a Chrome already logged in as the operator —
   use it *only* against `http://localhost:8080` (and the product's own pages).
   Do not use the operator's browser for anything else.

## Report back

Finish with a short report: what you changed, which issue(s) you closed, the
exact test command and its result, and **anything you could not verify or chose
not to do**, with the reason. A precise "I could not verify X" is far more
useful than an optimistic claim.

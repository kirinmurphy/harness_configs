---
name: integration-check
description: >
  Use ONLY when the user explicitly asks to run an integration check on a named integration
  branch — via `/integration-check <branch>` or a clear instruction like "run the integration
  check on integration/foo", "integrate and review branch X". Brings an integration branch to a
  verified, reviewed state: checks it out in the main working tree, syncs it from its remote and
  from the base branch, audits worktrees for unmerged work, validates in-flight plan documents
  against the code, reviews every commit not in the base branch, and runs the repository's own
  test suite. Reports findings; does not fix them. Do NOT use for ordinary code review of a
  working diff (use a code-review skill), for merging a single feature branch, for plan-document
  lifecycle work on its own (use plan-docs), or automatically because a branch looks like an
  integration branch. This workflow mutates git state and must be user-invoked.
---

# Integration Check

Brings an integration branch to a verified, reviewed state, then reports what it found.

## Invocation

```text
/integration-check <INTEGRATION_BRANCH>          # base branch defaults to main
/integration-check <INTEGRATION_BRANCH> --base <BASE_BRANCH>
```

If no branch is supplied, offer the current branch and ask — do not start on it silently. Running
this against the wrong branch does real git work in the wrong place, so the current checkout is a
suggestion to confirm, never a default to assume:

```text
Do you want to run **/integration-check** on [CURRENT BRANCH NAME]?
> 1) Yes
  2) Type something (the desired branch)
```

Wait for an answer. A reply naming a different branch replaces the suggestion.

## Shape of the workflow

Steps 1–6 can write: they change what is checked out and, at step 5, can create a merge commit.
Steps 7–13 only read. That split is deliberate — anything that alters the repository happens in the
first half, so the review half can be repeated freely.

The workflow is **convergent** rather than strictly idempotent, and the distinction matters when
reasoning about a re-run:

- Steps 1, 6, and 7 are idempotent by construction — they only read.
- Steps 2, 3, and 4 converge: checkout and fast-forward reach the same state from any starting
  point.
- Step 5 is the only step that can write. Its guard makes it a no-op when the branch is already
  current, so it merges at most once per genuine base change.

The guarantee that follows is narrow and worth stating exactly: **a first run may legitimately
create one merge commit; every subsequent run against an unchanged repository creates none.** Run
one is supposed to do work, so "no effect on repetition" only holds from run two onward.

A base branch that gains commits between runs is not a repetition — merging again there is correct
behavior, not a violation.

Within the read-only half, the cheap deterministic work comes first: scope the diff (7), then run
the tests (8). Only once the suite is green does the model-driven work begin (9–11). Ordering it
this way means a red suite or an out-of-scope branch is caught before any expensive analysis is
spent on code that is about to change.

**Step 8 is a synchronous barrier.** The suite may run in the background, but steps 9, 10, and 11
must not begin until it has reported. Starting plan validation or code review while tests are still
running defeats the reason the suite moved ahead of them: if it comes back red, that analysis was
spent on code that is about to change. Everything before step 8 may overlap freely; nothing after
it may start early.

Several steps are **gates** — stop and ask rather than deciding for the user. They are marked
below. A gate is not a formality: proceeding past one on an assumption is how this workflow
destroys work.

## Repository-agnostic by construction

Nothing here may hardcode a project's branch names, directory layout, or commands. Discover them:

- Base branch: the `--base` argument, else the remote's default branch
  (`git symbolic-ref refs/remotes/origin/HEAD`), else `main`, else `master`. Say which you used.
- Test command: read `package.json` scripts, `Makefile`, `justfile`, `taskfile`, `pyproject.toml`,
  or CI config. Never invent one. If none is discoverable, say so and skip step 8.
- Plan docs: discover, do not assume. If the repository declares its plan lifecycle in a manifest
  (this repo's convention is `manifests/platform/plan-lifecycle.json`), read the in-flight states
  from it — the states whose work is underway or being validated, not just one folder name.
  Otherwise fall back to `docs/plans/active/`, then to any equivalent (an ADR directory, a decision
  log, `docs/rfcs/`). If nothing exists, skip steps 9–10 and say so.

## Step 1 — Preflight

Verify the working tree is clean (`git status --porcelain`, including untracked). **Gate:** if
anything is uncommitted, stop and report it. Do not stash, commit, or discard on the user's behalf.

A file the user has already acknowledged — their own in-progress work, named earlier in the
session — is not a reason to halt a second time. Note it as a known exception and continue. Never
commit or modify it to clear the gate: an untracked file that appears mid-session belongs to the
user, and folding it into an unrelated commit is worse than leaving the tree dirty. State plainly
in the report that the workflow proceeded past a dirty tree, and why.

Record the starting branch and HEAD SHA so the user can get back. Report both.

## Step 2 — Locate the branch

Resolve the supplied branch. If it does not exist locally but does on the remote, track it.

**Gate — worktree conflict.** If the branch is checked out in a linked worktree, git will refuse
the checkout. Offer, and let the user choose:

1. Run the workflow in that worktree instead.
2. Move the branch to the main working tree (requires removing that worktree registration).
3. Abort.

Before proposing removal, inspect that worktree for uncommitted files (`status --porcelain -uall`),
unpushed commits, and its own stashes. Report exactly what would be lost. **Never remove a worktree
without showing the user its state first** — a worktree that looks abandoned can hold real edits.

Terminology, for clear reporting: the root checkout is the **main working tree**; the others are
**linked worktrees**.

## Step 3 — Checkout in the main working tree

`git fetch --all --prune`, then check the branch out in the main working tree. Confirm afterward
that HEAD is where you expect.

## Step 4 — Sync from the branch's own remote

Fast-forward from `origin/<branch>` if behind. **Gate:** if the branch has diverged (both ahead and
behind), stop and report — do not rebase, force, or merge to resolve it. That is the user's call.

## Step 5 — Merge the base branch into the integration branch

Only if the integration branch is behind the base. This is a real code change, not a sync.

Check first (`git rev-list --left-right --count <base>...HEAD`) and merge only when the behind
count is non-zero. This is the only step in the workflow that writes — an unguarded merge would
create a commit on every run — so the check is what keeps a repeat run a no-op.

Nothing enforces this but the instruction. Skipping the check and merging unconditionally still
"works" on a branch that is behind, and only shows up as an empty merge commit on the runs where
the branch was already current. Run the check.

**Gate on conflict:** report the conflicted paths and stop. Do not resolve conflicts.

If already current, say so and move on. Never merge in the other direction — this workflow never
writes to the base branch.

## Step 6 — Worktree audit

List every worktree and, for each branch, decide whether its work is already in the integration
branch. **Use a two-tier test.**

```text
git merge-base --is-ancestor <branch> HEAD
   exit 0  -> MERGED. Done, no further checking.
   exit 1  -> INCONCLUSIVE, not "unmerged" -> fall through to the content check
```

Ancestry can only ever *prove* merged; it cannot disprove. A squash-merge collapses many commits
into one new commit with a new SHA and a new patch-id, so ancestry — and `git cherry`, which
compares patch-ids — both report "unmerged" even when every line landed. Reporting that as
unmerged work is a false alarm that leads users toward re-merging work they already have.

For inconclusive branches, compare content:

- `git diff --stat <integration>..<branch>` — a branch that is merely behind shows mostly
  deletions relative to the integration branch.
- Check whether the artifacts the branch introduced exist in the integration branch, and whether
  the integration branch's copies are the same or newer.

**Gate:** for every branch that still looks genuinely unmerged after the content check, confirm
with the user individually before continuing. Present the evidence, not just a verdict.

Do not delete branches or worktrees in this workflow. Cleanup is a separate, destructive action.

If the user asks for cleanup afterwards, establish these before deleting anything:

- Every file the branch introduced either exists in the integration branch, or was removed there by
  an identifiable commit. A file missing from HEAD is not proof of loss — refactors delete files on
  purpose — but it must be explained, not assumed.
- The branch's SHA matches its `origin/` counterpart, so the remote still holds every commit.

Report that evidence per branch, delete local refs only, and leave remotes alone. Squash-merged
branches need `git branch -D`; `-d` refuses them because ancestry does not show the merge. That
forced flag is exactly why the evidence has to be gathered first — the usual safety net is absent.

## Step 7 — Scope the diff

```text
git log --oneline <base>..HEAD
git diff --stat <base>...HEAD
```

This commit list and file set define the review scope for every later step. Report the counts.
If the diff is very large, say so before reviewing rather than silently truncating.

## Step 8 — Regressions

Run the repository's own test command, discovered as described above. If it is slow, start it in
the background — then **wait for it**. Report `Verified: <command> -> pass|fail`.

This step is a synchronous barrier: steps 9–11 do not begin until the suite has reported. Use the
wait to finish anything that does not depend on the result (re-reading the diff, listing candidate
plan files), but do not start validating plans or reviewing code.

**This runs before any review work, deliberately.** Steps 9–11 are the expensive, model-driven part
of this workflow, and a red suite invalidates them twice over: fixing the failure changes the code
that was just reviewed, so the review has to be redone against code that now exists. Running tests
after the review puts the gate *after* the cost it exists to prevent.

**Gate:** on failure, report the failing output and stop. Do not review, and do not write a findings
report — a findings document written over a red suite misrepresents the branch's state.

The one exception: if the failure is clearly pre-existing and unrelated to the diff (it also fails
on the base branch), say so and ask whether to proceed. Do not decide that on your own — a failure
that looks unrelated often is not.

## Step 9 — Select relevant plans

Read the in-flight plan docs, discovered as described above. Match each against the files touched
in step 7 and carry forward only the relevant ones — an unrelated plan is not this integration's
problem.

Note that "in-flight" may span several folders. A repository with a richer lifecycle can have work
underway in one state and work being validated in another; both are relevant to an integration
branch, and reading only the first would miss exactly the plans this workflow exists to check.

While reading, flag lifecycle inconsistencies without fixing them:

- An active plan with an empty `next_action`.
- A plan whose items are all complete but which still sits in active.
- A plan that was moved back to active but kept completed-state frontmatter.

These need the user's intent to resolve. Report; do not invent a `next_action`.

A plan can also be *legitimately* missing a `next_action`: one moved back from completed
prematurely has no next step, and gets moved to completed again without inventing one. The
frontmatter alone cannot distinguish that from a genuine omission, so ask rather than assume —
and once the user rules, record it per the acknowledged-findings note in step 13.

Before flagging an item as open, check whether the plan marks it deliberately deferred. A checklist
item can be unchecked *and* resolved-by-decision, with the reasoning written next to it; reporting
that as outstanding work is a false finding.

## Step 10 — Validate the plans against the code

For each selected plan, check its claims against the actual code — not against its checkboxes:

- Are checked items really implemented?
- Are unchecked items really still open? Some quietly land.
- Are there requirements the code does not satisfy at all?

Prose-bulleted plans have no checkbox state to trust; read the code regardless.

Do the same for any other durable documentation the diff touches (reference docs, architecture
notes). Report statements the merged code contradicts.

This step's output **scopes step 11** — knowing what the plans require makes the code review
sharper. That is why it comes first.

## Step 11 — Review the code in a single pass

Load the project's own convention skills if present (for example `code-style`, a language skill
matching the stack, and a test-harness skill). Match the codebase's actual idiom, not a generic
style.

Read each changed file **once**, applying this whole checklist as you go:

| Lens | Look for |
| --- | --- |
| Requirements | Gaps against step 10; implementations with no requirement; unhandled edge cases the plans name |
| Conventions | Naming, file organization, helper placement, exports/imports, type safety at boundaries |
| Comments | Comments describing superseded behavior — after a merge these are common and actively misleading |
| Correctness | Logic errors, unhandled failure modes, state that can go stale |
| Performance | Redundant work per render or per poll, repeated queries, anything quadratic over a collection |
| Comprehensibility | Functions doing too much, non-obvious control flow, too much context required to read |
| File size | Files that have outgrown their cohesion — split on cohesion, never on line count alone |
| Config extraction | Hardcoded values belonging in a config or manifest file: timeouts, thresholds, limits, magic numbers |

**Do this as one pass, not several.** The lenses are not independent — you notice that a function
does too much, queries the DOM three times, and holds a magic number in a single reading of it.
Splitting into separate passes re-reads every file (multiplying token cost by the number of passes)
and produces findings that interact: a proposed file split changes which config extraction makes
sense, so separately-derived recommendations then have to be reconciled anyway.

## Step 12 — Findings report

Report only. **Fix nothing in this pass.**

Rank by severity — blocking, should-fix, nice-to-have — and give every finding a `file:line` and a
concrete proposed change. A finding without a location is not actionable.

Call out explicitly anything that could not be verified in this environment — most commonly UI work
with no browser available. Never let unverified read as passed.

Then ask the user what to act on.

## Step 13 — Persist the baseline

Write the findings to a session-scoped file (a scratch directory is fine; do not add it to the
repository unless asked), keyed by `file:line` plus a short stable id per finding.

**"Review again"** later in the session means: re-run steps 7–13 against the current state and
report

- which previous findings are now resolved,
- which remain open,
- which are newly introduced since the baseline.

Keep the record updated on each run so this stays answerable without re-deriving it. Treat the
first run as the baseline.

**Record the user's ruling on each finding, and do not re-litigate it.** When the user accepts a
finding as a known pending item, decides it needs no action, or defers it, store that verdict in
the baseline alongside the finding. On a re-run, list those as acknowledged in one line each —
never re-argued as fresh findings. Re-report an acknowledged item only when its underlying state
actually changes.

This matters because most findings survive a re-run untouched: plan paperwork, deferred UI
verification, accepted trade-offs. Without a ledger, every re-run re-derives and re-presents the
same resolved arguments, and the genuinely new finding is buried in noise.

**Scope the re-review to what changed.** Report the delta since the previous baseline's HEAD, not
just the full diff against the base. When only a handful of commits are new, reviewing the whole
branch again re-derives conclusions already reached — say what the delta is and review that,
noting the rest as unchanged since the baseline.

## Never

- Never commit, push, or open a PR from this workflow. It reports.
- Never delete branches, worktrees, or stashes.
- Never resolve merge conflicts on the user's behalf.
- Never write to the base branch.
- Never proceed past a gate on an assumption. Proceeding on the user's explicit prior
  acknowledgement is not an assumption — say so in the report when you do.
- Never claim visual or manual verification that did not happen. A green suite is not visual
  verification: UI code can pass every test and still render wrong. Report it as unverified, and
  keep reporting it on every re-run until someone actually looks.
- Never fold the user's unrelated uncommitted work into a commit of your own.

# Integration Check Walkthrough

## Purpose

`/integration-check` brings an integration branch to a verified, reviewed state and reports what it
found. It syncs the branch, looks for work that has not made it in yet, checks planning documents
against the actual code, reviews the diff, and runs the repository's tests.

It reports. It does not fix, commit, push, or delete.

## Invocation

```text
/integration-check <INTEGRATION_BRANCH>          # base branch defaults to main
/integration-check <INTEGRATION_BRANCH> --base <BASE_BRANCH>
```

If no branch is given it offers the current one and waits for you to confirm, rather than assuming
it:

```text
Do you want to run **/integration-check** on [CURRENT BRANCH NAME]?
> 1) Yes
  2) Type something (the desired branch)
```

## The Steps

| #  | Step | Plain terms | Timing |
| -- | --- | --- | --- |
| 1  | Preflight | Check nothing is unsaved. Record where you started so you can get back. | — |
| 2  | Locate branch | Find the `integration/XXXX` branch. If another workspace has it open, ask — don't force it. | — |
| 3  | Checkout | Fetch latest, switch to the branch. | — |
| 4  | Sync from own remote | Catch up to the server copy. If both sides changed, stop and ask. | — |
| 5  | Merge base in | Pull main into the branch if behind. Conflicts = stop, don't guess. | — |
| 6  | Worktree audit | Find side branches holding work not yet absorbed here. Squash-merges hide this, so check contents, not just history. | — |
| 7  | Scope diff | List every commit and file that differs from main. That's the review scope. | may overlap |
| 8  | Tests | Run the repo's own suite. Red suite = stop before reviewing anything. | **synchronous barrier** |
| 9  | Select plans | Find planning docs in `docs/plans/active` matching those files. Flag paperwork inconsistencies.<br>**Note:** Plan lifecycle updates will change this to `docs/plans/integration`. | waits for 8 |
| 10 | Validate plans | Check plans against real code — did what they claim shipped actually ship? | waits for 8 |
| 11 | Review code | Read each changed file once, checking correctness, conventions, stale comments, performance, size, hardcoded values. | waits for 8 |
| 12 | Report | Rank findings by severity, each with a location and a fix. Fix nothing. | — |
| 13 | Save baseline | Record findings so a later re-run can say what's fixed, still open, or newly broken. | — |

**On the timing column.** The test suite may run in the background, but steps 9–11 do not start
until it reports. Those three are the expensive, judgment-heavy part of the workflow; if the suite
comes back red the code is about to change, and any analysis done in the meantime was spent on a
version that will not survive. Work before step 8 can overlap freely.

## Shape Of The Workflow

Steps 1–6 can write — they change what is checked out and, at step 5, can create a merge commit.
Steps 7–13 only read.

Re-running is safe. Most of the writing half is idempotent: preflight, locating the branch,
checkout, and a fast-forward all land in the same place when repeated. Step 5 is the one exception,
since merging creates a commit — so it is guarded by "only if behind" and does nothing when the
branch is already current. On an unchanged repository, a second run produces no new commits.

Inside the read-only half, cheap deterministic work runs before expensive model-driven work: scope
the diff, then run the tests, and only start reviewing once the suite is green. A red suite means
the code is about to change, so reviewing it first would be analysis thrown away.

## Gates

At these points the workflow stops and asks rather than deciding for you:

| Gate | Why it stops |
| --- | --- |
| Unsaved files | Committing or discarding your work is not its call |
| Branch open elsewhere | Removing a worktree can destroy uncommitted edits |
| Diverged branch | Rebasing or force-pushing is your decision |
| Merge conflicts | Resolution needs intent it doesn't have |
| Apparently unmerged work | Re-merging already-merged work causes damage |
| Failing tests | A findings report over a red suite misrepresents the branch |

## Re-Running

Running the check again reports the delta: which findings are resolved, which are still open, and
which are new since the last run.

Findings you have ruled on — accepted as pending, deferred, or decided against — are recorded and
listed as acknowledged in one line, not re-argued each time. They come back as findings only if the
underlying state actually changes.

## Never

- Never commits, pushes, or opens PRs
- Never deletes branches, worktrees, or stashes
- Never resolves merge conflicts for you
- Never writes to the base branch
- Never claims visual verification that did not happen — a green test suite is not a look at the UI

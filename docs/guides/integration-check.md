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

If no branch is given it asks, rather than guessing from the current checkout.

## The Steps

| #  | Step | Plain terms |
| -- | --- | --- |
| 1  | Preflight | Check nothing is unsaved. Record where you started so you can get back. |
| 2  | Locate branch | Find the `integration/XXXX` branch. If another workspace has it open, ask — don't force it. |
| 3  | Checkout | Fetch latest, switch to the branch. |
| 4  | Sync from own remote | Catch up to the server copy. If both sides changed, stop and ask. |
| 5  | Merge base in | Pull main into the branch if behind. Conflicts = stop, don't guess. |
| 6  | Worktree audit | Find side branches holding work not yet absorbed here. Squash-merges hide this, so check contents, not just history. |
| 7  | Scope diff | List every commit and file that differs from main. That's the review scope. |
| 8  | Tests | Run the repo's own suite. Red suite = stop before reviewing anything. |
| 9  | Select plans | Find planning docs in `docs/plans/active` matching those files. Flag paperwork inconsistencies.<br>**Note:** Plan lifecycle updates will change this to `docs/plans/integration`. |
| 10 | Validate plans | Check plans against real code — did what they claim shipped actually ship? |
| 11 | Review code | Read each changed file once, checking correctness, conventions, stale comments, performance, size, hardcoded values. |
| 12 | Report | Rank findings by severity, each with a location and a fix. Fix nothing. |
| 13 | Save baseline | Record findings so a later re-run can say what's fixed, still open, or newly broken. |

## Shape Of The Workflow

Steps 1–6 change git state. Steps 7–13 are read-only. Failures land in the first half; the review
half is always safe to re-run.

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

---
name: plan-start
description: Use when beginning implementation from an existing prepared repository plan. Inspect the current plan and repository, create or safely reuse an isolated worktree, implement every in-scope unblocked objective, make clear or reversible decisions autonomously, continue around blockers, verify the work, synchronize the plan, and report the result. Do not use for initial plan preparation, lifecycle orchestration, portal actions, integration-branch closeout, or implementation without an existing plan.
---

# Plan Start

Begin development from one existing prepared implementation plan.

The goal is to execute the plan through all in-scope, unblocked objectives while minimizing unnecessary interruptions and preserving a clear record of decisions, verification, blockers, and execution context.

## Inputs

Resolve:

- the repository root;
- the selected plan document;
- repository instructions;
- relevant installed code-style and language skills;
- current Git state;
- existing branches and worktrees;
- Plan Docs worktree configuration when available.

The existing plan is the implementation contract. Verify it against the current repository before relying on it.

## Preflight

1. Read the entire selected plan.
2. Inspect the current repository state and material plan claims.
3. Detect whether the plan has become stale or materially incomplete.
4. Read `docs/plans/plans-config.json` when present. If it declares a `worktreeRoot` (a path,
   relative to the repository root unless absolute), that is the configured worktree policy; resolve
   new worktrees under it. If the key is absent, propose a default (a sibling directory next to the
   repository root is a reasonable one) and state the exact resolved path to the user before running
   `git worktree add` — do not silently pick a location the first time a repository has no configured
   root.
5. Resolve the worktree policy.
6. Inspect existing worktrees before creating another one.
7. Reuse a worktree only when it clearly matches the repository and intended branch and is safe to continue.
8. Refuse to reuse a dirty, ambiguous, unrelated, or conflicting worktree.
9. Create an isolated feature worktree when a safe matching workspace does not exist.
10. Use platform path APIs and repository configuration rather than hardcoding `~/.worktrees`.
11. Keep absolute worktree paths out of repository plan documents.
12. Record:
    - worktree path;
    - branch;
    - base branch;
    - starting commit.

When deterministic RoboRepo commands exist for an operation, use them instead of reconstructing the mutation manually.

## Implementation Workflow

1. Reconcile any minor stale details that are obvious and safe to fix.
2. Identify the plan's in-scope objectives, acceptance criteria, dependencies, and blockers.
3. Build a working task sequence from the existing plan.
4. Implement one coherent slice at a time.
5. Run the smallest useful verification after each slice.
6. Continue until every in-scope, unblocked objective has been addressed.
7. Keep the plan synchronized with:
   - material decisions;
   - scope corrections;
   - blockers;
   - completed work;
   - verification results.
8. Do not silently omit objectives.
9. Do not expand into unrelated cleanup.
10. Perform a final comparison between:
    - the plan;
    - the implementation diff;
    - runtime behavior;
    - acceptance criteria.
11. Run completion-level verification.
12. Report the final state.

## Decision Policy

When ambiguity appears:

1. Identify realistic options.
2. Evaluate:
   - correctness;
   - explicit plan requirements;
   - repository architecture and conventions;
   - installed code-style guidance;
   - clarity;
   - maintainability;
   - DRYness;
   - testability;
   - reversibility;
   - operational risk.
3. Prefer:
   - explicit plan requirements;
   - then repository conventions;
   - then installed skill guidance;
   - then general industry convention.
4. Proceed autonomously when:
   - one option is clearly preferable;
   - one option has a strong practical advantage;
   - the decision is inexpensive to reverse;
   - the decision does not materially change the user-facing contract.
5. Record material decisions and reasoning.
6. Ask the user only when:
   - the decision is destructive or difficult to reverse;
   - it materially changes product scope or behavior;
   - it changes a public API or persistent schema;
   - it affects security, privacy, permissions, migration, or compatibility;
   - it pushes, merges, publishes, spends money, or affects an external system;
   - no responsible option has a clear advantage.

Do not stop for minor implementation details.

## Blocker Policy

A blocker should stop only the work it actually blocks.

When blocked:

1. Record the affected objective and evidence.
2. Identify dependent and independent tasks.
3. Mark the affected work blocked in the plan when appropriate.
4. Continue independent implementation and verification.
5. Re-evaluate the blocker after related changes.
6. Report it clearly at the end.

Do not declare the entire feature complete while a required objective remains blocked.

## Completion Conditions

Implementation is complete when:

- every in-scope, unblocked objective has been implemented;
- acceptance criteria have been evaluated;
- targeted verification has passed or failures are explained;
- required broader verification has been run when practical;
- material decisions are recorded;
- blockers and deferred scope are explicit;
- the plan reflects implementation reality.

Completion does not authorize:

- unrelated refactoring;
- infinite retries around external blockers;
- guessing through consequential product decisions;
- pushing, merging, publishing, or deleting worktrees without explicit permission or repository policy.

## Final Report

Report:

```text
Implementation result
- Plan: <id and repository-relative path>
- Worktree: <runtime path>
- Branch: <branch>
- Base branch: <branch>
- Starting commit: <commit>
- Objectives completed: <count>
- Objectives blocked: <count>
- Material decisions: <count>
- Verification passed: yes/no/partial
- Implementation complete: yes/no
```

Also include:

- files changed;
- meaningful implementation decisions and reasoning;
- tests and checks run;
- manual verification;
- unresolved blockers;
- deferred scope;
- current Git status;
- whether anything was committed, pushed, merged, or published.

## Boundaries

Do not:

- create a second implementation plan;
- repeat a full planning interview unless the plan is materially stale or incomplete;
- change lifecycle state;
- own portal behavior;
- create integration branches;
- perform closeout or merge orchestration;
- launch unrelated workflows;
- hide failed verification or partial completion.

---
id: plan-lifecycle-suite-workflow-navigation
priority: high
next_action: Implement the canonical lifecycle manifest and migrate domain lifecycle discovery and validation profiles to consume it.
blocked_by: []
depends_on:
  - plan-lifecycle-controls-and-filter-aware-toast
  - plan-lifecycle-readiness-validation-and-repair-prompts
related:
  - plan-docs-and-plans-portal
  - plan-unclassified-plan-recovery
  - plan-lifecycle-suite-blockers-dependencies
  - integration-check-determinism
reviewed_commit: ee9c5b875943e58ffad8298c2942d3f5b7ff893f
---

# Plan Lifecycle Suite 04 — Workflow and Navigation Expansion

## Summary

Expand Plan Docs from its current four-folder lifecycle into a manifest-driven workflow:

```text
Icebox → Backlog → Ready → Active → Integration → Review → Complete
```

Archived remains a lifecycle off-ramp stored under `docs/plans/archived/`. Unclassified remains a recovery classification for misplaced files and is never a destination. Blocked remains an orthogonal condition owned by the companion blocker-management plan.

The lifecycle manifest becomes the source of truth for state identity, folder, display order, navigation placement, validation profile, responsibility, action availability, and transition presentation. The Plans portal also gains a responsive workflow visualization that explains lifecycle, execution artifacts, responsibility, blockers, archiving, and the single integration lane.

## Context

The current implementation supports Backlog, Active, Completed, Archived, and Unclassified. Lifecycle controls, guarded file movement, stale-state conflict handling, and readiness findings already exist. The missing layer is an explicit operating workflow that distinguishes:

- planning work waiting for human review;
- approved work available for agent pickup;
- implementation underway in a feature worktree;
- work merged into an integration candidate;
- stable work awaiting human review and merge;
- completed work whose merge has been verified.

The workflow also needs to coordinate future agent sessions and worktrees without embedding machine-specific paths in plan documents.

## Goals

- Add Icebox, Ready, Integration, and Review as first-class lifecycle states.
- Rename the product label `Completed` to **Complete** while retaining `completed/` as the canonical folder.
- Keep Archived as a folder-derived lifecycle destination outside the successful delivery path.
- Keep Unclassified as recovery-only.
- Define one manifest-backed action model for portal, CLI, API, and Plan Docs skills.
- Distinguish who initiates an action from which executor performs it.
- Support Start, Wrap Up, Submit for Review, and Confirm Merge workflow contracts.
- Allow many Ready and Active plans while permitting only one open integration flow per repository in the first iteration.
- Use ephemeral integration branches as integration-cohort identity.
- Leave the merge from integration to `main` to the human in this iteration.
- Store only portable execution identifiers in plan frontmatter.
- Compute machine-local worktree paths with cross-platform path utilities.
- Add a clear lifecycle infographic to the Plans portal.

## Non-goals

- Do not implement arbitrary bespoke behavior solely through manifest data.
- Do not make Blocked a lifecycle folder.
- Do not make Unclassified a normal destination.
- Do not commit absolute worktree paths to plan documents.
- Do not automatically merge the integration branch into `main`.
- Do not support parallel integration flows in the first iteration.
- Do not add deployment environments or release management.
- Do not require React or TypeScript.
- Do not duplicate the full blocker-management feature owned by Suite 05.

## Current State

### Existing foundation

The completed lifecycle-control plan already owns:

- folder-derived lifecycle;
- lifecycle and priority mutations;
- stable ID resolution after file movement;
- repository-boundary and destination-collision checks;
- stale browser-state detection;
- rebuilt plan records after mutation;
- shared plan-status rendering;
- transition dialogs and passive outcomes.

The readiness plan already owns:

- lifecycle destination profiles;
- normalized findings;
- repair prompts;
- fresh disk validation before movement.

### Current gaps

- Backlog conflates rough planning with approved work.
- Active does not prove a feature branch, worktree, or implementation session exists.
- Completed conflates integrated work, human acceptance, and terminal completion.
- The portal cannot explain the full workflow or responsibility handoffs.
- Start and Wrap Up are agent prompts rather than deterministic orchestration contracts.
- Worktree and integration metadata have no portable runtime model.
- The existing wrap-up skill is chat-oriented and not yet backed by a harness-neutral closeout controller.

## Proposed Design

### Canonical lifecycle

| ID | Folder | Label | Waiting on | Meaning |
|---|---|---|---|---|
| `icebox` | `docs/plans/icebox/` | Icebox | Human or agent | Intentionally idle; not yet submitted for active planning |
| `backlog` | `docs/plans/backlog/` | Backlog | Human | Plan is being reviewed and prepared |
| `ready` | `docs/plans/ready/` | Ready | Agent or scheduler | Approved and eligible for implementation pickup |
| `active` | `docs/plans/active/` | Active | Agent | Feature implementation is underway |
| `integration` | `docs/plans/integration/` | Integration | Agent/system | Feature branch has joined the open integration candidate |
| `review` | `docs/plans/review/` | Review | Human | Integration candidate is sealed for smoke testing and merge |
| `completed` | `docs/plans/completed/` | Complete | None | Human merge is verified and resources are finalized |
| `archived` | `docs/plans/archived/` | Archived | None | Abandoned, superseded, obsolete, or retained as history |
| `unclassified` | `docs/plans/*.md` | Unclassified | Human | Recovery classification; never a destination |

### Archive behavior

Archived is a lifecycle destination because lifecycle is physically represented by folders.

When archiving, preserve historical context:

```yaml
archived_from: active
archived_reason: abandoned
archive_note: Replaced by plan-example-v2
```

Restore defaults to `archived_from` after current destination validation. If the stored state is no longer valid, offer Backlog as the safe fallback.

Archiving Active, Integration, or Review work is guarded because Git branches, worktrees, or sessions may still exist. Archive does not silently discard execution state.

### Blocked overlay

Blocked is not a lifecycle state. The lifecycle manifest exposes action policy such as:

```json
{
  "id": "start",
  "requiresUnblocked": true
}
```

Suite 05 owns blocker storage, mutation, relationship validation, and UI management. This plan owns only the generic action-policy hook and visual treatment.

### Navigation

Primary tabs:

```text
Backlog | Ready | Active | Integration | Review | Complete | ⋯
```

Overflow:

```text
Icebox
Unclassified
Archived
```

Selecting an overflow item renders a temporary selected tab before the overflow trigger. URL state remains authoritative across refresh and browser navigation.

### State actions

| Current state | Primary action | Destination | Initiator | Executor |
|---|---|---|---|---|
| Icebox | Submit for Planning | Backlog | Human or agent | Lifecycle mutation |
| Backlog | Mark Ready | Ready | Human | Lifecycle mutation |
| Ready | Start | Active | Human or scheduler | Agent-start workflow |
| Active | Wrap Up | Integration | Agent | Closeout/integration workflow |
| Integration | Submit for Review | Review | Human or agent | Integration validation workflow |
| Review | Confirm Merge | Complete | Human | Verification and cleanup workflow |
| Complete | Archive | Archived | Human | Archive workflow |
| Any canonical state | Archive | Archived | Human | State-aware archive workflow |

Use separate fields for responsibility:

```json
{
  "initiators": ["human", "scheduler"],
  "executor": "agent-start-workflow",
  "waitingOn": "agent"
}
```

Do not use a single ambiguous trigger type.

### Start workflow

Start operates on Ready plans:

1. Re-read the plan and current repository state.
2. Confirm Ready lifecycle and no blocking condition.
3. Check explicit dependencies and likely overlap with Active or Ready work.
4. Fetch and synchronize the configured base branch.
5. Confirm the canonical control checkout is clean and on the expected base branch.
6. Create a feature branch.
7. Create a feature worktree under the configured worktree root.
8. Record portable execution identifiers.
9. Move the plan to Active.
10. Commit lifecycle metadata through the control checkout.
11. Launch or attach the selected harness session.

`Start Eligible` replaces “Start All.” It evaluates Ready plans, builds a conflict graph, respects concurrency limits, and starts only the conflict-safe subset.

### Cross-platform worktrees

Use platform APIs rather than literal path concatenation:

```js
path.join(os.homedir(), ".worktrees")
```

The worktree root is configurable. Runtime behavior must account for macOS, Linux, and Windows path separators, drive letters, spaces, case sensitivity, symlinks, and different home directories.

Portable frontmatter:

```yaml
execution:
  worktree_id: wt-plan-123
  feature_branch: feature/plan-123
```

The current parser does not support nested YAML, so the implementation may initially use flat keys:

```yaml
worktree_id: wt-plan-123
feature_branch: feature/plan-123
```

Machine-local registry:

```json
{
  "worktreeId": "wt-plan-123",
  "repositoryId": "git:github.com/kirinmurphy/roborepo",
  "absolutePath": "/Users/example/.worktrees/roborepo/plan-123",
  "platform": "darwin",
  "hostId": "host-abc"
}
```

Reconcile the registry against `git worktree list --porcelain`; never treat the registry as sole authority.

### Integration model

Use ephemeral integration branches and permit only one open integration flow per repository in the first iteration.

Example:

```text
integration/2026-08-03-a
```

The branch itself identifies the integration cohort. Plans in Integration or Review record that branch.

Branch lifecycle:

```text
Accepting → Validating → Review → Merged → Cleaned Up
```

#### Accepting

When Active work wraps up:

- use the one accepting integration branch when it exists;
- create one from current `main` when none exists;
- stop with a repair error if multiple accepting branches are discovered.

Plans are assigned during Wrap Up, not Start.

#### Validating

After each feature branch joins:

- run combined validation;
- review requirements for every included plan;
- rerun affected integration checks;
- keep the branch open for additional compatible completed work.

The first three are what the `integration-check` skill already does today, manually invoked as
`/integration-check <branch>`: it syncs the branch, audits worktrees for unmerged work, validates
`docs/plans/active/` claims against the code, reviews every commit not in the base branch, and runs
the repository's test suite. This plan's Validating phase should call that workflow rather than
respecify it. See "Relationship to `/integration-check`" below.

#### Review

Submit for Review seals the integration branch. No additional feature branch may join it. Plans that finish while Review is open remain Active with an `awaiting-integration` execution condition.

#### Human merge and completion

The human merges the integration branch into `main`.

Confirm Merge:

1. Fetch current `main`.
2. Verify the reviewed integration result is represented in `main`.
3. Move all included plans to Complete.
4. Delete feature worktrees and feature branches.
5. Delete the integration worktree and integration branch.
6. Close or detach associated sessions.
7. Clear machine-local runtime records.

Prefer an ancestry-preserving merge in the first iteration so verification can use `git merge-base --is-ancestor`.

**Verification must not rely on ancestry alone.** `git merge-base --is-ancestor` — and `git cherry`,
which compares patch-ids — answer *identity*, not *content*. A squash merge collapses many commits
into one new commit with a new SHA and a new patch-id, so both report "not merged" even when every
line landed. Confirm Merge deletes worktrees and branches, so a false negative here destroys the
working copies of work that is safely in `main`.

Use a two-tier test:

```text
git merge-base --is-ancestor <branch> main
   exit 0  -> merged (proof; stop here)
   exit 1  -> INCONCLUSIVE, not "unmerged" -> compare content before concluding anything
```

Preferring ancestry-preserving merges reduces how often the fallback runs; it does not remove the
need for it, because the merge strategy is the human's choice at merge time and cannot be enforced
from here. `/integration-check` implements this test — see
[[plan-integration-check-determinism]], which specifies extracting it into a tested command whose
fixtures must cover the squash case.

### Relationship to `/integration-check`

The `integration-check` package ships a manually-invoked skill that performs the validation work
this plan's Integration and Review states need. It exists now and is repository-agnostic; this plan
should adopt it rather than build a parallel implementation.

| Concern | `/integration-check` today | This plan | Reconciliation |
|---|---|---|---|
| Branch identity | Long-lived branch, name supplied by the user | Ephemeral `integration/<date>-<seq>`, created at Wrap Up, deleted at Confirm Merge | The skill takes the branch as an argument, so it works with either. No change needed to the skill; this plan supplies the name |
| How work joins the branch | Out of scope — reviews whatever is present | Assigned during Wrap Up by the closeout controller | Complementary; no overlap |
| Base-branch sync | Merges base into the integration branch when behind | Branch is cut from current `main`, so it starts current | Keep the skill's step: an ephemeral branch still drifts once it is open for a while |
| Merged-status test | Two-tier ancestry-then-content | Was ancestry-only; corrected above | Now aligned |
| Plan validation | Reads `docs/plans/active/` | Plans in Integration move to `docs/plans/integration/` | **Requires a change** — see below |
| Invocation | Human types `/integration-check` | Agent/system triggers on state entry | The skill stays manual; this plan's controller may call the same underlying commands |

**The lifecycle change breaks the skill's plan discovery.** Today `/integration-check` reads
`docs/plans/active/` because that is where in-flight work lives. Once this plan lands, a plan that
has joined the integration branch moves to `docs/plans/integration/`, and Review work moves again to
`docs/plans/review/` — so the plans most relevant to an integration branch would be the ones the
skill no longer looks at.

Resolve this by having the skill read lifecycle states from
`manifests/platform/plan-lifecycle.json` (Phase 1 of this plan) rather than naming a folder. The
states relevant to an integration branch are those whose work is underway or being validated —
currently `active`, and after this plan `active`, `integration`, and `review`. The skill's own
prose already anticipates a repository whose plan layout differs, so this is a generalization of
existing behavior rather than a new concept.

Sequencing: this plan's Phase 1 must land the manifest before the skill can consume it. Until then
the skill's folder-based discovery stays correct, because the folders it names are the ones that
exist.

### Wrap Up and closeout controller

Keep the generic Wrap Up skill separate because it also serves ad hoc, documentation-only, and non-plan sessions.

For an Active plan, both `/wrap-up` and `/plan-docs wrap-up` delegate deterministic work to a RoboRepo closeout controller.

The controller owns:

- repository and plan resolution;
- locks;
- Git status and explicit-path staging;
- commit and integration operations;
- lifecycle movement;
- structured recovery after partial failure.

The harness task owns reasoning-heavy work:

- review scoped session changes;
- apply safe cleanup fixes;
- synchronize affected documentation;
- run required validation;
- classify stray or unrelated work;
- return structured evidence.

Claude and Codex providers translate the same harness-neutral task contract and return the same result schema. A Markdown skill calling another skill is not the orchestration mechanism.

### Existing Wrap Up requirements

The plan-associated closeout must preserve the current Wrap Up sequence:

1. Review files actually changed in the session.
2. Apply safe cleanup fixes.
3. Synchronize affected project documentation.
4. Run required validation.
5. Stage explicit paths only.
6. Audit stray, unrelated, staged, and untracked work.
7. Commit the intended candidate set.
8. Report status and handoff context when appropriate.

The lifecycle handler adds integration work after successful closeout; it does not replace these steps with a shorter checklist.

### Lifecycle manifest

Add:

```text
manifests/platform/plan-lifecycle.json
```

It declares:

- IDs, folders, and labels;
- navigation placement and ordering;
- validation profile;
- priority visibility;
- waiting responsibility;
- primary and ancillary actions;
- initiators and executor;
- unblocked requirements;
- standard outcome presentation.

Compile it in a filesystem-free module and publish a safe projection in the Plans snapshot. A generic test-only state proves that ordinary lifecycle extensions require manifest changes only.

### Workflow visualization

Add a first-class responsive Lifecycle Overview to the Plans portal.

It must visualize:

1. **Lifecycle lane** — Icebox through Complete, with Archive as an off-ramp.
2. **Execution-artifact lane** — no execution, feature branch/worktree/session, integration branch, human merge, cleanup.
3. **Responsibility lane** — human, agent, scheduler, system.
4. **Condition overlays** — Blocked and awaiting-integration.
5. **Concurrency** — many Ready/Active plans feeding one integration lane.

Use semantic HTML and CSS with SVG connectors where needed. On narrow screens, render a vertical timeline. Include concise explanations, state counts, primary action, required artifacts, and advancement blockers.

## Affected Touchpoints

- `manifests/platform/plan-lifecycle.json`
- `modules/plan-docs/index.mjs`
- `modules/plan-docs/lifecycle-policy.mjs`
- new lifecycle manifest loader/compiler
- `scripts/cli/plans.mjs`
- `scripts/cli/portal-routes-plans.mjs`
- `portal/plans/state.js`
- `portal/plans/templates.js`
- `portal/plans/app.js`
- `portal/plans/elements/plan-status.js`
- `portal/plans/elements/plan-card.js`
- `portal/plans/lifecycle-event-dialog.js`
- shared overflow-tabs/menu/popover components
- Plan Docs skill workflow references
- Wrap Up skill integration contract
- plan domain and portal tests

## Implementation Plan

### Phase 1: Manifest and domain model

- [ ] Add the canonical manifest and schema validation.
- [ ] Compile immutable state/action lookups.
- [ ] Add all lifecycle folders and labels.
- [ ] Preserve `completed/` while displaying Complete.
- [ ] Publish the public lifecycle model in snapshots.
- [ ] Add generic manifest-extension fixtures.

### Phase 2: Validation profiles and migration

- [ ] Map every state to a destination validation profile.
- [ ] Update readiness findings and repair prompts.
- [ ] Add archive history fields and restore policy.
- [ ] Migrate existing plans and tests safely.
- [ ] Keep Unclassified recovery-only.

### Phase 3: Portal navigation and actions

- [ ] Add primary and overflow navigation.
- [ ] Replace lifecycle dropdown behavior with manifest-backed actions.
- [ ] Preserve card/drawer parity.
- [ ] Add responsibility and disabled-reason presentation.
- [ ] Add Start Eligible queue action.

### Phase 4: Execution registry and Start contract

- [ ] Add portable execution identifiers.
- [ ] Add cross-platform worktree-root configuration.
- [ ] Add machine-local runtime registry and reconciliation.
- [ ] Define overlap and conflict graph rules.
- [ ] Integrate harness-provider session launching.
- [ ] Add partial-failure recovery.

### Phase 5: Closeout and integration

- [ ] Implement the harness-neutral closeout controller.
- [ ] Preserve all current Wrap Up steps.
- [ ] Add ephemeral integration branch creation and locking.
- [ ] Enforce one open integration flow per repository.
- [ ] Add combined validation and Review sealing. Call the `integration-check` workflow for the
      Validating phase rather than respecifying branch sync, worktree audit, plan validation, and
      diff review.
- [ ] Add human-merge verification and cleanup. Confirm Merge must use the two-tier merged test,
      not ancestry alone — it deletes branches and worktrees, so a false negative destroys the only
      working copy of work that is already in `main`.
- [ ] Migrate `/integration-check` plan discovery from the hardcoded `docs/plans/active/` to the
      lifecycle manifest, so it picks up `integration` and `review` states once they exist.

### Phase 6: Visualization and documentation

- [ ] Add the portal lifecycle infographic.
- [ ] Add Mermaid state and sequence diagrams to reference docs.
- [ ] Update Plan Docs and Wrap Up skill references.
- [ ] Document macOS, Linux, and Windows behavior.
- [ ] Document repair procedures for interrupted workflows.

### Phase 7: Verification

- [ ] Extend domain lifecycle tests.
- [ ] Extend readiness/finding tests.
- [ ] Extend portal state tests.
- [ ] Add worktree and branch fixtures.
- [ ] Add harness-provider contract tests.
- [ ] Add browser smoke tests.
- [ ] Run the full suite and package dry run.

## Validation

Targeted:

```bash
npm run test:plans
npm run test:plans-findings
npm run test:plans-portal-state
```

Add focused checks for lifecycle manifests, worktrees, integration branches, and closeout orchestration.

Before completion:

```bash
npm test
npm run pack:dry-run
git diff --check
```

Manual scenarios:

1. Move Icebox to Backlog and Backlog to Ready.
2. Start one Ready plan on macOS, Linux, and Windows path fixtures.
3. Exclude a blocked Ready plan from Start Eligible.
4. Wrap up two Active plans into one accepting integration branch.
5. Seal the branch and prevent later work from joining.
6. Human-merge the branch and confirm completion cleanup.
7. Archive and restore plans from multiple lifecycle states.
8. Recover an Unclassified plan.
9. Refresh and navigate all primary and overflow tabs.
10. Verify the lifecycle infographic on desktop and narrow screens.

## Acceptance Criteria

- Lifecycle is folder-derived and manifest-driven.
- The final successful path is Icebox → Backlog → Ready → Active → Integration → Review → Complete.
- Archived is a guarded lifecycle off-ramp.
- Unclassified is recovery-only.
- Blocked remains an orthogonal condition.
- Start creates a feature branch, worktree, runtime record, and agent session before Active is considered valid.
- Worktree metadata is portable across macOS, Linux, and Windows.
- Plans join an ephemeral integration branch during Wrap Up.
- Only one integration flow may be open per repository.
- Review seals the integration candidate.
- The human merges to `main`.
- Confirm Merge verifies the result and cleans up resources.
- Current Wrap Up review, documentation, validation, explicit staging, commit, and handoff behavior is preserved.
- Claude and Codex use one harness-neutral closeout contract.
- The portal includes an informative responsive workflow visualization.
- Tests prove manifest-only extension for ordinary new states.

## Risks

### Integration review can block later completed work

A sealed Review branch temporarily prevents new feature branches from joining. Keep implementation work concurrent, surface `awaiting-integration`, and defer parallel integration lanes until there is evidence they are necessary.

### Worktree operations differ by host

Use Node path APIs, argument-array process spawning, canonical repository identity, and runtime reconciliation. Never persist absolute paths in repository plans.

### Agent instructions are not deterministic orchestration

Put Git mutation, locking, state transitions, and recovery in RoboRepo controllers. Use harness skills only as entry points and reasoning tasks.

### Scope can become too broad

Keep manifest/navigation, agent startup, and closeout/integration as explicit phases with bounded contracts. Future implementation may split phases into separate plan documents without changing this suite's dependency graph.

## Open Questions

- Should integration branches use a date sequence, plan slug, or opaque generated ID?
- Should Confirm Merge support squash merges in the first release or require ancestry-preserving merges?
- When should waiting Active plans be automatically integrated after Review closes?
- Should archived Active work offer Pause, Cancel, or Preserve Worktree options?
- Should the primary control checkout later be replaced by a managed control worktree?

---
id: docs-plan-filename-normalization
priority: high
next_action: Decide whether to extend the convention to `docs/plans/completed/`, where 19 files still carry a `-plan` suffix or a `roborepo-` prefix. Backlog is done; renaming completed plans is currently a non-goal.
blocked_by: []
depends_on: []
related:
  - skills-vs-commands-invocation-policy
reviewed_commit: 6c94691
---

# Normalize Plan Filenames Against the Namespace Convention

## Summary

`docs/plans/plans-config.json` declares this repository's plan namespaces, and the `plan-docs`
skill owns the filename rules. Most existing plans predate both. This plan records the gap and
renames them in reviewable batches.

Renaming is deliberately not automated: a filename is a link target, and plans reference each other
in prose as well as in `related` and `depends_on` frontmatter.

## Context

An audit of `docs/plans/backlog/` found 30 plans, of which 19 deviated from the convention. Four
more plans landed after that audit, bringing the backlog to 34 and the rename set to 21. Three
recurring patterns:

- **Redundant `-plan` suffix** (6 files). Everything under `docs/plans` is a plan.
- **Status encoded in the filename** (`-todo`, `-followups`). Status belongs in frontmatter;
  filenames get linked to and should not change when status does.
- **No namespace, or a namespace that misdescribes the work.** The clearest case is the three
  `plan-terminal-session-launching-milestone-*` files: the `plan-` prefix means the plan-docs
  system, but these are about agent session launching.

## Goals

- Every plan filename starts with a namespace from the universal set or `plans-config.json`.
- No filename carries a `-plan` suffix or encodes status.
- Frontmatter `id` values are unchanged by any rename, so inbound references keep resolving.
- No duplicate `id` values remain.
- A repository with no `plans-config.json` gets one, derived from its own code and existing plans
  rather than copied from elsewhere.

## Bootstrapping a repository with no config

This repository already has `docs/plans/plans-config.json`. Most will not, and the convention is
useless without one — the universal namespaces alone cannot describe a project's domains.

When a rename or a new-plan request runs against a repository with no config, do not silently fall
back to universal namespaces or invent prefixes. Instead:

1. **Say the config is missing** and that namespaces are about to be guessed rather than read.
2. **Propose an initial vocabulary from evidence**, not from a template. Good sources, in order of
   signal strength:
   - top-level source directories (`modules/`, `portal/`, `packages/`) — these usually *are* the
     domains;
   - CLI namespaces or command groups the project already exposes;
   - recurring prefixes across existing plan filenames, which show the vocabulary the team has
     already been reaching for;
   - directory names under the docs tree.
3. **Show the evidence for each proposed namespace** — "`portal` because `portal/` has five
   surfaces and six plans already start with it" — so the user can judge rather than accept.
4. **Ask the user to refine before writing.** Namespaces are a controlled vocabulary; one chosen
   badly gets copied into every future filename. Expect to merge overlapping proposals, drop ones
   that are really a single plan, and rename to the project's own words.
5. **Write only the agreed set**, keeping the config to values (`schemaVersion` + `namespaces`).
   Rules live in the `plan-docs` skill, not in per-repository config.

Only then proceed to renames. Renaming against a guessed vocabulary produces a second cleanup pass.

## Non-goals

- Renaming plans outside `docs/plans/backlog/`. Active and completed plans can follow once the
  convention is proven here.
- Changing plan content beyond the H1 when it merely restates a filename.
- Automating the renames.

## Current state

### Resolved: duplicate id

`portal-homepage-plus-repository-scope-filtering.md` was a byte-identical, untracked copy of
`portal-homepage-repository-section.md`, sharing the id `portal-repository-scope-and-homepage`. It
was a leftover from a rename rather than a second plan, and has been deleted. No duplicate ids
remain across `docs/plans/`.

### Rename candidates

| Current | Proposed | Reason |
| --- | --- | --- |
| `harness-presence-signal-expansion-plan` | `harness-presence-signal-expansion` | redundant suffix |
| `portal-homepage-implementation-plan` | `portal-homepage-implementation` | redundant suffix |
| `portal-lit-native-scaled-plan` | `portal-lit-native-scaled` | redundant suffix |
| `roborepo-packaging-distribution-plan` | `infra-packaging-distribution` | redundant suffix; `roborepo-` restates the repository |
| `windows-provider-path-schema-plan` | `os-windows-provider-path-schema` | redundant suffix; OS-specific work |
| `wrap-up-coderabbit-integration-plan` | `agent-config-wrap-up-coderabbit` | redundant suffix; wrap-up is harness config |
| `harness-parity-todo` | `harness-parity` | `-todo` encodes status |
| `native-skill-tooling-followups` | `agent-config-native-skill-tooling` | `-followups` encodes status |
| `codex-cmux-hook-trust-review` | `agent-config-codex-cmux-hook-trust` | hook trust is harness config |
| `skill-reference-docs-and-conventions` | `agent-config-skill-reference-docs` | skill authoring is harness config |
| `skills-vs-commands-invocation-policy` | `agent-config-skills-vs-commands-policy` | skill/command policy is harness config |
| `plans-portal-live-refresh-and-static-preflight` | `portal-plans-live-refresh` | portal surface work |
| `web-portal-browser-tab-reuse` | `portal-browser-tab-reuse` | `web-portal` is the `portal` namespace |
| `usage-statusline-claude-refresh` | `usage-statusline-claude-refresh` | already conforms — `usage-statusline` is a project namespace |
| `usage-statusline-codex-hook-parity` | `usage-statusline-codex-parity` | `-hook-` is incidental; the namespace is already correct |
| `user-managed-packages-and-add-workflows` | `package-user-managed-and-add-workflows` | package system work |
| `plan-terminal-session-launching-milestone-1` | `session-launching-milestone-1` | `plan-` means the plan system; this is session launching |
| `plan-terminal-session-launching-milestone-2` | `session-launching-milestone-2` | see milestone-1 |
| `plan-terminal-session-launching-milestone-3` | `session-launching-milestone-3` | see milestone-1 |

### Added after the audit

Four plans landed after the audit table was written. `harness-capability-derived-resource-targeting`
already conformed. The other three were folded into the declared vocabulary rather than growing
`plans-config.json` with `antigravity`, `manifest`, and `permissions` prefixes:

| Current | Proposed | Reason |
| --- | --- | --- |
| `antigravity-cli-provider-integration` | `harness-antigravity-cli-integration` | provider integration is harness work |
| `manifest-tsv-provider-consolidation` | `harness-manifest-tsv-consolidation` | provider manifests are harness work |
| `permissions-ui-revamp` | `agent-config-permissions-ui-revamp` | permissions are harness config |

### Already conforming

`git-exec-consolidation`, `package-cli-test-guide`, `package-registry-live-state-reconciliation`,
`localhoster-metadata-suggestions`, `localhoster-remote-branch-status`,
`portal-homepage-repository-section`, `telemetry-analyze-single-pass-perf`,
`plan-integration-check-determinism`, and the three `plan-lifecycle-suite-*` files.

## Implementation plan

- [x] Resolve the duplicate-id conflict.
- [x] Add the missing-config bootstrap flow to the `plan-docs` skill. Already satisfied: the
      "When no project config exists" section of
      `globals/packages/plan-docs/skills/plan-docs/references/plan-schema.md` implements the
      propose-and-refine sequence, including evidence sourcing and the ask-before-writing step.
      No skill edit was needed.
- [x] Rename the six redundant-suffix files. Lowest risk: the namespace does not change.
- [x] Rename the status-encoding files (`-todo`, `-followups`).
- [x] Rename the files whose namespace changes, which is where inbound references are most likely
      to break.
- [x] Rename the three post-audit plans into the declared vocabulary.
- [x] After each batch, grep for the old basename across `docs/` and fix prose references.
      Confirmed: frontmatter `related`/`depends_on` use `id`, so none needed editing. Code comments
      did — `scripts/cli/harness.mjs`, `scripts/test/harness-cli-check.mjs`,
      `scripts/test/usage-statusline-check.mjs`, and
      `globals/packages/usage-statusline/README.md` all carried plan paths.
- [x] Update any H1 that merely restates its filename.

## Decisions made during execution

- **Historical references left intact.** `docs/plans/completed/primary-todo.md` names
  `harness-parity-todo.md` and `skills-vs-commands-invocation-policy.md` at lines 351, 381, and 382.
  That is a completed plan describing repository state as it was, not a live link, so rewriting it
  would falsify the record. Left deliberately; not a missed reference.
- **Two dangling id references fixed.** `completed/discoverable-harness-provider-architecture-plan.md`
  and `backlog/portal-homepage-repository-section.md` both listed
  `plan-terminal-session-launching-milestone-1` under `related`, but no plan has ever carried that
  id — the real one is `plan-session-launching-milestone-1`. Pre-existing breakage, unrelated to
  renaming, corrected here and called out in its commit.
- **Ids intentionally diverge from filenames.** Several files now carry an `id` that no longer
  matches their name (`portal-lit-native-scaled.md` has `id: portal-lit-native-scaled-plan`). This
  is the rule working as designed: ids are durable identifiers, and regenerating them would break
  every inbound `related` and `depends_on`.

## Validation

- [x] `git mv` for every rename, so history follows the file. All 21 showed as `R` in `git status`.
- [x] No `id` value changes: `git diff` over each batch showed no changed `id:` line. The only
      frontmatter edits were the two dangling-reference fixes above.
- [x] No duplicate ids remain across `docs/plans/`.
- [x] `npm run test:plans`, `npm run test:plans-findings`, and `npm run test:plans-portal-state` pass.
- [x] Grep the repository for each old basename; remaining hits are only `id:` values, frontmatter
      ids, this plan's own rename tables, and the intentional `primary-todo.md` history.
- [x] Every backlog filename starts with a namespace from `plans-config.json` or the universal set.

## Risks

- **Broken inbound links.** Prose references filenames; frontmatter references ids. Only the former
  breaks on rename, and only a grep will find them.
- **Renaming plans another session has open.** A rename mid-session leaves the other context
  pointing at a path that no longer exists. Prefer a quiet moment.
- **Churn for its own sake.** Several already-conforming names differ only stylistically. Leave
  those alone; the goal is a working vocabulary, not uniformity.

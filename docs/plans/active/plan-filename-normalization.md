---
id: docs-plan-filename-normalization
priority: high
next_action: Rename the six redundant `-plan` suffix files first (lowest risk — the namespace does not change), then grep docs/ for the old basenames and fix prose references before moving to the namespace-changing batches.
blocked_by: []
depends_on: []
related:
  - skills-vs-commands-invocation-policy
reviewed_commit:
---

# Normalize Plan Filenames Against the Namespace Convention

## Summary

`docs/plans/plans-config.json` declares this repository's plan namespaces, and the `plan-docs`
skill owns the filename rules. Most existing plans predate both. This plan records the gap and
renames them in reviewable batches.

Renaming is deliberately not automated: a filename is a link target, and plans reference each other
in prose as well as in `related` and `depends_on` frontmatter.

## Context

An audit of `docs/plans/backlog/` found 30 plans, of which 19 deviate from the convention. Three
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

### Already conforming

`git-exec-consolidation`, `package-cli-test-guide`, `package-registry-live-state-reconciliation`,
`localhoster-metadata-suggestions`, `localhoster-remote-branch-status`,
`portal-homepage-repository-section`, `telemetry-analyze-single-pass-perf`,
`plan-integration-check-determinism`, and the three `plan-lifecycle-suite-*` files.

## Implementation plan

- [x] Resolve the duplicate-id conflict.
- [ ] Add the missing-config bootstrap flow to the `plan-docs` skill, so the propose-and-refine
      sequence above runs on any repository without a `plans-config.json` — not just this one.
- [ ] Rename the six redundant-suffix files. Lowest risk: the namespace does not change.
- [ ] Rename the status-encoding files (`-todo`, `-followups`).
- [ ] Rename the files whose namespace changes, which is where inbound references are most likely
      to break.
- [ ] After each batch, grep for the old basename across `docs/` and fix prose references.
      Frontmatter `related`/`depends_on` use `id`, not filename, so those should need no edits —
      verify rather than assume.
- [ ] Update any H1 that merely restates its filename.

## Validation

- [ ] `git mv` for every rename, so history follows the file.
- [ ] No `id` value changes: diff frontmatter before and after each batch.
- [ ] No duplicate ids remain across `docs/plans/`.
- [ ] `npm run test:plans` and `npm run test:plans-findings` pass.
- [ ] Grep the repository for each old basename; zero hits outside git history.

## Risks

- **Broken inbound links.** Prose references filenames; frontmatter references ids. Only the former
  breaks on rename, and only a grep will find them.
- **Renaming plans another session has open.** A rename mid-session leaves the other context
  pointing at a path that no longer exists. Prefer a quiet moment.
- **Churn for its own sake.** Several already-conforming names differ only stylistically. Leave
  those alone; the goal is a working vocabulary, not uniformity.

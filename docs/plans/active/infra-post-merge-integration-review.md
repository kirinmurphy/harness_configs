---
id: 48krno27
priority: high
next_action: Second pass fixed a publish blocker (placeholder home shipped into every live config) plus three other defects; commit the working tree, then carry the renderPermissionsTo data-loss finding to the permissions branch.
blocked_by: []
depends_on: []
related:
  - ia1q1z9
  - permissions-ui-revamp
reviewed_commit: 875b6e5a7cf5c1608c10e57974d18b447591bdc3
---

# Post-Merge Integration Review Before Package Publication

## Summary

Main contains two broad merged workstreams that need verification before an npm package cut:
the permissions and package reorganization merge, plus the install lifecycle hardening merge.
The goal is to decide whether current main is safe to publish from, or to identify concrete
regressions that must be fixed first.

This plan is a temporary active coordination record for the integration review. It preserves
the review scope, hard constraints, known failures, and validation commands so the work can
continue across session compaction or handoff.

## Context

The review starts from the local main history around these commits:

| Commit | Meaning |
| --- | --- |
| `fa51221` | Rollback point before the merged work |
| `183cc8d` | Permissions and package reorganization merge |
| `9711668` | Main merged into the install lifecycle branch |
| `1d4cb64` | Integration fixes from the install lifecycle merge |
| `45e31cf` | Local plan synchronization already on main |
| `83c18ce` | Post-merge fix: generated permissions are deterministic under fake/package homes |
| `fae604c` | Post-merge fix: `/agents` shows live-detected harnesses when persisted state is stale |

The permissions work touched permission taxonomy, package catalog organization, retention
stores, capture-dense-bash state, usage statusline thresholds, and shared rules. The install
lifecycle work hardened uninstall ownership, collision policy, stale-path repair, shell PATH
cleanup, initialization state compatibility, package-mode lifecycle smoke coverage, dry-run
purity, and managed uninstall harness confidence.

## Goals

- Verify the merge landed intact on main and did not drop or mangle the six install lifecycle
  fixes or the permissions workstreams.
- Fix confirmed regressions directly on main, with explicit-path commits and no push.
- Run the automated test surface without using broad `npm run test:*` sweeps that exceed the
  command timeout.
- Fix the known `cli-surface-integration-check.mjs` generated-permissions fixture leak and add
  a guard so tracked generated permission files cannot be rewritten by a fake `$HOME`.
- Review permission data flow consumers, especially `repo-scope` handling.
- Browser-smoke `/config` and the Uninstall panel without executing a real uninstall.
- Verify the usage-statusline threshold change only applies the new yellow warning level and
  revised thresholds to context percentage; weekly and monthly spend rates should keep their
  previous thresholds unless a separate decision changes them.
- Reconcile active and directly advanced backlog plans with what now exists on main.
- Report whether main is safe to publish from.

## Non-goals

- Do not push, merge, or force-push.
- Do not run `roborepo update`; it installs to live machine config.
- Do not execute a real uninstall against the user's actual state.
- Do not audit unrelated work outside the two merged workstreams except where integration
  behavior requires it.

## Current State

- `node` has been corrected for this session by disabling the stale `/usr/local/bin/node`
  v16 binary; `node` now resolves to the NVM v22 installation.
- `jcodemunch` is available through the deferred MCP tool surface and resolves this repo as
  `kirinmurphy/roborepo`.
- A browser-control connector is not currently exposed. Browser smoke will require either an
  exposed browser connector or an approved local Playwright install/run. Browser-equivalent portal
  API smoke was completed through `roborepo web`; no real uninstall was executed. A follow-up
  `/api/config` smoke after `fae604c` confirmed the page reports Claude, Codex, and Gemini as
  machine harnesses on this machine.

Known failures or gaps that must not be misreported as merge regressions:

- `scripts/test/usage-statusline-check.mjs` is known pre-existing renderer/test format drift.
- `scripts/test/cli-surface-integration-check.mjs` has a known load-sensitive remote-sync flake;
  rerun it in isolation before calling a failure a regression. It passed in isolation at
  `83c18ce`.
- Linux and Windows lifecycle validation remain gaps unless separately exercised.

## Implementation Plan

- [x] Confirm `jcodemunch` availability and resolve the repo.
- [x] Remove the stale Node v16 resolver from the active path.
- [x] Keep the review on main so confirmed fixes land on the branch being validated.
- [x] Commit fixes on main with explicit paths only; do not push.
- [x] Confirm no unrelated dirty files before clean-worktree-sensitive package smoke.
- [x] Confirm main contains the merged branch commits and inspect the install lifecycle conflict
  resolution in `docs/plans/active/infra-packaging-02-install-lifecycle.md`.
- [x] Run the automated suites with Node >=20, including dry-run purity, managed uninstall, and
  package install smoke through `npm run test:package-install`.
- [x] Run individual `scripts/test/*.mjs` files not already covered, classifying any failures
  as merge regressions, known flakes, or pre-existing failures with evidence from `fa51221`
  where needed.
- [x] Fix the `cli-surface-integration-check.mjs` tracked generated-permissions leak and add a
  `generated/` clean-diff guard.
- [x] Review and exercise the permission data flow from `manifests/inventory/agent-permissions.json`
  through CLI, portal, harness renderers, generated artifacts, and the Claude repo-write-scope
  hook.
- [x] Review shared-state integration for `scripts/cli/state-paths.mjs`, managed uninstall
  classification, `modules/retention/*`, localhoster, telemetry spool, package catalog labels,
  capture-dense-bash, usage statusline, and shared rules changes.
- [x] Check usage-statusline severity thresholds and fix any merge damage where context
  percentage thresholds were accidentally applied to weekly or monthly spend rates.
- [x] Browser-smoke `/config` and the Uninstall panel, recording console/network errors and a
  walkthrough artifact if browser automation is available. Browser automation was unavailable;
  `/config`, `/api/config`, and uninstall preview were smoked through the local portal.
- [x] Update stale active and backlog plan docs, including `reviewed_commit` where verified.
- [x] Produce the final report with verification commands, regressions, reviewed surfaces, plan
  updates, and work not completed.

## Review Outcome

Current main is publishable from the reviewed commit, with two documented gaps: Linux and Windows
lifecycle validation were not run, and no real browser automation was available. The portal was
started through `roborepo web`, `/config` HTML and `/api/config` loaded successfully, and the
uninstall preview confirmed workspace-preserving behavior without executing cleanup.

> Superseded on the point of publishability. A second pass found a publish blocker this section
> missed — see "Second Review Pass" below. It is fixed; the rest of this section still stands.

The only confirmed regression found during this pass was generated Claude permissions depending on
the process `$HOME`, which made fake-home and package-installed doctor checks drift from the
tracked generated fixture. Commit `83c18ce` fixes that by giving generated permission renders a
stable placeholder home while preserving live render behavior through the explicit render options.
The CLI surface test now guards the generated permission files against fake-home rewrites.

A second issue was found from the live `/agents` page: persisted harness state could be stale
`absent`, causing the page to show "No agent harnesses detected" even when bounded live discovery
could see provider evidence. Commit `fae604c` fixes the config snapshot by combining persisted
state with live discovery for display only, while preserving explicit user-disabled state.

`scripts/test/usage-statusline-check.mjs` still fails on the known pre-existing text-format drift:
the test expects `Context: 70% used`, while the renderer emits `Context: 70%`. The domain-level
usage test passed, and the threshold separation fix is already committed in `45228e4` and
`256dbc5`.

Follow-up test hardening after the full suite exposed stale fixture assumptions: command-package
scaffolds and test fixtures now use the current `skills-dev-lifecycle` package category instead of
the removed `commands` category, hook-composition coverage passes again, package reconcile asserts
the current jcodemunch hooks, config context-cost assertions distinguish package sections from
non-package state sections, and lifecycle tests point Claude hook fixtures at
`globals/harnesses/claude/hooks`.

## Second Review Pass

An independent re-run of this document's scope found four defects the first pass missed, all now
fixed on main, plus one open issue that is not this plan's to close.

The first pass's publish verdict was wrong on one point. `83c18ce` gave the generated permission
render a fixed placeholder home (`/Users/you`) to stop fake-`HOME` test runs rewriting the tracked
file. That artifact is also `rootConfigBaseline`, which install merges into the user's live config,
and Claude's merge unions permission arrays — so every new install wrote a rule naming a directory
that does not exist on that machine, permanently, while the user's real projects tree got no
baseline allow. That was a publish blocker.

Fixed by dropping foreign-home rules in `mergeClaudeSettings`, applied to the merge RESULT rather
than inside the union branch: a fresh home has no `permissions` of its own and skips that branch
entirely, which is exactly the first-install case. The live render already self-healed, since it
replaces `permissions` wholesale.

The other three:

- **Uninstall left `~/.claude/hooks` behind.** `5ffc38f` added a manifest row (`hooks/provider`)
  nesting inside an existing row's target (`hooks`), so `diff -r` saw roborepo's own second install
  as user modification and refused to reclaim the parent. The same mismatch also made a plain
  re-install non-idempotent: it routed an already-current path to the collision prompt, which
  aborts non-interactively. Both comparators now ignore nested manifest targets, and the two
  near-duplicate directory comparators were collapsed onto one helper so a fix cannot again land in
  one and miss the other.
- **Dead package category.** `ac35c97` removed the `commands` category but left a consumer in
  `scripts/cli/config.mjs` comparing against it, so the branch was permanently false and every
  command-backed package silently lost its `/command` label. The condition now keys on the package
  actually exposing a command.
- **`Write(path)` permission rules are inert.** Claude matches path-scoped rules under `Edit(path)`,
  which covers every file-editing tool; a `Write(path)` rule does nothing and is reported at session
  start. `write-scope` now renders `Edit` only. The `write-files` gate still names both tools,
  because turning writing off has to shut off both.

Coverage added so these classes cannot recur silently: a `doctor --installed` check that live
permission paths resolve to this machine's home; a `package-catalog-check` assertion that no source
file branches on a category id the manifest does not define; and `test-install-collisions.sh` added
to the documented test matrix, which is why the uninstall defect survived the first pass at all.

### Open, not fixed here

`renderPermissionsTo` replaces `settings.permissions` wholesale, so any allow/deny entry not derived
from `manifests/inventory/agent-permissions.json` — MCP tool grants, personal denies — is destroyed
on every `roborepo apply`/`update`. This was observed directly: healing a live config dropped eleven
`mcp__jcodemunch`/`mcp__jdocmunch` grants and one personal deny. It is independent of the merge
defect above and belongs with the in-flight permissions work.

Also still open and deliberately left: `roborepo init`, `library`, and `uninstall` are unclassified
in the permission manifest. Nothing breaks — unclassified namespaces prompt, the safe default — but
the bucket decision is owed on the permissions branch.

## Validation

The final review must include a fenced verification block with one line per command and clear
pass/fail status. Required validation includes:

- `roborepo doctor --installed`
- direct Node test invocations for the `scripts/test/*.mjs` surface, without broad `npm run test:*`
  sweeps
- `node scripts/test/dry-run-purity-check.mjs`
- `node scripts/test/managed-uninstall-check.mjs`
- `npm run test:package-install`
- browser or browser-equivalent smoke for `/config` and the Uninstall panel, if tooling permits

## Risks

- The full suite can exceed a 600 second command timeout if run in one foreground command.
- Starting detached `roborepo web` inside a test can strand processes; portal smoke must start
  the server under direct control and stop it explicitly.
- Package smoke asserts a clean worktree.
- Browser automation may require installing Playwright or exposing a browser connector.
- Permission review can miss consumers if only tests are trusted; code paths and rendered
  artifacts need targeted review.

---
id: 48krno27
priority: high
next_action: Create a review worktree from current main, then verify the merged permissions and install lifecycle work without running destructive uninstall actions.
blocked_by: []
depends_on: []
related:
  - ia1q1z9
  - permissions-ui-revamp
reviewed_commit:
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

The permissions work touched permission taxonomy, package catalog organization, retention
stores, capture-dense-bash state, usage statusline thresholds, and shared rules. The install
lifecycle work hardened uninstall ownership, collision policy, stale-path repair, shell PATH
cleanup, initialization state compatibility, package-mode lifecycle smoke coverage, dry-run
purity, and managed uninstall harness confidence.

## Goals

- Verify the merge landed intact on main and did not drop or mangle the six install lifecycle
  fixes or the permissions workstreams.
- Run the automated test surface without using broad `npm run test:*` sweeps that exceed the
  command timeout.
- Fix the known `cli-surface-integration-check.mjs` generated-permissions fixture leak and add
  a guard so tracked generated permission files cannot be rewritten by a fake `$HOME`.
- Review permission data flow consumers, especially `repo-scope` handling.
- Browser-smoke `/config` and the Uninstall panel without executing a real uninstall.
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
  exposed browser connector or an approved local Playwright install/run.

Known failures or gaps that must not be misreported as merge regressions:

- `scripts/test/hook-composition-check.mjs` is known pre-existing.
- `scripts/test/usage-statusline-check.mjs` is known pre-existing renderer/test format drift.
- `scripts/test/cli-surface-integration-check.mjs` has a known load-sensitive remote-sync flake;
  rerun it in isolation before calling a failure a regression.
- Linux and Windows lifecycle validation remain gaps unless separately exercised.

## Implementation Plan

- [x] Confirm `jcodemunch` availability and resolve the repo.
- [x] Remove the stale Node v16 resolver from the active path.
- [ ] Create or reuse a non-main worktree for review after this plan is committed.
- [ ] Stash unrelated dirty files before clean-worktree-sensitive package smoke, then restore
  them afterward.
- [ ] Confirm main contains the merged branch commits and inspect the install lifecycle conflict
  resolution in `docs/plans/active/infra-packaging-02-install-lifecycle.md`.
- [ ] Run the automated suites with Node >=20, including dry-run purity, managed uninstall, and
  package install smoke through `npm run test:package-install`.
- [ ] Run individual `scripts/test/*.mjs` files not already covered, classifying any failures
  as merge regressions, known flakes, or pre-existing failures with evidence from `fa51221`
  where needed.
- [ ] Fix the `cli-surface-integration-check.mjs` tracked generated-permissions leak and add a
  `generated/` clean-diff guard.
- [ ] Review and exercise the permission data flow from `manifests/inventory/agent-permissions.json`
  through CLI, portal, harness renderers, generated artifacts, and the Claude repo-write-scope
  hook.
- [ ] Review shared-state integration for `scripts/cli/state-paths.mjs`, managed uninstall
  classification, `modules/retention/*`, localhoster, telemetry spool, package catalog labels,
  capture-dense-bash, usage statusline, and shared rules changes.
- [ ] Browser-smoke `/config` and the Uninstall panel, recording console/network errors and a
  walkthrough artifact if browser automation is available.
- [ ] Update stale active and backlog plan docs, including `reviewed_commit` where verified.
- [ ] Produce the final report with verification commands, regressions, reviewed surfaces, plan
  updates, and work not completed.

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

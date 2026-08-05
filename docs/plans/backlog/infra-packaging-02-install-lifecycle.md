---
id: 46up8y7a
priority: low
next_action: Characterize install, update, repair, verify, uninstall, PATH, and moved-checkout behavior in isolated homes before changing implementation
blocked_by: []
depends_on: []
related:
  - c7b7swuh
  - 1rajbd5o
  - qjsbhel5
reviewed_commit: 6905bcd24d32bb9ad130ea79ed9b8f7bc7d696d9
---

# RoboRepo Packaging 02: Harden the Install Lifecycle

## Scope ownership

This plan exclusively owns lifecycle behavior after RoboRepo application files are available on a
machine: install/setup, update/apply, repair, verify/doctor, uninstall, PATH and shell integration,
moved-checkout recovery, version replacement, and preservation of user-owned data.

It does not own creation of the one-time new-Mac transfer artifact, npm publication, or Homebrew
formula work. Those belong to the other plans in this packaging suite. Channel-specific installers
may invoke the lifecycle commands defined here, but they must not reimplement them.

## Summary

Harden the commands and scripts that initialize, update, inspect, repair, verify, and remove a
RoboRepo installation so they behave consistently across a development checkout and immutable
package-manager installations. The lifecycle must preserve user-authored workspace content and
machine state according to explicit ownership rules, avoid duplicate shell configuration, recover
from relocated checkouts where applicable, and provide deterministic noninteractive behavior for
automation.

## Context

RoboRepo already separates application files from user-owned workspace and machine state. The
remaining risk is operational: several generations of install scripts and package-mode commands may
still disagree about backups, collisions, PATH changes, install-state records, repair behavior, and
what uninstall is permitted to delete.

The new-Mac readiness plan proves one clean local tarball can install and initialize. It intentionally
does not prove repeated lifecycle transitions such as updating an existing installation, moving a
development checkout, downgrading an application snapshot, repairing stale links, or uninstalling
without losing personal content.

## Goals

- Define one ownership model for application files, portable workspace content, machine state,
  generated harness configuration, backups, and shell integration.
- Make install/setup/update/apply/repair/verify/doctor/uninstall operations idempotent where their
  semantics allow it.
- Preserve `workspaceRoot` and explicitly retained `stateRoot` data across application replacement.
- Prevent uninstall from deleting user-authored workspace content by default.
- Detect and handle collisions with unmanaged files without silently overwriting them.
- Deduplicate PATH or shell-profile changes and remove only RoboRepo-owned entries.
- Relocate shell helpers so immutable installations never depend on a development checkout path.
- Repair stale links and install metadata after a development checkout moves.
- Define supported upgrade and downgrade behavior for local or released package snapshots.
- Support explicit noninteractive and dry-run behavior for automation.
- Fail clearly when Node or required shell dependencies are absent or unsupported.
- Keep onboarding explicit, skippable, repeatable, and recoverable after interruption.
- Document which commands are development-only and which may intentionally modify repository source.
- Verify the same core lifecycle contract in repository mode and installed-package mode.

## Non-goals

- Building or retaining the new-Mac tarball.
- Publishing npm versions or managing npm dist-tags.
- Creating a Homebrew tap or formula.
- Redesigning provider permissions, Antigravity support, or package-state reconciliation.
- Migrating every cache, telemetry record, or session between machines.

## Current state

The repository has mature install, repair, doctor, verify, and uninstall scripts, plus package-mode
CLI commands. Provider discovery and several install/uninstall paths are registry-driven. Existing
tests cover many isolated-home scenarios, including zero or partial harness presence.

The unresolved lifecycle work includes:

- upgrade and downgrade behavior across application versions;
- clean reinstall and uninstall preservation guarantees;
- moved-checkout recovery and stale absolute-path cleanup;
- PATH deduplication and shell-helper placement;
- consistent backup and collision policy;
- a complete noninteractive lifecycle matrix;
- temporary-`HOME` integration coverage using the actual command surface.

## Proposed design

### Ownership contract

| Layer | Owner | Replacement behavior | Uninstall behavior |
| --- | --- | --- | --- |
| `appRoot` | npm, Homebrew, or development checkout | Replaceable application snapshot | Package manager or explicit development uninstall may remove it |
| `workspaceRoot` | User | Never replaced implicitly | Preserve by default; remove only through a separate explicit user-content action |
| `stateRoot` | RoboRepo on behalf of the user | Migrate only through versioned state logic | Remove disposable install metadata only; preserve authored/portable records |
| Generated harness files | RoboRepo-managed projection | Rebuild from app + workspace + state | Remove only proven RoboRepo-owned entries |
| Shell profile entries | User file with RoboRepo-owned marker | Update one marked block idempotently | Remove only the marked block |
| Backups | Lifecycle subsystem | Version and bound retention | Never restore stale RoboRepo-owned entries over newer user edits silently |

### Shared lifecycle orchestration

Keep channel installers thin. npm and Homebrew place application files; lifecycle commands perform
workspace initialization and harness materialization. Development-checkout helpers use the same
ownership and collision rules even when their application root is mutable.

The public lifecycle should converge on these responsibilities:

```text
setup      initialize missing workspace/state structures
apply      materialize desired configuration from app + workspace + state
update     apply the currently installed application snapshot
repair     restore managed links/files and repair stale install metadata
verify     run deterministic installed-state assertions
doctor     diagnose repository or installed-state problems
uninstall  remove RoboRepo-owned projections while preserving user content
```

### Upgrade and downgrade model

- Application replacement must not mutate the workspace before compatibility checks pass.
- State migrations must be versioned, forward-only by default, and backed up before mutation.
- A downgrade that cannot read newer state must fail with a clear recovery path instead of guessing.
- `apply` after replacement is the only step that rematerializes generated harness configuration.
- Re-running the same version must be idempotent.

### Shell and PATH integration

- Prefer package-manager-created command shims over profile mutation.
- Any remaining RoboRepo PATH block must have stable ownership markers and deduplicate existing
  equivalent entries.
- Shell helpers required at runtime must live under `appRoot` or another explicit installed data
  location, never a remembered source-checkout path.
- Repair must identify stale checkout-derived paths and either rewrite or remove only managed
  references.

## Implementation plan

### Phase 1 — Characterization and ownership inventory

- [ ] Inventory every writer and remover for `appRoot`, `workspaceRoot`, `stateRoot`, harness homes,
      shell profiles, backups, install-state files, and symlinks.
- [ ] Add isolated-home characterization tests for install, repeated install, update, repair,
      verify, doctor, and uninstall.
- [ ] Record current behavior for zero, one, and multiple detected harnesses.
- [ ] Characterize bootstrap and command failures when Node or required shell dependencies are missing or unsupported.
- [ ] Identify every absolute checkout path persisted outside the checkout.
- [ ] Classify state files as portable, machine-local durable, cache, or disposable install metadata.

### Phase 2 — Shared lifecycle contract

- [ ] Centralize ownership checks used by setup, repair, verify, and uninstall.
- [ ] Make collision results explicit: managed, unmanaged-safe, conflict, replace-with-confirmation,
      or unsupported.
- [ ] Add shared dry-run and noninteractive result shapes.
- [ ] Ensure channel installers delegate configuration materialization to the shared lifecycle.
- [ ] Make onboarding explicit, skippable, idempotent on repeat, and recoverable after partial completion.
- [ ] Classify and document development-only commands, including every command allowed to modify repository source.
- [ ] Define one core lifecycle scenario matrix that runs in both repository mode and installed-package mode.

### Phase 3 — PATH, shell, and moved-checkout repair

- [ ] Deduplicate RoboRepo-owned shell profile entries.
- [ ] Relocate runtime shell helpers out of checkout-specific locations.
- [ ] Add repair logic for stale managed symlinks and persisted checkout paths.
- [ ] Verify repair never rewrites unmanaged neighboring content.

### Phase 4 — Replacement, upgrade, downgrade, and reinstall

- [ ] Define versioned state compatibility and migration metadata.
- [ ] Test same-version reinstall and application replacement with an existing workspace/state.
- [ ] Test supported upgrade behavior using two fixture package snapshots.
- [ ] Test downgrade refusal or recovery when newer state is incompatible.
- [ ] Confirm failed replacement leaves the previous usable state recoverable.

### Phase 5 — Uninstall and data preservation

- [ ] Remove only proven RoboRepo-owned harness projections and shell entries.
- [ ] Preserve `workspaceRoot` by default.
- [ ] Separate optional machine-state cleanup from application uninstall.
- [ ] Verify repeated uninstall is safe and reports already-absent resources clearly.
- [ ] Document recovery from partial uninstall or poisoned backups.

## Validation

- Repeated setup/apply/repair operations converge without duplicate output or shell entries.
- The actual installed package passes lifecycle tests in a temporary home and prefix.
- Moving a development checkout and running repair removes or rewrites every managed stale path.
- Upgrade preserves workspace content and migrates state only through declared migrations.
- Unsupported downgrade fails before destructive writes.
- Uninstall removes application-owned projections while leaving workspace content intact.
- Tests cover interactive confirmation, `--yes`, `--dry-run`, and noninteractive refusal paths.
- Missing or unsupported Node/shell dependencies fail before partial configuration writes and produce actionable diagnostics.
- Onboarding can be skipped, repeated, and resumed without duplicate or contradictory state.
- Repository mode and installed-package mode pass the same core setup/apply/repair/verify scenarios, with only channel-owned installation steps differing.
- Reference documentation identifies every development-only command and repository-source write boundary.
- `scripts/doctor.sh --quiet` and `scripts/test/test-roborepo.sh --quiet` remain green.

## Risks

- Existing files may not have strong ownership markers, making safe removal ambiguous.
- State migration work can accidentally turn machine-local caches into long-lived compatibility
  obligations.
- Shell behavior varies across zsh, bash, Homebrew, nvm, and other Node installations.
- Repairing moved-checkout paths can damage user configuration if managed and unmanaged content are
  not distinguished precisely.

## Decisions

- Package managers install application files; RoboRepo lifecycle commands configure user state.
- User-authored workspace content survives update and uninstall by default.
- Channel-specific plans consume this lifecycle contract rather than duplicating it.
- Public release work remains blocked until lifecycle behavior needed by that release is verified.

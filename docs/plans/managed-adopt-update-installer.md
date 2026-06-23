# Managed/Adopt/Update Installer Plan

## Goal

Design and implement the next installer model for managed/adopt/update behavior.

> **Note:** Per-feature configuration shipped through the package model and config
> control panel; see [`config-control-panel.md`](../reference/services/config-control-panel.md)
> and the completed plan
> [`config-panel-behavior-sections.md`](completed/config-panel-behavior-sections.md).
> This doc remains the high-level
> backlog and is cross-referenced from `harness-parity-todo.md` for the
> layered root-config inheritance work (item 6 below).

## Context

- This repo installs global Claude/Codex harness config.
- Current root config model separates read-mostly symlinks from mutable active config:
  - `managed`: read-mostly assets are symlinked to repo files; `~/.codex/config.toml` and
    `~/.claude/settings.json` are exported as local files.
  - adopted/user-owned: local root config remains a regular file; repo root config is skipped
    unless explicitly merged.
- Desired mental model:
  - `managed`: repo-hosted read-mostly logic; mutable root config is copied or merged locally.
  - `adopt`: copy/replicate/merge repo defaults into user-owned global config.
  - merge prompt: printed after overwrite/keep or managed backup actions, not a top-level mode.

## Important Files

- `docs/plans/harness-parity-todo.md`
- `docs/guides/install-workflows.md`
- `docs/reference/services/architecture.md`
- `docs/reference/internal/config-collision-handling.md`
- `scripts/install/main.sh`
- `scripts/install-lib.sh`
- `scripts/sync-from-home.sh`
- `scripts/test/test-install-collisions.sh`

## Work Items

1. Inspect current installer flow and collision tests.
2. Propose and implement a v2 model with:
   - `managed`
   - `adopt`: replace existing files
   - `adopt`: keep existing files
   - `adopt`: overwrite or keep-existing behavior, with merge prompt printed after the action
   - future update behavior
3. Define archive/staging layout:
   - `archived/` for local files replaced by repo candidates
   - `not_adopted/` for repo candidates staged while local files remain active
4. Define idempotency:
   - repeated adopt-replace should not endlessly archive files
   - repeated adopt-keep should refresh or stabilize staged repo candidates
   - merge prompt should be non-mutating except output
5. Define update behavior:
   - decide whether `install/main.sh` handles updates or a separate update command/script is needed
   - account for repo updates after initial adopt
6. Explore true layered root-config inheritance:
   - desired: harness repo baseline -> user global overlay -> local repo overlay
   - research whether Claude/Codex support native include/import/layering for root config
   - if not supported, design generated/merged config with source ownership and drift checks
7. Update docs to match actual behavior.
8. Add or adjust tests.

## Verification

Run the smallest checks that prove changed behavior:

- `scripts/test/test-install-collisions.sh` if installer behavior or tests are touched
- `./scripts/doctor.sh`
- `./scripts/verify-install.sh` if install behavior changed

## Working Notes

- Check git status before editing.
- Do not revert unrelated dirty files.
- After meaningful doc edits, re-index docs with jdocmunch.
- After meaningful script edits, re-index changed code with jcodemunch.

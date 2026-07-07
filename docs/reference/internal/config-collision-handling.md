# Config Collision Handling

## Purpose

Roborepo installs shared Claude Code and Codex defaults without silently replacing user-authored config. This reference documents the exact collision behavior for copied files, rendered rules, and root config.

For the user-facing walkthrough, start with [../../guides/install-workflows.md](../../guides/install-workflows.md).

## Concept Model

- **Managed copy**: a roborepo-owned home path copied from `globals/` or `manifests/`. Examples include commands, hooks, markers, and Codex rules.
- **Rendered rules**: `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`, generated from base rule fragments plus the enabled-package registry.
- **Root config baseline**: `globals/claude/settings.json` or `globals/codex/config.toml`. These are portable templates for mutable harness config.
- **User-owned config**: an existing regular file or non-roborepo symlink in a harness home.
- **Collision**: the installer finds a local path that differs from the repo source it would copy.

## Collision Policies

There is no managed/adopt install mode. The installer always copies or renders. Only the conflict policy varies:

| Policy | Behavior |
| --- | --- |
| `keep` | Leave the local file active and stage the repo candidate beside it as `*_update_TIMESTAMP`. |
| `overwrite` | Move the local file to `*_original_TIMESTAMP`, then copy the repo item into place. |
| `abort` | Stop before changing the conflicting path. |

Use:

```sh
./scripts/install/main.sh --on-conflict keep
./scripts/install/main.sh --on-conflict overwrite
./scripts/install/main.sh --on-conflict abort
```

If no flag is supplied, the installer reuses the saved `onConflict` from `~/.roborepo/install-state.json`. First noninteractive installs default to `keep`.

## Root Config Drift Detection

Root config rows (`~/.claude/settings.json`, `~/.codex/config.toml`) get one additional check before
the collision policy above applies. A byte mismatch against the current repo baseline does not by
itself prove the user touched the file — the repo baseline itself is expected to change between
installs (new permissions, hooks, MCP entries). Roborepo tracks a content hash of what it last wrote
per harness (`~/.roborepo/config-state/root-config.json`); if the active file still matches that
hash, the mismatch against the *new* baseline is a clean update, not a collision, and the file is
regenerated silently. Only a file that changed since roborepo's own last write is treated as a real
collision and falls into the policies above.

This check only ever *records* a write on the branch that actually wrote the active file. The
`keep` policy's staged-candidate branch leaves the active file untouched, so it must not (and does
not) record a write there — doing so would falsely mark a possibly-drifted file as clean. See
`docs/plans/root-config-layered-inheritance.md` for the full design and `scripts/cli/root-config-state.mjs`
for the implementation. All three install paths (`presets.mjs` JS bundle-apply,
`install-lib.sh` bash direct-installer, `install-windows.ps1` PowerShell) implement this check.

## Merge Prompt Behavior

When a collision creates a staged candidate or backup, roborepo prints a merge review prompt. The prompt lists the repo and local paths, but it is not an exhaustive diff. The agent or human doing the merge must inspect both paths directly, using recursive directory diffs for directories and structured parsers for JSON/TOML where practical.

Default stance: preserve local behavior unless the user explicitly chooses replacement.

## Rendered Rules

Rules files are roborepo-generated home files. They are identified by the `# Generated Harness Rules` header.

On first render, if a genuine user-authored `CLAUDE.md` or `AGENTS.md` already exists, roborepo saves it once under:

```text
~/.roborepo/backups/pre-install/<harness>/<filename>
```

Then it writes the rendered file. Uninstall removes rendered files it owns and restores the pre-install backup when present.

## Pre-Install Backups

Before roborepo first replaces a genuine user file, it writes a durable backup:

```text
~/.roborepo/backups/pre-install/claude/settings.json
~/.roborepo/backups/pre-install/codex/config.toml
~/.roborepo/backups/pre-install/claude/CLAUDE.md
~/.roborepo/backups/pre-install/codex/AGENTS.md
```

Backups are written only once. Roborepo-authored files and byte-identical repo copies are not captured as "originals", which prevents reinstall cycles from poisoning the backup.

## Validation

Run:

```sh
./scripts/test/test-install-collisions.sh
./scripts/test/test-roborepo.sh
node scripts/test/root-config-state-check.mjs
```

These tests use temporary home directories and cover collision policies, backup behavior, rendered
rules, package toggles, and uninstall restoration. `test-install-collisions.sh` includes root-config
drift regression coverage (`test_root_config_drift_silent_update_vs_real_collision`,
`test_root_config_keep_policy_does_not_record_false_clean`); `root-config-state-check.mjs` unit-tests
the hash sidecar directly, wired into `test-roborepo.sh`.

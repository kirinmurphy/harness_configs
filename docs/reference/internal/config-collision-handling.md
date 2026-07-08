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
`docs/plans/completed/root-config-layered-inheritance.md` for the full design and `scripts/cli/root-config-state.mjs`
for the implementation. All three install paths (`presets.mjs` JS bundle-apply,
`install-lib.sh` bash direct-installer, `install-windows.ps1` PowerShell) implement this check. On
Windows both the `Invoke-RootConfigPreflight` collision resolver and the later `Export-UserConfig`
write path are drift-aware, so a clean baseline change is not wrongly prompted as a collision.

**Uninstall.** The same drift signal governs removal: `uninstall.sh`'s `remove_root_config` deletes a
root config only when it still matches the recorded hash (`clean`), or when there is no recorded write
(`unwritten`/`missing`) and the content-based checks say it is roborepo's. A `drifted` file — one the
user edited after roborepo's last write — is left in place with its path reported, never deleted, even
though its roborepo markers would otherwise match. `--check-clean` treats a deliberately-kept drifted
file as expected, not a remnant.

**Portal / inspect visibility.** `roborepo config root inspect` (terminal) and the `/config` portal
drift chip both render from one shared producer, `config.mjs::buildRootConfigView()`, which maps each
harness to a single state: `not-installed`, `unwritten`, `in-sync`, `drifted`, or `staged-pending` (a
`*_update_TIMESTAMP` sibling beside the active file, which outranks plain drift because a pending
staged update is the actionable signal).

## Codex Native Profiles (permanent personal config)

Drift detection tells a user honestly when their root config diverged from roborepo's baseline, but
it does not give them a place to keep personal config that *survives* every `roborepo update`
untouched. Roborepo deliberately does not build a userland overlay for this (an overlay can't keep
its promise once the user hand-edits the real file or a native harness flow writes to it — see
`docs/plans/completed/root-config-layered-inheritance.md`, "Why The Overlay Design Was Dropped").

For **Codex** users, the harness already provides exactly this natively — use it instead of fighting
drift:

- Put personal settings in a named profile file at `~/.codex/<name>.config.toml`.
- Select it with `--profile <name>` on the CLI, or set `CODEX_PROFILE=<name>` in the environment.
- Codex layers the profile natively between project config and the main user config
  (`~/.codex/config.toml`). Roborepo never writes profile files, so `roborepo update` leaves them
  untouched — no drift, no collision, no staged candidate.

This is the recommended path for a Codex user who wants a permanent personal config slice: keep
`~/.codex/config.toml` as roborepo's managed baseline (let updates flow into it cleanly) and keep
personal overrides in a profile that roborepo never touches.

**Claude** has no equivalent native profile mechanism at the user-config level (fixed scope tiers:
managed > CLI args > project local > project > user). There is no roborepo-provided substitute;
Claude users manage personal root-config changes in `~/.claude/settings.json` directly and rely on
drift detection to be told, honestly, when an update would collide.

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
drift regression coverage:

- `test_root_config_drift_silent_update_vs_real_collision` — a baseline change updates silently, a
  real user edit is treated as a collision.
- `test_root_config_keep_policy_does_not_record_false_clean` — `keep` policy must not record a write
  for a file it left untouched.
- `test_uninstall_preserves_drifted_root_config` /
  `test_uninstall_check_clean_tolerates_drifted_root_config` — uninstall leaves a drifted root config
  in place (reporting its path) and `--check-clean` does not flag it as a remnant.
- `test_windows_installer_root_collision_dedup_and_drift` — the Windows installer's collision menu is
  a single shared helper, and its preflight is drift-aware (structural assertions; no PowerShell on
  the host).

`root-config-state-check.mjs` unit-tests the hash sidecar directly; `root-config-view-check.mjs`
unit-tests the per-harness drift *view* (`not-installed` / `unwritten` / `in-sync` / `drifted` /
`staged-pending`) that both `roborepo config root inspect` and the `/config` portal drift chip render
from. Both are wired into `test-roborepo.sh`.

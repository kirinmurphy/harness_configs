# Config Collision Handling

## Purpose

Roborepo installs shared Claude Code and Codex defaults without silently replacing user-authored config. This reference documents the exact collision behavior for copied files, rendered rules, and root config.

For the user-facing walkthrough, start with [../../guides/install-workflows.md](../../guides/install-workflows.md).

## Concept Model

- **Managed copy**: a roborepo-owned home path copied from `globals/` or `manifests/`. Examples include commands, hooks, markers, and Codex rules.
- **Rendered rules**: `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`, generated from base rule fragments plus the enabled-package registry.
- **Root config baseline**: `generated/claude/settings.json` or `generated/codex/config.toml`. These are portable templates for mutable harness config.
- **User-owned config**: an existing regular file or non-roborepo symlink in a harness home.
- **Collision**: the installer finds a local path that differs from the repo source it would copy.

## Collision Policies

There is no managed/adopt install mode. The installer always copies or renders. Only the conflict policy varies:

| Policy | Behavior |
| --- | --- |
| `keep` | Leave the local file active and stage the repo candidate beside it as `*_update_TIMESTAMP`. Root config is the exception: it is merged in place so local settings and repo defaults both survive. |
| `overwrite` | Move the local file to `*_original_TIMESTAMP`, then copy the repo item into place. Root config is the exception: it is merged in place after the safety backup. |
| `abort` | Stop before changing the conflicting path. |

Use:

```sh
./scripts/install/main.sh --on-conflict keep
./scripts/install/main.sh --on-conflict overwrite
./scripts/install/main.sh --on-conflict abort
```

If no flag is supplied, the installer reuses the saved `onConflict` from `~/.roborepo/install-state.json`. First noninteractive installs default to `keep`.

## Root Config Drift Detection

Root config rows (`~/.claude/settings.json`, `~/.codex/config.toml`) are shared ownership files: the
harness and user can write local settings, while roborepo contributes portable defaults. A byte
mismatch against the current repo baseline does not by itself prove the user touched the file — the
repo baseline itself is expected to change between installs (new permissions, hooks, MCP entries).
Roborepo tracks a content hash of what it last wrote per harness
(`~/.roborepo/config-state/root-config.json`); if the active file still matches that hash, the
mismatch against the *new* baseline is a clean update. If the file drifted, roborepo still preserves
local settings by using the same structured merge path instead of staging or replacing the active
file like a normal managed copy.

The installer records the merged active file after it writes it, so later drift reports are based on
the current shared-notebook state. See
`docs/plans/completed/root-config-layered-inheritance.md` for the full design and
`scripts/cli/root-config-state.mjs` for the implementation. All three install paths (`presets.mjs`
JS bundle-apply, `install-lib.sh` bash direct-installer, `install-windows.ps1` PowerShell) implement
this check. On Windows both the `Invoke-RootConfigPreflight` collision resolver and the later
`Export-UserConfig` write path are drift-aware, so a clean baseline change is not wrongly prompted as
a collision.

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

Claude global `settings.json` must not pin a `model`. Roborepo removes a top-level `model` key
during install/update merges and JS-side root-config writes so global harness config does not
override harness defaults or per-session user choice.

## Merge Prompt Behavior

When a collision creates a staged candidate or backup, roborepo prints a merge review prompt. The prompt lists the repo and local paths, but it is not an exhaustive diff. The agent or human doing the merge must inspect both paths directly, using recursive directory diffs for directories and structured parsers for JSON/TOML where practical.

Default stance: preserve local behavior unless the user explicitly chooses replacement.

## Rendered Rules

Rules files are roborepo-generated home files. They are identified by the `# Generated Harness Rules` header and are written as a managed block inside the existing `CLAUDE.md` / `AGENTS.md` file, so user text outside the managed block can stay in place.

On first render, if a genuine user-authored `CLAUDE.md` or `AGENTS.md` already exists, roborepo saves it once under:

```text
~/.roborepo/backups/pre-install/<harness>/<filename>
```

Then it injects or updates the rendered managed block in the existing file. Uninstall removes rendered files it owns and restores the pre-install backup when present.

## Pre-Install Backups

Before roborepo first replaces a genuine user file, it writes a durable backup of the original file:

```text
~/.roborepo/backups/pre-install/claude/settings.json
~/.roborepo/backups/pre-install/codex/config.toml
~/.roborepo/backups/pre-install/claude/CLAUDE.md
~/.roborepo/backups/pre-install/codex/AGENTS.md
```

Backups are written only once. Roborepo-authored files and byte-identical repo copies are not captured as "originals", which prevents reinstall cycles from poisoning the backup. The backup is for the user's original file, not for the managed block that roborepo later injects into that file.

For root config rows, the installer may create a timestamped `*_original_*` file during a collision-resolution pass and then delete that file again if the post-merge live file ends up byte-identical to it. That keeps the safety snapshot available while the merge is in flight, but avoids leaving behind redundant originals after a no-op resolution.

## Per-Element Persistence

The sections above describe the mechanism (policy, drift hash, backups) generically. This table is the
per-element view: for each harness element, what survives a first install and what survives an
`roborepo update`. The mechanism is always one of the above — this just names which one applies where.
For *why* each element gets its parity tool see
[How the Harnesses Work](harnesses-explained.md); for the source location and command to change it see
[Harness Anatomy](harness-anatomy.md#elements-at-a-glance).

| Element | On install | On update |
| --- | --- | --- |
| **Rules** (`CLAUDE.md` / `AGENTS.md`) | Genuine user file backed up once under `~/.roborepo/backups/pre-install/<harness>/`; managed block injected, user text outside the block preserved. See [Rendered Rules](#rendered-rules). | Managed block re-rendered in place; text outside it untouched. A wholly user-replaced file is handled by [collision policy](#collision-policies), not by rule rendering. |
| **Root config** (`settings.json` / `config.toml`) | Never-written file captured as original before first write. See [Pre-Install Backups](#pre-install-backups). | Clean baseline change applied silently; a file drifted since roborepo's last write is kept/staged, never merged. See [Root Config Drift Detection](#root-config-drift-detection). Codex users keep permanent personal config in a [native profile](#codex-native-profiles-permanent-personal-config) roborepo never touches; Claude has no equivalent and relies on drift detection. |
| **Permissions** | Personal overrides preserved in `~/.roborepo/command-overrides.json`; drifted config kept and repo version staged rather than replaced. | Baseline re-rendered from the manifest without erasing overrides; root-config hash distinguishes "baseline changed" from "user changed". Codex runtime `ask` hook fills the gap static rules cannot. |
| **Skills / commands** | Unrecognized native skills left alone — roborepo owns only the names it manages. Generated commands are authoritative on owned paths; existing files preserved only under collision handling. | Owned skills re-linked from `~/.roborepo/skills/`, owned commands re-rendered. Out-of-band skills stay visible as adoptable drift, never deleted. |
| **MCP servers** | Desired server recorded in manifest state and applied to both harnesses natively; unrelated user MCP entries in root config preserved. Claude uses its native live store; Codex writes active `~/.codex/config.toml`, not the repo baseline. | Manifest state re-applied rather than reconstructed from the live machine; manually added servers stay as machine state, local profile overlays not flattened. |
| **Plugins** | Plugin state added only to the active user config; no plugin payload written into repo source; unrelated user config untouched. | User's plugin choice re-applied from config state; marketplace registrations kept unless the plugin is being disabled; "enabled but not yet installed" state preserved. |
| **Hooks** | Genuine user-authored hook/config files backed up before first replacement; managed hook blocks kept separate from user-added settings. | Managed hook definitions updated, user-added config outside the managed block preserved. Some hook behavior is intentionally duplicated by hand — the harness protocols differ too much to round-trip. See [Rendered Rules](#rendered-rules) for the managed-block model that also governs hook wiring. |

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

# Install Workflows

## Purpose

This repo installs the shared harness baseline first, then lets each machine choose which optional behavior bundles to turn on. The guide below walks the install path step by step and shows the fork points the installer expects.

The examples are simulated terminal screens. Prompt text matches the current macOS/Linux scripts; file paths and timestamps are representative.

## Workflow Shape

1. Pick an install mode: `managed` or `adopt`.
2. Preview the install or run it for real.
3. Let the installer handle any collisions.
4. Let interactive install start `roborepo onboard`, then opt into the behavior bundles you want.

Each prompt is shown in its own terminal block. The next block shows the selected answer or the output that follows.

## Step 1: Pick An Install Mode

Interactive installs always ask for an install mode. `managed` and `adopt` are always available, even on clean machines and machines with existing config.

```sh
$ ./scripts/install/main.sh

Choose install mode:
  1) managed  backup any existing config first; install repo defaults
  2) adopt    keep local root config active; install repo defaults around it
  q) quit
Selection [1/2/q]:
```

Choose `managed` when this repo should own the shared baseline:

```sh
Selection [1/2/q]: 1
```

Choose `adopt` when the machine should keep local root config active:

```sh
Selection [1/2/q]: 2
```

Adopt mode also asks how later collisions should behave. The answer is saved in `~/.roborepo/install-state.json` and reused by later `roborepo onboard` or bundle commands.

```sh
Choose adopt collision behavior:
  1) overwrite      backup existing files as *_original_TIMESTAMP; install repo items
  2) keep originals leave existing files active; stage repo items as *_update_TIMESTAMP
  q) quit
Selection [1/2/q]:
```

Choose `keep originals` when local files should stay active:

```sh
Selection [1/2/q]: 2
```

On a noninteractive run, the installer uses saved install state if it has one, otherwise it falls back to `managed` and blocks unknown collisions instead of guessing.

## Step 2: Preview Or Run The Install

Run a preview first if you want to see the paths before anything moves:

```sh
$ ./scripts/install/main.sh --dry-run

Choose install mode:
  1) managed  backup any existing config first; install repo defaults
  2) adopt    keep local root config active; install repo defaults around it
  q) quit
Selection [1/2/q]:
```

After selecting `managed`, dry-run records what it would do:

```sh
Selection [1/2/q]: 1
```

The dry-run state write is reported separately:

```sh
state: would record install mode managed at /Users/you/.roborepo/install-state.json
```

Then the core summary prints:

```sh
Core install complete.
  Mode:   managed
  Claude: available
  Codex:  available

Next: install will start roborepo onboard after core install.
```

Run the real install when the preview looks right:

```sh
$ ./scripts/install/main.sh

Choose install mode:
  1) managed  backup any existing config first; install repo defaults
  2) adopt    keep local root config active; install repo defaults around it
  q) quit
Selection [1/2/q]:
```

After selecting `managed`, the install continues:

```sh
Selection [1/2/q]: 1
```

Then the core summary prints:

```sh
Core install complete.
  Mode:   managed
  Claude: available
  Codex:  available
```

Then the default configuration is applied automatically:

```sh
Applying default configuration.

Onboarding is an in-progress feature and is not interactive yet.
Applying the default configuration (the same packages install sets up automatically).
bundles: 7 applied
```

## Step 3: Managed Versus Adopt

| Mode | Use when | Result |
| --- | --- | --- |
| `managed` | You want the repo baseline to win. | Existing non-empty config is backed up first, then the repo version is installed. |
| `adopt` | You want local config to stay active. | Repo defaults are installed around the local config. Existing collisions prompt for overwrite or keep-originals handling. |

### Managed With Existing Config

`managed` applies the repo version and preserves the original file first when there is meaningful local content.

```sh
$ ./scripts/install/main.sh

Choose install mode:
  1) managed  backup any existing config first; install repo defaults
  2) adopt    keep local root config active; install repo defaults around it
  q) quit
Selection [1/2/q]:
```

Select `managed`:

```sh
Selection [1/2/q]: 1
```

If an existing non-empty file must be replaced, the installer shows the backup and install action:

```sh
backup: /Users/you/.claude/settings.json -> /Users/you/.claude/settings_original_20260615-101500.json
copy: /Users/you/.claude/settings.json <- /Users/you/projects/roborepo/globals/claude/settings.json
```

Then it prints the merge review prompt automatically:

```sh
Merge review prompt:
-----
Resolve this harness install conflict.

Repo harness path:
  /Users/you/projects/roborepo/globals/claude/settings.json

Existing local path:
  /Users/you/.claude/settings.json

Default stance: preserve the existing local path as source of truth unless you can prove a repo change can be added without breaking local behavior.

Required first step: compute your own complete comparison of both paths. Do not rely on this prompt as an exhaustive conflict summary. For directories, inspect the full recursive file list and content diffs. For structured files, parse the format when possible instead of using only text matching.

Goal: preserve the user's existing local behavior while installing useful harness behavior from the repo.

Merge instructions:
- Keep local-only behavior by default.
- Add repo-only harness behavior only when it does not conflict with local behavior.
- If both sides edit the same setting, hook, rule, command, skill, or MCP/server entry, explain the conflict and stop for user choice.
- Do not delete, replace, or move the local path unless the user explicitly approves that exact action.
- Report the files changed and the conflicts left unresolved.
-----
```

If the existing path is empty, the installer does not print backup text.

### Adopt With Existing Config

`adopt` keeps local root config active and uses repo defaults only where that does not replace the local file blindly.

```sh
$ ./scripts/install/main.sh --mode adopt
```

When a user-owned config collision appears, the installer asks how to handle that file:

```sh
Existing harness target:
  local:   /Users/you/.claude/settings.json
  harness: /Users/you/projects/roborepo/globals/claude/settings.json

Choose:
  1) overwrite     backup local as *_original_TIMESTAMP; install repo item
  2) keep originals leave local active; stage repo item as *_update_TIMESTAMP
  q) quit
Selection [1/2/q]:
```

Choose `overwrite` when the repo version should become active:

```sh
Selection [1/2/q]: 1
```

Overwrite backs up the current local file, then installs the repo item:

```sh
backup: /Users/you/.claude/settings.json -> /Users/you/.claude/settings_original_20260615-101500.json
copy: /Users/you/.claude/settings.json <- /Users/you/projects/roborepo/globals/claude/settings.json
```

Choose `keep originals` when the local file should stay active:

```sh
Selection [1/2/q]: 2
```

Keep-originals stages the repo candidate beside the local file:

```sh
stage: /Users/you/.claude/settings_update_20260615-101500.json <- /Users/you/projects/roborepo/globals/claude/settings.json
```

After either action creates a backup or staged default, the installer prints the merge review prompt automatically. There is no separate prompt option to choose.

```sh
Merge review prompt:
-----
Resolve this harness install conflict.

Repo harness path:
  /Users/you/projects/roborepo/globals/claude/settings.json

Existing local path:
  /Users/you/.claude/settings.json

Default stance: preserve the existing local path as source of truth unless you can prove a repo change can be added without breaking local behavior.

Required first step: compute your own complete comparison of both paths. Do not rely on this prompt as an exhaustive conflict summary. For directories, inspect the full recursive file list and content diffs. For structured files, parse the format when possible instead of using only text matching.

Goal: preserve the user's existing local behavior while installing useful harness behavior from the repo.

Merge instructions:
- Keep local-only behavior by default.
- Add repo-only harness behavior only when it does not conflict with local behavior.
- If both sides edit the same setting, hook, rule, command, skill, or MCP/server entry, explain the conflict and stop for user choice.
- Do not delete, replace, or move the local path unless the user explicitly approves that exact action.
- Report the files changed and the conflicts left unresolved.
-----
```

## Step 4: Collision Policy

| Policy | Active after install | Preserved files |
| --- | --- | --- |
| `overwrite` | Repo version becomes active. | Existing local files move beside the original path as `*_original_TIMESTAMP`. |
| `keep originals` | Existing local version stays active. | Repo candidates are staged beside the original path as `*_update_TIMESTAMP`. Missing files are still installed normally. |

If there is no meaningful existing content, the installer does not print backup text.

## Step 5: Default Configuration

Install applies all default bundles automatically after the core install — base guidance, skills,
Codex rules, hooks, slash commands, permission profiles, and the default MCP servers. Telemetry is
the one default-off bundle. There is no interactive step to work through.

```sh
$ roborepo onboard

Onboarding is an in-progress feature and is not interactive yet.
Applying the default configuration (the same packages install sets up automatically).
bundles: 7 applied
```

> **Note:** Per-feature configuration (individual skills, commands, packages, and Chat-Time Output
> behaviors) is handled by the package model and the config control panel — `roborepo onboard` and the
> `/config` dashboard. See [`config-control-panel.md`](../reference/services/config-control-panel.md)
> and the completed plan
> [`config-panel-behavior-sections.md`](../plans/completed/config-panel-behavior-sections.md). The
> earlier bundle-toggle wizard is recorded in
> [`onboarding-reinstatement.md`](../plans/onboarding-reinstatement.md).

Telemetry stays off until you turn it on:

```sh
roborepo telemetry enable
```

## What Onboarding Does

- Applies the default bundles idempotently on the machine.
- Stores the applied selection locally.
- The platform's install-time file operations are driven internally by `scripts/install/main.sh` (which calls the undocumented `roborepo bundle` verb); users do not run them directly — `roborepo update` re-applies them.
- Gives `roborepo` enough state to require onboarding before normal commands when the machine has not been set up yet.

## What Onboarding Does Not Do

- It does not delete user-owned config.
- It does not guess which optional bundles you want.
- It does not merge root config automatically.

## Permission Profile Selection

Permission profiles are rendered from `manifests/inventory/agent-permissions.json` before install or update:

```sh
./scripts/install/main.sh --permissions interactive
roborepo update --permissions interactive
```

Profiles are a render-time choice for this repo's generated harness defaults:

| Profile | Effect |
| --- | --- |
| `readonly` | Claude gets read-oriented permissions; Codex gets `read-only` sandbox defaults. |
| `interactive` | Claude gets read/write/edit permissions and allowed local commands; Codex gets workspace-write with prompts for sandbox escapes. |
| `workspace` | Same local workspace posture, with Codex approval prompts disabled for blocked actions. |
| `networked` | Workspace-write plus Codex sandbox network access. |

The renderer updates:

- `globals/claude/settings.json` permissions
- `globals/codex/config.toml` generated permission block
- `globals/codex/rules/default.rules`

These are global harness defaults. The installer does not keep a separate permission profile registry per consumer repo. For a different posture on one machine or project, render/install that profile for that run, or use the agent harness's one-off launch flags when starting a session.

## Uninstall

To remove all roborepo artifacts from the machine:

```sh
./scripts/install/uninstall.sh
```

Preview what will be removed without making any changes:

```sh
./scripts/install/uninstall.sh --dry-run
```

Uninstall removes:

- All manifest-managed symlinks (skills, hooks, commands, rules, markers)
- Root config files (`~/.claude/settings.json`, `~/.codex/config.toml`)
- Per-skill links in `~/.claude/skills/` and `~/.codex/skills/`
- `~/.local/bin/roborepo`
- Roborepo shell wiring from `~/.zshrc` / `~/.bashrc`
- MCP server registrations for roborepo-managed servers
- Preset state (`~/.roborepo/presets/`)
- Install state (`~/.roborepo/install-state.json`)
- Timestamped collision backups (`*_original_*` in `~/.claude/` and `~/.codex/`)
- Pre-install backups (`~/.roborepo/backups/pre-install/`)

### Root Config Restore Behavior

At install time, the installer saves the pre-existing root config to `~/.roborepo/backups/pre-install/<harness>/` before writing the repo version for the first time. On uninstall:

- If a pre-install backup exists for `~/.claude/settings.json` or `~/.codex/config.toml`, uninstall **restores** the original file instead of deleting it.
- If no backup exists (roborepo was the first to create the file), uninstall **deletes** the file.

This means uninstalling on a machine that had prior Claude or Codex config returns that machine to its pre-roborepo state.

## Related References

- [First-Time Setup](first-time-setup.md)
- [Setup And Daily Use](setup-and-daily-use.md)
- [Config Collision Handling](../reference/internal/config-collision-handling.md)

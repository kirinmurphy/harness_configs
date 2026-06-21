# Config Collision Handling

## Purpose

The harness owns shared Claude Code and Codex defaults, but `~/.claude/settings.json` and `~/.codex/config.toml` can also contain personal config. The installer protects those files from silent replacement when they already exist outside this repo.

For user-facing tradeoffs between `managed` and `adopt`, start with [../../guides/install-workflows.md](../../guides/install-workflows.md). This internal reference documents exact collision behavior.

## Concept Model

- **Managed read-mostly asset**: a home path such as skills, hooks, commands, rules, guidance, or marker files is a symlink to this repo. Repo changes flow into the tool automatically.
- **Root config baseline**: `globals/claude/settings.json` or `globals/codex/config.toml` in this repo. These are portable templates, not live symlink targets.
- **User-owned config**: a home config file is a regular file, or a symlink somewhere other than this repo.
- **Collision**: the installer finds a user-owned `~/.claude/settings.json` or `~/.codex/config.toml` where it would otherwise copy the harness baseline.
- **Non-root harness target**: a harness path such as skills, hooks, commands, rules, or managed marker files. These are not merged by the installer.

## Installer Choices

The installer has two install modes:

- `managed`: the repo baseline wins. Read-mostly target paths are created or kept as symlinks. Existing non-empty root config is backed up first, then the repo copy becomes active.
- `adopt`: local root config stays active. The installer leaves the local root config in place and still installs other clean harness links. Existing collisions offer overwrite or keep-originals handling, then print a merge prompt after the action.

Root config collisions are interactive because root config files are likely to contain personal settings:

- `~/.claude/settings.json`
- `~/.codex/config.toml`

Root config export is only automatic when the target path is missing or already symlinked to this repo from an older install. Existing repo symlinks are converted to local copies. The installer does not auto-merge config or silently replace non-root conflicts. Claude and Codex do not have identical layering behavior, and MCP/server settings can include machine-specific assumptions.

If any non-root harness target or global command target already exists and is not managed by this repo, install stops before changing files and prints a merge prompt after the blocking action. This keeps `managed` and `adopt` limited to clean installs instead of forcing the user to recover from backups.

## Merge Prompt Behavior

Generated merge prompts are intentionally conservative. The installer prints the relevant repo and local paths, but it does not claim to provide an exhaustive conflict summary. The prompt tells the agent to compute a complete comparison first, including recursive file lists for directories and parsed key/table/array comparisons for structured config where possible.

For install conflicts, the default stance is to preserve local behavior unless the selected install mode says the repo baseline should win. For sync conflicts, the default stance is to keep the repo baseline unless a local live change is clearly intentional and safe to promote.

## Happy Path

Run a preview first:

```sh
./scripts/install/main.sh --dry-run
```

If the preview reports no collisions, run:

```sh
./scripts/install/main.sh
```

If a collision is reported, choose the install mode first, then the collision policy when prompted. `managed` backs up and replaces existing non-empty config. `adopt` keeps local config active and uses overwrite or keep-originals handling where needed.

For non-root conflicts, resolve or move the local path first, then rerun the installer.

## Backups

Config collision handling avoids replacement instead of depending on backups. The installer still backs up unrelated shell/global-command files when those helper installers intentionally edit or replace them. Those backups are written under:

```text
~/.roborepo-backups/<timestamp>/
```

If a backup path already exists, the installer adds a numeric suffix instead of overwriting the older backup.

### Pre-Install Backup

When the installer first copies a root config file over an existing file, it saves the original to:

```text
~/.roborepo/backups/pre-install/<harness>/<filename>
```

For example:

```text
~/.roborepo/backups/pre-install/claude/settings.json
~/.roborepo/backups/pre-install/codex/config.toml
```

This backup is written only once — if the backup already exists, the installer leaves it unchanged. This preserves the state from before roborepo was ever installed, regardless of how many reinstalls follow.

On uninstall (`scripts/install/uninstall.sh`), when a pre-install backup exists for a root config file, uninstall restores it rather than deleting the file. If no pre-install backup exists (the root config file was created by roborepo on a clean machine), uninstall deletes the file. The pre-install backup directory is removed after restoration.

The timestamped `*_original_*` backups written by collision handling during managed installs are separate from the pre-install backup and are also removed on uninstall.

## Noninteractive Runs

If stdin is not interactive and a config collision exists, the installer exits before making unrelated changes unless an explicit or previously saved collision policy is available. Use `--dry-run` to inspect the collision, then run the installer interactively, pass `--on-conflict overwrite|keep`, or move the config aside yourself.

## Sync Workflow

`scripts/sync-from-home.sh` reviews live home config and lets you selectively copy changes back into this repo. For each changed item, it shows a diff and asks whether to keep the repo version or overwrite the repo from home. Merge prompts print after actions that create backups or staged defaults.

This workflow does not require every path to be a symlink. It reviews the listed home paths and prompts before copying changed content into the repo. For root config files, sync is conservative: adopted root configs are user-owned, so sync skips these files by default:

- `~/.claude/settings.json`
- `~/.codex/config.toml`

Use `--include-root-config` only when you intentionally want to review and promote those user-owned root config files into the repo baseline:

```sh
./scripts/sync-from-home.sh --include-root-config
```

`ROBOREPO_REPO_ROOT` is available for tests that need to point sync at a temporary repo fixture. Do not set it during normal use.

Still inspect the final repo diff before committing.

## Validation

Run the collision regression tests:

```sh
./scripts/test/test-install-collisions.sh
```

The test uses temporary `HOME` directories only. It covers fresh installs, dry-run collisions, noninteractive blocking, interactive choices, aborts, backup uniqueness, malformed config reporting, idempotency, and sync guards.

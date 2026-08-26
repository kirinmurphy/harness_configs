# Using the `roborepo` CLI

`roborepo` is the single front door.
After [installing roborepo](../guides/first-time-setup.md), install puts it on your `PATH`, so it works from any shell.

> If `roborepo` is not found, run `roborepo doctor` (or `./bin/roborepo doctor` before the first
> install) — it reports whether the command is installed and on `PATH`, with the exact fix.

## First Run

|                            |                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roborepo init [--dry-run] [--force]` | Sets up a new installation: creates workspace/state directories, refreshes harness discovery, asks whether to configure in the browser or CLI, then records that initialization completed. The browser path opens `roborepo web --detach`; the CLI path opens the Package Library and applies the result. Safe to re-run — a completed install reports and exits instead of replaying the wizard. `--dry-run` previews without mutating; `--force` re-runs the full workflow on an already-initialized install. |
| `roborepo library`         | Opens the Package Library to change which behaviors are enabled. Identical to `roborepo package manage`. |

A bare, interactive `roborepo` on an uninitialized install goes into `init` automatically. Explicit
commands are never gated on initialization — `doctor`, `version`, and `--help` work before it, and
bare non-interactive invocations open the normal menu rather than a wizard, so scripts are safe.

Zero detected harnesses is a valid initialization: install or launch a supported harness later and
run `roborepo harness refresh`.

## Uninstall

|                            |                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roborepo uninstall [--dry-run] [--yes] [--delete-workspace]` | Removes RoboRepo-managed harness configuration and machine-local state. Your workspace is preserved by default. `--dry-run` previews without changing anything; `--yes` is required to run destructively without a TTY; `--delete-workspace` additionally removes a workspace stored inside the RoboRepo state directory. |

Removal has two owners. In package mode, `roborepo uninstall` removes what RoboRepo created and then
runs npm against the prefix that contains the current `roborepo` binary. Removing the npm package
alone leaves your RoboRepo configuration and workspace in place.

A workspace relocated outside the state directory is never deleted by RoboRepo, including with
`--delete-workspace`. See
[install-workflows.md](../guides/install-workflows.md#uninstall) for the full ownership model.

## Setup and Maintenance

|                            |                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roborepo update [--verbose]` | Applies this repo's harness config to this machine: copied files, rendered rules, root config export, global command install, and shell wiring. Use after pulling repo changes; `--verbose` includes unchanged items in the report. |
| `roborepo repair [--dry-run] [--on-conflict ...]` | Repairs a moved or renamed checkout by relinking stale symlinks against the current path; it leaves copied config content alone. |
| `roborepo maintenance repair local-config [--dry-run or --apply]` | Recovers safe local Claude/Codex settings from recent backups when `update` or `doctor --installed` reports local config repair candidates. |
| `roborepo maintenance stores [list]` | Lists the local stores roborepo keeps on disk — telemetry spools, localhoster history, capture logs — with each one's size against its bound. |
| `roborepo maintenance stores reset <id> [--all]` | Reclaims space in one store. Applies that store's own retention policy, or with `--all` clears it outright. Store ids come from `stores list`. |
| `roborepo maintenance portal-pids [--reap]` | Lists `~/.roborepo/portal/server-<port>.pid` files and whether each one's process is still alive. A portal killed by a reboot or `SIGKILL` leaves its pid file behind. Reports by default; `--reap` deletes only the entries whose process is definitively gone, never a running portal or one owned by another user. |
| `roborepo doctor`          | Runs harness health checks for config files, links, helper commands, dependencies, and generated outputs.                                                        |
| `roborepo doctor --installed [--verbose]` | Runs post-install verification that the installed harness paths resolve correctly; default output is concise.                                      |
| `roborepo rules [--check]` | Renders generated Claude/Codex global instruction files, or verifies them with `--check`.                                                                        |
| `roborepo config root inspect` | Read-only report of each harness root config (`~/.claude/settings.json`, `~/.codex/config.toml`): baseline vs. active file and its drift state — `in sync`, `drifted` (edited since roborepo's last write), `staged update pending`, or untracked. |

## Packages

|                                            |                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `roborepo package create <id> [--kind=empty\|auto-skill\|skill-command\|standalone-command] [--description=...] [--default-enabled=true]` | Scaffolds a new package under `globals/packages/<id>/` (dev checkout) or the workspace packages dir (package mode). Refuses to overwrite an existing package. |
| `roborepo package list`                    | Lists packages grouped by category with concise live enabled/disabled status.                                        |
| `roborepo package inspect <id>`            | Prints the full manifest for one package.                                                                             |
| `roborepo package validate [id]`           | Validates one package or the whole catalog against the current manifest schema.                                      |
| `roborepo package enable <id>` | Enables a package and applies it live immediately — permissions, hooks, rules, MCP, and commands install without a separate `roborepo update`. |
| `roborepo package disable <id>` | Disables a package and removes its owned contributions live immediately.                                             |
| `roborepo package reconcile`               | Re-applies every currently-enabled package and drops any enabled-but-unknown stale entries — the full-reconciliation entry point. |
| `roborepo package adopt-live [--dry-run]`  | Detects externally-installed package behavior and marks it enabled in the registry without reinstalling it.          |

Package development is a maintainer workflow; package users usually only need `package list`,
`package inspect`, `package enable`, and `package disable`.

## Local Portal

| | |
| --- | --- |
| `roborepo web` | Starts the local portal. `/config` manages packages/permissions, `/plans` browses plan docs, `/localhoster` lists local web apps, and `/telemetry` shows token usage when telemetry has data. |
| `roborepo web --detach [--no-open] [--port <n>]` | Starts the same portal detached and opens it in the browser. A cold start warms its views before binding and can take ~30s. |
| `roborepo web stop [--port <n>]` | Stops the detached portal. PID files are tracked per port, so pass the same `--port` used to start it. |
| `roborepo localhoster [--json] [--open]` | Lists active localhost HTTP apps, prints the portal snapshot as JSON, or opens `/localhoster`. |

The `/plans` page scans configured roots for `docs/plans/**/*.md`. See
[Plan Docs Walkthrough](../guides/plan/lifecycle/plan-docs.md) and
[Plans Portal Technical Reference](plans-portal.md).

The `/localhoster` page discovers local HTTP apps on macOS, keeps machine-local saved links under
the RoboRepo state root, and reports per-provider capability limits. See [Localhoster](localhoster.md).

> `roborepo dev …` exists only in a Git checkout of roborepo itself; the scripts it drives are not
> published to npm, so an installed copy reports that it requires a development checkout. Nothing
> in this reference depends on it.

## Indexing

|                              |                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `roborepo index code [path]` | Runs the enabled package-owned code indexer for the current directory or `[path]`.         |
| `roborepo index docs [path]` | Runs the enabled package-owned documentation indexer for the current directory or `[path]`. |
| `roborepo index code [path] --watch` | Keeps the enabled package-owned code index live while files change.                       |

## Skills

|                                            |                                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `roborepo skill new`                       | Scaffolds a package-owned skill or slash command and updates package config, generated outputs, commands, and README.         |
| `roborepo skill adopt <name>`              | Moves an unmanaged native skill into shared roborepo source and refreshes the managed harness views.                          |
| `roborepo skill export-to-project`         | Copies this repo's shared skills into the current project and leaves a shareable zip bundle.                                  |
| `roborepo skill link-project`              | Links a project's `.codex/skills` into existing `.claude/skills` folders.                                                     |
| `roborepo skill sync-global`               | Refreshes the shared skill cache and global harness links after adding or removing package-owned shared skills.               |
| `roborepo skill inspect <name>`            | Reports skill source, managed/unmanaged ownership, native collision state, and per-harness install state.                     |
| `roborepo skill triggers [--check]`        | Checks trigger and near-miss fixtures from `manifests/inventory/skill-trigger-tests.json`.                                    |
| `roborepo skill render-commands [--check]` | Renders generated slash commands from package `slash-command` resources, or verifies them with `--check`.                     |
| `roborepo skill native [--full]`           | Shows native Claude/Codex plugin entrypoints; `--full` prints native help output inline.                                      |

See [roborepo Skills Interface](roborepo-skills.md) for the managed/native boundary and examples.

## MCP Setup

|                                  |                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `roborepo mcp add <name-or-url>` | Registers an MCP server with every managed harness that supports MCP (Claude, Codex, Gemini), including matching Claude permissions unless skipped. Scope it with `--harness <id>`. |

## Command Output

|                                |                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------ |
| `roborepo run <cmd> [args...]` | Runs a command and prints a trimmed output tail so noisy checks stay readable. |

Run:

```sh
roborepo --help
```

Full flags and examples live in [roborepo CLI Reference](roborepo.md).

## Index Code and Docs

Code indexing is package-owned, so the indexer package can be swapped later without changing the
`roborepo` front door. Enable the owning package first; the current `jcodemunch` package provides
the code index and watch commands:

```sh
roborepo package enable jcodemunch
roborepo index code
roborepo index code --watch
```

Documentation indexing is owned by the current `jdocmunch` package:

```sh
roborepo package enable jdocmunch
roborepo index docs
```

If a package-owned command is not enabled, roborepo prints the package to enable instead of falling
back to a built-in recipe.

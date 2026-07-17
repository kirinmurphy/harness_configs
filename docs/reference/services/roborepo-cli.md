# Using the `roborepo` CLI

`roborepo` is the single front door.
After [installing roborepo](../../guides/first-time-setup.md), install puts it on your `PATH`, so it works from any shell.

> If `roborepo` is not found, run `roborepo doctor` (or `./bin/roborepo doctor` before the first
> install) — it reports whether the command is installed and on `PATH`, with the exact fix.

## Setup and Maintenance

|                            |                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roborepo update [--verbose]` | Applies this repo's harness config to this machine: copied files, rendered rules, root config export, global command install, and shell wiring. Use after pulling repo changes; `--verbose` includes unchanged items in the report. |
| `roborepo repair [--dry-run] [--on-conflict ...]` | Repairs a moved or renamed checkout by relinking stale symlinks against the current path; it leaves copied config content alone. |
| `roborepo repair local-config [--dry-run or --apply]` | Recovers safe local Claude/Codex settings from recent backups when `update`, `doctor`, or `verify` reports local config repair candidates. |
| `roborepo doctor`          | Runs harness health checks for config files, links, helper commands, dependencies, and generated outputs.                                                        |
| `roborepo verify`          | Runs post-install verification that the installed harness paths resolve correctly.                                                                               |
| `roborepo rules [--check]` | Renders generated Claude/Codex global instruction files, or verifies them with `--check`.                                                                        |
| `roborepo config root inspect` | Read-only report of each harness root config (`~/.claude/settings.json`, `~/.codex/config.toml`): baseline vs. active file and its drift state — `in sync`, `drifted` (edited since roborepo's last write), `staged update pending`, or untracked. |

## Local Portal

| | |
| --- | --- |
| `roborepo serve` | Starts the local portal. `/config` manages packages/permissions, `/plans` browses plan docs, and `/telemetry` shows token usage when telemetry has data. |
| `roborepo web` | Starts the same portal detached and opens it in the browser. |

The `/plans` page scans configured roots for `docs/plans/**/*.md`. See
[Plan Docs Walkthrough](../../guides/plan-docs.md) and
[Plans Portal Technical Reference](plans-portal.md).

## Indexing

|                              |                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `roborepo index code [path]` | Runs the enabled package-owned code indexer for the current directory or `[path]`.         |
| `roborepo index docs [path]` | Runs the enabled package-owned documentation indexer for the current directory or `[path]`. |
| `roborepo watch code [path]` | Keeps the enabled package-owned code index live while files change.                             |

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
| `roborepo mcp add <name-or-url>` | Registers an MCP server with Claude and Codex, including matching Claude permissions unless skipped. |

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
roborepo enable jcodemunch
roborepo index code
roborepo watch code
```

Documentation indexing is owned by the current `jdocmunch` package:

```sh
roborepo enable jdocmunch
roborepo index docs
```

If a package-owned command is not enabled, roborepo prints the package to enable instead of falling
back to a built-in recipe.

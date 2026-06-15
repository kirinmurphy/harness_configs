# Using the `roborepo` CLI

`roborepo` is the single front door.
After [installing roborepo](../../guides/first-time-setup.md), install puts it on your `PATH`, so it works from any shell.

> If `roborepo` is not found, run `roborepo doctor` (or `./bin/roborepo doctor` before the first
> install) — it reports whether the command is installed and on `PATH`, with the exact fix.

## Setup and Maintenance

|                            |                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roborepo update`          | Applies this repo's harness config to this machine: managed links, root config export, global command install, and shell wiring. Use after pulling repo changes. |
| `roborepo backfill`        | Reviews live config under `~/.claude` and `~/.codex` and pulls intentional changes back into this repo.                                                          |
| `roborepo doctor`          | Runs harness health checks for config files, links, helper commands, dependencies, and generated outputs.                                                        |
| `roborepo verify`          | Runs post-install verification that the installed harness paths resolve correctly.                                                                               |
| `roborepo rules [--check]` | Renders generated Claude/Codex global instruction files, or verifies them with `--check`.                                                                        |

## Indexing

|                              |                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `roborepo index code [path]` | Runs a one-shot jcodemunch code index for the current directory or `[path]`.         |
| `roborepo index docs [path]` | Runs a one-shot jdocmunch documentation index for the current directory or `[path]`. |
| `roborepo watch code [path]` | Keeps the jcodemunch code index live while files change.                             |

## Project Context

|                                                         |                                                                                                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roborepo project-context inventory [path] [--summary]` | Scans a repo and writes deterministic generated facts to `docs/project-context/generated/repo-scan.json` (and, with `--summary`, a short `repo-summary.md`). The `project-context` skill turns those facts into curated handoff docs. |

## Skills

|                                            |                                                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `roborepo skill new`                       | Scaffolds a shared skill or slash command and updates manifests, generated links, commands, and README.                       |
| `roborepo skill export-to-local`           | Copies this repo's shared skills into the current target repo and leaves a shareable zip bundle.                              |
| `roborepo skill symlink-repo`              | Symlinks a target repo's `.agents/skills` into existing `.claude/skills` and/or `.codex/skills` folders.                      |
| `roborepo skill symlink-globals [--check]` | Symlinks this repo's shared skill source into global harness folders after adding or removing `globals/agents/skills/<name>`. |
| `roborepo skill render-commands [--check]` | Renders generated slash commands from `manifests/inventory/slash-commands.json`, or verifies them with `--check`.             |

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

Code indexing powers `jcodemunch-mcp`, so agents can search symbols and targeted source context
instead of reading broad file dumps:

```sh
roborepo index code
roborepo watch code
```

Documentation indexing powers `jdocmunch-mcp`, so agents can search sections and headings:

```sh
roborepo index docs
```

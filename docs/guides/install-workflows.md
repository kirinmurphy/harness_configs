# Install Workflows

## Purpose

Roborepo materializes global harness config onto a machine by copying owned files, rendering rules, and preserving user-authored root config. There is no managed/adopt mode. The only install-time choice is how to handle collisions for mutable root config and other copied paths.

## Workflow Shape

1. Run a dry-run preview when you want to inspect planned paths.
2. Run the installer.
3. Choose collision handling only if the installer finds a conflicting local file.
4. Let onboarding enable optional packages and skills.
5. Verify with `roborepo doctor --installed`.

## Preview

```sh
./scripts/install/main.sh --dry-run
```

Dry-run reports the shell/PATH actions, install state write, base rule render, and base bundle application it would perform. It does not mutate home config.

## Install

```sh
./scripts/install/main.sh
```

The installer writes:

- rendered base rules to `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`
- copied roborepo-owned files such as markers, commands, hooks, and Codex rules
- copied root config baselines when no local file exists
- `roborepo-support` in each installed harness skill directory
- `~/.local/bin/roborepo`
- install state at `~/.roborepo/install-state.json`

Then it applies the default `base` bundle and starts `roborepo package manage` unless onboarding was already completed or explicitly skipped. On update, that base bundle still re-applies so rendered rules stay fresh even on an already-onboarded machine.

## Collision Policy

`--on-conflict` controls what happens when an existing local file differs from the repo source:

| Policy | Result |
| --- | --- |
| `keep` | Leave the existing file active and stage the repo candidate beside it as `*_update_TIMESTAMP`. |
| `overwrite` | Move the existing file to `*_original_TIMESTAMP`, then copy the repo file into place. |
| `abort` | Stop instead of changing the conflicting path. |

Example:

```sh
./scripts/install/main.sh --on-conflict keep
```

When no policy is supplied, the installer uses the saved `onConflict` value from `~/.roborepo/install-state.json`. On a first noninteractive run it defaults to `keep`.

## Rules Rendering

Home rules files are generated from base fragments plus enabled package rule fragments. The enabled-package registry lives at:

```text
~/.roborepo/enabled-packages.json
```

Commands that change package state update the registry and re-render the home rules files:

```sh
roborepo package enable jcodemunch
roborepo package disable jcodemunch
roborepo rules --check
```

## Optional Packages

Base install is intentionally minimal. Optional behavior appears only after onboarding or explicit package enablement:

- `jcodemunch` and `jdocmunch` register MCP servers, hooks, permissions, and rule fragments.
- `telemetry` installs capture state through its service component.
- packages with skill components materialize skills into `~/.roborepo/skills/<name>` and link the
  harness skill dirs to that cache.

## Update

```sh
roborepo update
```

`roborepo update` re-runs the installer against the current repo source, refreshes copied files, re-renders rules from the registry, and keeps the saved conflict policy unless `--on-conflict` overrides it.

After a successful update it prints a concise change report, for example:

```text
changed: rules claude
changed: skill roborepo-support
unchanged: package registry
```

## Uninstall

```sh
roborepo uninstall
```

Uninstall removes roborepo-owned copied files, rendered rules, managed skill copies, shell wiring, and install state. If a genuine pre-install backup exists under `~/.roborepo/backups/pre-install/`, uninstall restores it.

## Verification

```sh
roborepo doctor --installed
roborepo doctor --installed
```

`doctor --installed` checks the active machine state, including rendered home rules and base skill copies.

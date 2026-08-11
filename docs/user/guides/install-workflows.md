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

## New-Mac Package Install

This is a separate workflow from the checkout-based install above. Use it when you want to get
`roborepo` running on a new Mac from a real npm package artifact, before that Mac has a clone of
this repository. Keep the bare `roborepo` command pointing at the packaged snapshot. Use package-mode
commands such as `roborepo config apply` to materialize live configuration.

### 1. On the old Mac: build and verify a transfer artifact

From a clean checkout (no uncommitted changes — the tool refuses otherwise, since the artifact's
recorded source commit must match the bytes it ships):

```sh
npm run prepare:new-mac-install -- --output-dir ~/roborepo-transfer
```

This packs the real npm tarball, installs it into an isolated prefix and temporary home (nothing
touches your real `~/.roborepo` or global npm), and runs `version`, `setup`, `workspace status`,
`config apply`, and `doctor` against it. Only after all of that passes does it write three files
into `~/roborepo-transfer` (real npm-generated names, e.g. `codethings-roborepo-alpha-0.1.0-beta.0.tgz`):

- `<tarball-name>.tgz` — the tarball that passed every check
- `<tarball-name>.tgz.sha256` — its checksum
- `install-manifest.json` — package name/version, the exact git commit it was built from, and
  which commands it was verified against

It also prints the exact commands you'll need next, with the real filenames filled in. Keep that
output, or just re-read the filenames from `install-manifest.json` and follow the steps below.

### 2. Transfer `~/roborepo-transfer` to the new Mac

AirDrop, USB drive, `scp`, whatever moves files between the two machines. Copy the whole directory
so the tarball and its checksum stay together.

### 3. On the new Mac: verify and install

```sh
cd ~/roborepo-transfer   # wherever you copied it to
shasum -a 256 -c <tarball-name>.tgz.sha256
npm install -g ./<tarball-name>.tgz
```

The checksum check confirms the transfer didn't corrupt the file. `npm install -g` installs it
globally, the same way a published package would install — `roborepo` is now on your `PATH`
without a repo checkout anywhere on this machine.

Confirm it worked:

```sh
roborepo version
roborepo setup
roborepo workspace status
roborepo harness refresh
roborepo harness list
roborepo config apply
roborepo doctor
```

The first pass should work with no harness binaries installed and no native harness home/config
created yet.

### 4. Roll back if needed

```sh
npm uninstall -g codethings-roborepo-alpha
```

### 5. Observe harness discovery

Use this as an observation sequence for the real new-machine test:

1. Install RoboRepo with no harnesses installed.
2. Run:
   ```sh
   roborepo version
   roborepo setup
   roborepo workspace status
   roborepo harness refresh
   roborepo harness list
   roborepo config apply
   roborepo doctor
   ```
3. Install one harness binary, but do not launch it yet.
4. Run `roborepo harness refresh`, `roborepo harness list`, and `roborepo doctor`; record what
   RoboRepo sees.
5. Launch that harness once so it creates its native home/config.
6. Run `roborepo harness refresh`, `roborepo harness list`, `roborepo config apply`, and
   `roborepo doctor` again; record the difference.

This is only an observation sequence. It does not expand harness presence signals or implement a
new provider behavior.

### 6. Clone for development later

Clone the repository only after the packaged baseline works. Do not run the checkout installer just
to materialize harness config; doing that can replace or shadow the packaged global command with a
checkout symlink.

```sh
git clone <repo-url>
cd roborepo
./bin/roborepo version
```

Use:

- `roborepo` for the globally installed package snapshot;
- `./bin/roborepo` for development code from the checkout.

Both entry points may write the same live `~/.roborepo` and harness config. Check which code path
ran with `roborepo version` or `./bin/roborepo version` before comparing behavior.

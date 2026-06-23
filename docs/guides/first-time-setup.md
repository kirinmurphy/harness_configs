# First-Time Setup

Use this guide to install the core repo-managed config and put `roborepo` on your `PATH`.

Works with Claude Code, Codex, or both. Supports macOS and Linux; Windows support is available but
less tested.

## Install Configs And CLI

The first install runs the installer script directly — this is what puts `roborepo` on your `PATH`.
Clone the repo, then from its root:

Preview install changes:

```sh
./scripts/install/main.sh --dry-run
```

Install on a new machine:

```sh
./scripts/install/main.sh
```

Interactive installs ask for the install mode, then apply the default configuration automatically
(all default bundles; telemetry stays off). The onboarding wizard is an in-progress feature and is
not shown yet. Running `roborepo onboard` re-applies the defaults headlessly:

```sh
roborepo onboard
```

After the first install, use `roborepo` from anywhere. `roborepo update` re-runs the same installer
to pick up new or changed config (there is no separate `install` verb):

```sh
roborepo
roborepo update
roborepo doctor
roborepo verify
```

## Choose an Install Type

The installer has two ownership models:

| Workflow | Use when | Result |
| --- | --- | --- |
| `managed` | This repo owns the global defaults, or the machine is clean. | Core config paths point into this repo through symlinks, then the default bundles are applied automatically. |
| `adopt` | You already have local Claude/Codex config you want to keep. | Local config remains user-owned while repo defaults are copied, staged, or merged intentionally. |

No install workflow deletes existing user config. When the installer finds a collision it preserves
the existing file and either asks what to do or stops before changing that path.

Interactive installs always ask you to choose `managed` or `adopt`. Both choices are available on
clean machines and on machines with existing config. Adopt installs also ask whether later file
collisions should overwrite with backups or keep originals with staged repo defaults. Use
`--mode managed` or `--mode adopt` only when you want to skip the interactive mode prompt.

For the full decision model and terminal-style walkthroughs, see [Install Workflow Choices](install-workflows.md). For exact collision behavior, see [Config Collision Handling](../reference/internal/config-collision-handling.md).

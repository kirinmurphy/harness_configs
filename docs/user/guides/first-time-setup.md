# First-Time Setup

Use this guide to install the core repo-managed config and put `roborepo` on your `PATH`.

Works with Claude Code, Codex, and Gemini CLI — any one of them, or any combination. roborepo
discovers whichever are installed and manages those; see
[Supported Harnesses](harnesses/supported-harnesses.md) for what each one receives. Supports macOS
and Linux; Windows support is available but less tested.

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

Or install the published package, with no repo checkout anywhere on the machine:

```sh
npm install -g codethings-roborepo-alpha
roborepo init
```

`roborepo init` is the first-run workflow either way. It creates the workspace and state
directories, detects which agent harnesses are on this machine, opens the Package Library so you
choose which behaviors to enable, and applies the result. The chooser walks the same sections the
`/config` display shows — Token Optimization, Commands, Code Conventions, Chat-Time Output, and a
read-only Permissions panel — one section per step:

- `←` / `→` move between sections
- `↑` / `↓` move within a section
- `Space` toggles the highlighted item
- `Enter` advances (and finishes on the last step); `Esc` finishes early

Only the baseline is applied automatically; everything else is opt-in (telemetry stays off unless you
turn it on). Noninteractive runs skip the wizard and apply the baseline headlessly.

`init` is safe to re-run: once initialization has completed it reports that and exits rather than
replaying your choices. If it is interrupted partway — `Ctrl-C`, a failed step, a closed terminal —
the next run resumes instead of starting over. Zero detected harnesses is a valid outcome; install
or launch a harness later and run `roborepo harness refresh`.

Rerun the chooser any time to change your choices:

```sh
roborepo library
```

`roborepo library` and `roborepo package manage` are two names for the same workflow. `library` is
the short one; the `package` namespace holds the detailed operations (`list`, `inspect`, `enable`,
`disable`, `reconcile`).

After the first install, use `roborepo` from anywhere. `roborepo update` re-runs the same installer
to pick up new or changed config (there is no separate `install` verb):

```sh
roborepo
roborepo update
roborepo doctor
roborepo doctor --installed
```

## Choose Collision Behavior

The installer always materializes config by copying owned files and rendering generated rules. There is no install mode. Existing user config is preserved unless you choose to overwrite it.

| Policy | Use when | Result |
| --- | --- | --- |
| `keep` | You already have local Claude/Codex config you want active. | Local files stay active; repo candidates are staged beside them as `*_update_TIMESTAMP`. |
| `overwrite` | The repo baseline should replace the local file. | Local files are backed up as `*_original_TIMESTAMP`, then the repo file is copied in. |
| `abort` | You want manual review before any conflict is changed. | Install stops at the conflicting path. |

Use `--on-conflict keep`, `--on-conflict overwrite`, or `--on-conflict abort` to make this explicit. Without a flag, roborepo reuses the saved `onConflict` value from `~/.roborepo/install-state.json`; first noninteractive installs default to `keep`.

For the full decision model and terminal-style walkthroughs, see [Install Workflow Choices](install-workflows.md). For exact collision behavior, see [Config Collision Handling](../reference/config-collision-handling.md).

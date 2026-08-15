# Setup and Daily Use

This repo owns your agent harness config (Claude Code, Codex) and exposes it at the paths agents already read. Setup installs the core once, then starts the onboarding wizard so you can choose which behaviors you want on that machine.

For install workflow tradeoffs, see [install-workflows.md](install-workflows.md). For system details, see [../reference/architecture.md](../reference/architecture.md).

---

## Platform Support

| Platform | Status                                                                                   |
| -------- | ---------------------------------------------------------------------------------------- |
| macOS    | Primary                                                                                  |
| Linux    | Primary                                                                                  |
| Windows  | Available — less tested; requires Git for Windows or WSL — see [Windows notes](#windows) |

---

## Setup

### Clone the repo, then run:

```sh
./scripts/install/main.sh
```

This installs the core CLI plus the shared baseline. It detects which harnesses are installed (Claude Code, Codex, or both), copies owned files, renders rules, exports mutable root config as local files, installs global commands, and adds shell snippets to your profile.

Interactive install starts onboarding after the core install completes. If you skip it, or if install ran noninteractively, run:

```sh
roborepo package manage
```

That workflow turns on or skips optional behavior packages such as skills, hooks, commands, rules, MCP defaults, permissions, and telemetry. Re-running `roborepo package manage` later shows selected options checked and unselected options unchecked.

The installer has one materialization model: copy owned files, render generated rules, and preserve
user-authored root config unless the selected collision policy says otherwise. See
[install-workflows.md](install-workflows.md) for the step-by-step flow and collision behavior.

Root config export merges the repo baseline with the active local file when a root-config row collides, preserving the local content and cleaning up redundant backup originals after a no-op resolution. The installer does not auto-merge user config for other managed paths, or silently replace non-root conflicts. If another harness file or global command target already exists and is not managed by this repo, install stops before changing files and prints a merge prompt after the blocking action. See [Config Collision Handling](../reference/config-collision-handling.md) for exact behavior.

**The script is safe to re-run** — owned copies and rendered rules are refreshed, and local Claude/Codex settings are merged with the repo baseline instead of replaced. If a past update left recoverable local settings in a backup, `roborepo update` or `roborepo doctor --installed` will point you at `roborepo maintenance repair local-config --dry-run`.

If onboarding has not been completed yet, `roborepo` runs that workflow before most normal commands. `--no-presets-onboard` or `ROBOREPO_PRESETS_ONBOARD=skip` bypasses install-time onboarding and the later command gate for automation.

### Preview without modifying anything:

```sh
./scripts/install/main.sh --dry-run
```

### Verify the install:

```sh
./scripts/verify-install.sh
```

### Test installer collision behavior:

```sh
./scripts/test/test-install-collisions.sh
```

This runs against temporary `HOME` directories only. See [Config Collision Handling](../reference/config-collision-handling.md#validation) for what it covers.

---

## Maintenance

### Manage Agent Permissions

Agent permission defaults start in `manifests/inventory/agent-permissions.json` as flat behavior and
command buckets. Each entry resolves to `allow`, `ask`, or `deny`; there is no longer a profile
bundle such as `readonly`, `interactive`, or `workspace`.

Use the onboarding flow or config portal for normal machine-level changes:

```sh
roborepo package manage
roborepo web
```

Render or check the repo baseline after editing the manifest:

```sh
roborepo permissions
roborepo permissions --check
```

The renderer updates the generated permission block in `generated/codex/config.toml`, the shell prefix
rules in `generated/codex/rules/default.rules`, and Claude `permissions.allow` / `permissions.deny` /
`permissions.ask` in `generated/claude/settings.json`. Existing `~/.codex/config.toml` and
`~/.claude/settings.json` files are local root config, so run `roborepo update` and follow the root
config merge/export flow before a newly rendered baseline affects an already set up machine.

---

## Daily Use

Everything below is driven by one command, **`roborepo`** — the single front door for setup,
indexing, skills, and maintenance. It is installed and added to your `PATH` automatically by the
installer (no manual PATH step on macOS/Linux); open a new shell after the first install so it
resolves. Run `roborepo` with no arguments for an interactive menu, or call a subcommand directly
as shown below. Full reference: [roborepo CLI](../reference/roborepo.md).

### Browse and manage plan docs

Open the local portal and go to `/plans`:

```sh
roborepo web
```

The Plans page discovers Markdown files under `docs/plans/**/*.md` from configured discovery roots.
It works without enabling any workflow package: you can filter plans, open rendered Markdown, inspect
warnings/tasks, and copy repository-aware context.

Enable the Plan Docs package when you want agent workflow prompts and the `/plan-docs` slash command:

```sh
roborepo package enable plan-docs
```

Then use `/plan-docs create`, `/plan-docs start`, `/plan-docs sync`, `/plan-docs validate`,
`/plan-docs review`, or `/plan-docs handoff`.

See [Plan Docs Walkthrough](plan/lifecycle/plan-docs.md) for the full user flow.

### Index and watch a repo

Keep the package-owned code index current so Claude can navigate your codebase. Start this when opening a project you'll be actively coding in. The watcher runs continuously — edits are picked up automatically within the session.

```sh
roborepo package enable jcodemunch       # once per machine, if not already enabled
roborepo index code --watch       # watch the current dir (runs continuously)
roborepo index code path/to/dir --watch
roborepo index code path/to/dir   # one-shot index instead of watching
```

### Index docs

Index a project's documentation so Claude can search sections and headings rather than reading full files. Run once per project to initialize. After that, edits to existing files are picked up automatically via mtime detection — no manual reindex needed. Re-run only when doc files are added or deleted.

```sh
roborepo package enable jdocmunch        # once per machine, if not already enabled
roborepo index docs               # index docs in the current dir
roborepo index docs path/to/dir
```

### Add a shared skill

Use `roborepo skill new` — it scaffolds a package-owned skill resource and refreshes the shared
skill cache plus both `~/.claude/skills/<name>` and `~/.codex/skills/<name>` in one step. The
canonical source lives once in `globals/packages/<package>/skills/<name>/`. If you created a skill
out-of-band:

```sh
roborepo skill new              # scaffold + refresh shared skill cache + every harness view
roborepo skill adopt <name>     # ingest a skill created natively (init_skill.py / by hand)
roborepo skill inspect <name>   # inspect ownership, native metadata, collisions, and install state
roborepo skill native           # summarize native Claude/Codex plugin entrypoints
roborepo skill native --full    # print native help output inline
scripts/doctor.sh --installed   # verify the live skill cache and harness links are current
```

If the checkout was moved or renamed, `roborepo repair` relinks stale symlinks to the new path.
It leaves copied config files and directories alone; use `--on-conflict` only for automation or
noninteractive recovery.

If local Claude/Codex settings were damaged by an older update, use
`roborepo maintenance repair local-config --dry-run` to inspect recoverable settings, then
`roborepo maintenance repair local-config --apply` to restore them after repair backups are written.

### Edit global rules

Global instruction files are generated tracked outputs:

- `generated/claude/CLAUDE.md`
- `generated/codex/AGENTS.md`
- `generated/gemini/GEMINI.md`

Edit source fragments instead:

- `globals/system/rules/shared/` for behavior shared by every harness
- `globals/system/rules/<harness-id>/` for behavior specific to one harness
  (`claude/`, `codex/`; add `gemini/` if Gemini ever needs its own fragments)

Shared fragments render into every managed harness. A per-harness directory is created only when
that harness needs rules the others should not get.

Then render and check:

```sh
./scripts/build/render-rules.sh
./scripts/build/render-rules.sh --check
```

### Check harness health

Something feels off — commands missing, config not loading, hooks not firing. Run this to verify key files, JSON/TOML config, helpers, and dependencies. The skill checks are derived from `globals/system/skills/` and `globals/packages/*/skills/`, so adding a skill needs no edit here.

```sh
roborepo doctor        # concise health summary
roborepo doctor --verbose  # include every passing check
scripts/doctor.sh --installed     # also checks global ~/.claude·~/.codex links and managed skills
scripts/doctor.sh --installed --verbose  # include every passing check
```

`doctor.sh` is concise by default; `--verbose` prints every passing check. `verify-install.sh`,
`test-roborepo.sh`, and `link-skills.sh` accept `--quiet`/`-q` — prints only failures plus a
summary line, exit code unchanged. Prefer those flags over piping a checker through `grep`/`head`.

### Run noisy commands with trimmed output

Some commands flood the terminal. Wrap them to get only the useful tail.

```sh
roborepo run <command> [args]
```

---

## Windows

Git Bash is required — hook scripts and bin commands are bash and will not run without it.

**Requirements:**

- **Git for Windows** (https://git-scm.com) — install this first; provides Git Bash
- **Windows Developer Mode** or **admin PowerShell** — required for symlinks (`Settings > System > For Developers > Developer Mode`)

**Install from Git Bash:**

```bash
./scripts/install/main.sh
```

**Config paths on Windows:**

| Item          | Path                    |
| ------------- | ----------------------- |
| Claude config | `%APPDATA%\Claude\`     |
| Codex config  | `%USERPROFILE%\.codex\` |

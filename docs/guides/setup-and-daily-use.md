# Setup and Daily Use

This repo owns your agent harness config (Claude Code, Codex) and exposes it at the paths agents already read. Setup installs the core once, then starts the onboarding wizard so you can choose which behaviors you want on that machine.

For install workflow tradeoffs, see [install-workflows.md](install-workflows.md). For system details, see [../reference/services/architecture.md](../reference/services/architecture.md).

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

This installs the core CLI plus the shared baseline. It detects which harnesses are installed (Claude Code, Codex, or both), installs the core-managed links and baselines, exports mutable root config as local files, installs global commands, and adds shell snippets to your profile.

Interactive install starts onboarding after the core install completes. If you skip it, or if install ran noninteractively, run:

```sh
roborepo onboard
```

That workflow turns on or skips optional behavior packages such as skills, hooks, commands, rules, MCP defaults, permissions, and telemetry. Re-running `roborepo onboard` later shows selected options checked and unselected options unchecked.

The installer has two install modes. See [install-workflows.md](install-workflows.md) for the step-by-step flow and the collision behavior.

- `managed`: repo defaults win. Existing non-empty config is backed up first, then the repo version is installed.
- `adopt`: local root config stays active. Collisions offer overwrite or keep-originals handling, and the merge prompt prints after the action.

Root config export is only automatic when the target path is missing, already an identical local copy, or still symlinked to this repo from an older install. The installer does not auto-merge user config or silently replace non-root conflicts. If another harness file or global command target already exists and is not managed by this repo, install stops before changing files and prints a merge prompt after the blocking action. See [Config Collision Handling](../reference/internal/config-collision-handling.md) for exact behavior.

**The script is safe to re-run** — managed links are left alone, fresh paths are linked, identical root config copies are accepted, and user-owned root config files are preserved unless you explicitly merge them later. Re-run it for a new machine, broken symlink, added harness, or new commands/snippets added to the repo.

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

This runs against temporary `HOME` directories only. See [Config Collision Handling](../reference/internal/config-collision-handling.md#validation) for what it covers.

---

## Maintenance

### Sync live config changes back to the repo

Claude Code and Codex sometimes write directly to active files under `~/.claude` or `~/.codex` during a session. Use this to review those live changes and selectively copy intentional changes back into the repo.

```sh
./scripts/sync-from-home.sh
```

For each changed item, the script shows a diff before writing to the repo. Choose `keep repo` or `overwrite repo`; merge prompts print after actions that create backups or staged defaults.

By default, sync skips root config files: `~/.claude/settings.json` and `~/.codex/config.toml`. Those files are active local files because Claude and Codex can write personal state there. Use `--include-root-config` only when you intentionally want to review and promote selected local root config changes into the repo baseline:

```sh
./scripts/sync-from-home.sh --include-root-config
```

For the decision model, see [Config Collision Handling](../reference/internal/config-collision-handling.md#sync-workflow).

### Choose Agent Permissions

Agent permission defaults start in one manifest:

```sh
roborepo permissions --profile interactive
```

Profiles live in `manifests/inventory/agent-permissions.json`. The renderer updates the generated permission block in `globals/codex/config.toml`, the shell prefix rules in `globals/codex/rules/default.rules`, and Claude `permissions.allow` / `permissions.deny` in `globals/claude/settings.json`. Existing `~/.codex/config.toml` and `~/.claude/settings.json` files are local root config, so merge/export is required before a newly rendered session profile affects an already set up machine. `~/.codex/rules` is symlinked, so generated command rules are live immediately.

During install or update, choose a profile with:

```sh
./scripts/install/main.sh --permissions readonly
./scripts/install/main.sh --permissions interactive
./scripts/install/main.sh --permissions workspace
```

Use the same profile flag through `roborepo update` after the first install:

```sh
roborepo update --permissions readonly
roborepo update --permissions interactive
roborepo update --permissions workspace
```

Profile scope:

| Scope | How to set it | What changes |
| --- | --- | --- |
| This repo baseline | `roborepo permissions --profile <name>` | Re-renders tracked `globals/*` files from `manifests/inventory/agent-permissions.json`. |
| One install/update run | `./scripts/install/main.sh --permissions <name>` or `roborepo update --permissions <name>` | Renders the chosen profile before export/link checks. |
| Existing active root config | Merge/export root config after rendering | Required because `~/.claude/settings.json` and `~/.codex/config.toml` are local active files, not symlinks. |

Per-project behavior comes from the active Claude/Codex session started in that project. This repo does not currently persist a different permission profile per consumer repo. To use different defaults for a repo, render the desired profile before installing/updating that machine's global harness config, or use the harness's own one-off launch flags for that session.

---

## Daily Use

Everything below is driven by one command, **`roborepo`** — the single front door for setup,
indexing, skills, and maintenance. It is installed and added to your `PATH` automatically by the
installer (no manual PATH step on macOS/Linux); open a new shell after the first install so it
resolves. Run `roborepo` with no arguments for an interactive menu, or call a subcommand directly
as shown below. Full reference: [roborepo CLI](../reference/services/roborepo.md).

### Index and watch a repo

Keep the jcodemunch index current so Claude can navigate your codebase. Start this when opening a project you'll be actively coding in. The watcher runs continuously — edits are picked up automatically within the session.

```sh
roborepo watch code               # watch the current dir (runs continuously)
roborepo watch code path/to/dir
roborepo index code path/to/dir   # one-shot index instead of watching
```

### Index docs

Index a project's documentation so Claude can search sections and headings rather than reading full files. Run once per project to initialize. After that, edits to existing files are picked up automatically via mtime detection — no manual reindex needed. Re-run only when doc files are added or deleted.

```sh
roborepo index docs               # index docs in the current dir
roborepo index docs path/to/dir
```

### Add a shared skill

Use `roborepo skill new` — it scaffolds, registers manifests, and fans per-skill links into
both `~/.claude/skills/<name>` and `~/.codex/skills/<name>` in one step. The canonical source
lives once in `globals/agents/skills/<name>/`. If you created a skill out-of-band:

```sh
roborepo skill new              # scaffold + fan out per-skill links to both harnesses
roborepo skill adopt <name>     # ingest a skill created natively (init_skill.py / by hand)
scripts/doctor.sh --installed   # verify live per-skill links are current
```

### Edit global rules

Global instruction files are generated tracked outputs:

- `globals/claude/CLAUDE.md`
- `globals/codex/AGENTS.md`

Edit source fragments instead:

- `globals/rules/shared/` for behavior shared by Claude and Codex
- `globals/rules/claude/` for Claude-only behavior
- `globals/rules/codex/` for Codex-only behavior

Then render and check:

```sh
./scripts/build/render-rules.sh
./scripts/build/render-rules.sh --check
```

### Check harness health

Something feels off — commands missing, config not loading, hooks not firing. Run this to verify key files, JSON/TOML config, helpers, and dependencies. The skill checks are derived from `globals/agents/skills/`, so adding a skill needs no edit here.

```sh
roborepo doctor        # (dispatches to scripts/doctor.sh)
scripts/doctor.sh --installed     # also checks the global ~/.claude·~/.codex links and per-skill links
scripts/doctor.sh --installed -q  # --quiet: failures + a one-line summary only
```

`doctor.sh`, `verify-install.sh`, `test-roborepo.sh`, and `link-skills.sh` all accept
`--quiet`/`-q` — prints only failures plus a summary line, exit code unchanged. Prefer that over
piping a checker through `grep`/`head`.

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

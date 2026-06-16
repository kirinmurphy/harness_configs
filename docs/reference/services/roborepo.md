# roborepo CLI

`roborepo` is the single command for everything a consumer of this harness does — setting up the
core install on a machine, choosing preset bundles, day-to-day indexing, working with skills, and
maintenance. It replaces the old one-off commands (`harness_helper`, `harness-run`, `jcmindex`,
`jcmwatch`, `jdmindex`, `harness-install-local-skills`), so there is one name to remember and one
entry on `PATH`.

It is a Node program invoked via the `bin/roborepo` shim, installed to `~/.local/bin/roborepo`.
`scripts/cli/main.mjs` is a thin orchestrator (usage, interactive menu, dispatch table); the
subcommand implementations live under `scripts/cli/`, one module per category:

| Module | Owns |
| --- | --- |
| `scripts/cli/skills.mjs` | `skill export-to-local`, `skill symlink-repo` |
| `scripts/cli/index.mjs` | `index code\|docs`, `watch code`, `run` |
| `scripts/cli/project-context.mjs` | `project-context inventory` (deterministic repo scan) |
| `scripts/cli/mcp.mjs` | `mcp add` (Claude + Codex registration) |
| `scripts/cli/presets.mjs` | `onboard`, `bundle status\|apply\|check\|remove` |
| `scripts/cli/telemetry.mjs` | `telemetry enable\|disable\|status\|report\|export\|serve\|purge` |
| `scripts/cli/telemetry-transcript.mjs` | parse harness transcript -> token/tool/MCP session stats |
| `scripts/cli/telemetry-analyze.mjs` | sessions, spikes, token contributors, spike-vs-normal |
| `scripts/cli/telemetry-serve.mjs` + `telemetry-dashboard.mjs` | loopback-only charting dashboard |
| `scripts/cli/paths.mjs` | shared `repoRoot` / `sharedSkillsDir` |
| `scripts/cli/skill-lib.mjs` | shared Node core (zip, prompts, symlink helpers) |

Pure `node:` built-ins — no external `zip`/`unzip`/`ln` — so it runs on macOS, Linux, and Windows
(Git Bash). On Windows without Git Bash, call the Node entry directly:
`node <repo>/scripts/cli/main.mjs <args>`.

## Install and PATH

`roborepo` is wired automatically by the installer — there is no manual PATH step on macOS/Linux.
`scripts/install/install-global-commands.sh` (run by `scripts/install/main.sh`, and again by every
`roborepo update`):

1. symlinks `bin/roborepo` into `~/.local/bin/roborepo`, and
2. appends `export PATH="${HOME}/.local/bin:${PATH}"` to your shell profile if it is not already
   present (idempotent).

Open a new shell (or `source` your profile) after the first install, then `roborepo` resolves from
anywhere.

The installer picks the profile from your `$SHELL`, choosing the file your shell actually sources
on a new terminal:

- **zsh** → `~/.zshrc`
- **bash** → `~/.bash_profile` on macOS (Terminal launches login shells), `~/.bashrc` on Linux
  (interactive shells); prefers whichever already exists
- **other** → `~/.profile` if it exists; otherwise the installer does **not** guess — it prints the
  exact line to add (e.g. `fish_add_path ~/.local/bin`) rather than writing a file the shell never
  reads

A missing profile file is created. Set `ROBOREPO_SHELL_PROFILE=/path/to/profile` to override
the choice.

Windows + PowerShell is the one case that needs a manual PATH addition (the POSIX installer cannot
edit a PowerShell profile): add `~/.local/bin` via System Environment Variables or your
`$PROFILE`, then restart the shell.

**Confirm it worked:** `roborepo doctor` checks that `roborepo` actually resolves on `PATH`, not
just that the symlink exists. If the command is installed but not yet on `PATH` (a fresh install
before opening a new shell, or a Windows manual add that hasn't taken effect), doctor prints a
`warn:` with the exact `export PATH=...` line and tells you to open a new shell. Re-run
`roborepo doctor` to verify.

## Interactive menu

Running `roborepo` with no arguments opens an interactive menu. On an interactive terminal it is
arrow-key driven (↑/↓ to move, Enter to select, Esc/`q`/Ctrl-C to cancel); on a non-interactive
terminal (a pipe, CI, a dumb terminal) it falls back to a numbered list read from stdin. Items are
grouped into sections by significance, each with a short description:

```
roborepo — choose an action:

  Setup
> update         re-apply harness config on this machine (pick up new config)

  Day to day
  index code     index this repo's code for jcodemunch
  index docs     index this repo's docs for jdocmunch
  mcp add        register an MCP server with Claude + Codex
  watch code     live-index code as files change
  project-context inventory  scan a repo and write generated project-context facts
  onboard         choose behavior bundles
  bundle status   inspect selected behavior bundles
  telemetry status  show telemetry capture state
  run            run a command with trimmed output

  Skills
  skill new      scaffold a shared skill or slash command
  skill export-to-local copy shared skills into this repo
  skill symlink-repo      symlink this repo's .agents/skills into selected agent folders
  skill symlink-globals     symlink shared skill source into global harness folders
  skill render-commands render/check slash commands

  Maintenance
  backfill       pull live config back into the repo
  doctor         health check
  verify         post-install verification
  rules          render/check generated agent rules

  Other
  help           show full usage
  exit           quit
```

## Subcommands

```
roborepo skill new [--kind=auto|skill-command|standalone] [--name=<name>] [--description=<text>]
roborepo skill export-to-local [--yes] [--on-conflict=skip|override]
roborepo skill symlink-repo      [--dry-run] [--uninstall]
roborepo skill symlink-globals     [--check]
roborepo skill render-commands [--check]

roborepo index code  [path]
roborepo index docs  [path]
roborepo mcp add <name-or-url> [--scope=user|local|project] [--name=<name>] [--dry-run] [--only-claude|--only-codex] [--skip-claude-permission]
roborepo watch code  [path]
roborepo project-context inventory [path] [--summary]
roborepo onboard
roborepo bundle status|apply|check|remove [bundle...]
roborepo telemetry enable|disable|status|report|export|purge

roborepo run <cmd> [args...]

roborepo update  [--dry-run]
roborepo backfill
roborepo doctor  [--installed]
roborepo verify
roborepo rules   [--check]
roborepo permissions [--check] [--profile <name>]

roborepo --help | -h
```

`[path]` is optional everywhere it appears: it defaults to the current directory and may be
relative or absolute — roborepo resolves it to an absolute path before use.

### Categories

- **Setup** — `update` re-applies the core harness config on this machine (re-runs managed links,
  root config export, command install, and shell install to pick up new config). The *first*
  install is the shell bootstrap `scripts/install/main.sh` — that is what puts `roborepo` on
  `PATH` — so the CLI has no separate `install` verb; once `roborepo` exists you only ever
  `update`. After that, `onboard` chooses the optional behavior bundles for this machine.
- **Day to day** — `index code|docs` are one-shot indexers; `watch code` runs a live indexer (and
  writes the pidfile the Claude SessionStart hook reads to report watcher status); `mcp add`
  registers MCP servers with Claude + Codex; `bundle` manages the optional bundle selections;
  `telemetry` enables or disables the local capture/reporting path; `run` executes a command and
  prints only a trimmed tail of its output.
- **Skills** — `skill new` scaffolds a shared automatic helper, skill-backed command, or standalone
  command and updates the relevant manifests, generated links, generated slash commands, and README
  rows. `skill export-to-local` bundles the shared skills into a `.zip` and copies them into the
  current repo's `.agents/skills` plus harness-specific skill folders with per-skill override/skip
  (override backs the old one up under `archived/`). `skill symlink-repo` symlinks the current repo's own
  `.agents/skills/<name>` into selected `.claude/skills` and/or `.codex/skills` folders, then prunes
  links whose source is gone. `.agents/skills` is the canonical project skill source because Codex
  scans it directly; Claude fan-out links point at that
  source. Existing `.claude`/`.codex` roots are used automatically; interactive runs ask before
  creating a missing root, and noninteractive runs never create missing roots. `skill symlink-globals`
  is the maintainer command for this repo: it creates/prunes
  Claude per-skill links after shared skills are added or removed, and `--check` verifies without
  changing links. `skill render-commands` renders generated slash commands from
  `manifests/inventory/slash-commands.json`, and `--check` verifies without changing files.
  See [architecture.md](architecture.md#two-skill-layers-shared-vs-internal).
- **Maintenance** — `backfill` pulls live config back into the repo; `doctor` and `verify` are
  health and post-install checks; `rules` renders generated Claude/Codex global instruction files, or
  verifies them with `--check`; `permissions` renders Claude/Codex permission outputs from
  `manifests/inventory/agent-permissions.json`.

The lifecycle verbs dispatch to `scripts/install/main.sh`, `scripts/sync-from-home.sh`,
`scripts/doctor.sh`, and `scripts/verify-install.sh`; those filenames are an internal detail.
Most maintainer-only scripts (`test-*.sh`) are intentionally not exposed through `roborepo`.
`skill symlink-globals` and `rules` are exposed because shared-skill and generated-rule editing are
documented maintainer workflows.

## Preset Onboarding

`roborepo onboard` is the machine-level chooser for behavior bundles. Interactive install starts it
after the core install completes; the CLI also gates normal commands until onboarding has completed
at least once, unless you bypass the gate for automation. Re-running the onboarding workflow shows
selected options checked and unselected options unchecked so you can turn a bundle on or off later.

`roborepo bundle status` shows which bundles are selected and whether they are applied. `check`
verifies selected bundles are still present on disk. `apply` and `remove` are the lower-level
bundle operations the onboarding flow uses; removing a bundle reverses the installed artifact for
that bundle, deleting staged updates in keep-originals mode and restoring backed-up content when an
overwrite or managed install had replaced it.

The `telemetry` bundle is selected from the same workflow. When enabled, the harness hooks call
`roborepo telemetry capture` on session/tool/prompt/stop events and append one JSON record per event
to `~/.roborepo/telemetry/spool/<harness>.jsonl`. Everything stays local — no record ever leaves the
machine, and the dashboard binds to `127.0.0.1` only.

### Record schema

Records are versioned by a `schema` field so the spool stays backward compatible. Legacy records
written before token capture have no `schema` key (treated as v1) and are metadata-only; readers count
them in event totals but skip them in token analysis. Current records are `schema: 2` and add, on top
of the v1 metadata (`ts`, `harness`, `event`, `session_id`, hashed `cwd`/repo identity, `tool`,
`prompt`):

- `tokens` — cumulative session totals at capture time: `input`, `output`, `cache_creation`,
  `cache_read`, `total`. Read from the harness transcript (`transcript_path` on hook stdin), so no
  agent-side instrumentation is needed.
- `delta_tokens` — tokens consumed since the previous capture in the same session. This is the spike
  signal: it isolates a single heavy turn from the cumulative climb.
- `tool.is_mcp` / `tool.mcp_server` — MCP attribution (parsed from `mcp__<server>__<tool>` names).
- `session` — `model`, `assistant_turns`, `tool_calls`, `mcp_calls`, `max_output_tokens`.

Per-session token cursors live under `~/.roborepo/telemetry/collector/` and back the `delta_tokens`
computation. `roborepo telemetry purge --all` removes the whole telemetry tree.

### Reports and the dashboard

`roborepo telemetry report` prints the metadata summary plus, when token-bearing records exist,
sessions ranked by tokens, detected token spikes (captures whose `delta_tokens` exceed mean + 2σ),
top token contributors by repo / tool / MCP server, and a spike-vs-normal comparison (average delta,
tool calls, and MCP rate). `roborepo telemetry export` dumps the raw spool as JSON.

`roborepo telemetry serve [--port <n>]` (default `4317`) starts a dependency-free local web dashboard
on `127.0.0.1`. It serves the same analysis as JSON and renders it with a self-contained `<canvas>`
UI: the token-delta timeline buckets to one column per pixel client-side, so dense histories with
thousands of captures stay fast and the spike threshold line stays readable. The page re-fetches every
few seconds, so a dashboard left open during a session reflects live captures.

## Permission Profiles

Agent permission profiles are defined once in `manifests/inventory/agent-permissions.json` and rendered into
Claude and Codex native config:

```sh
roborepo permissions --profile readonly
roborepo permissions --profile interactive
roborepo permissions --profile workspace
roborepo permissions --check
```

| Profile | Use when |
| --- | --- |
| `readonly` | You want inspection only and explicit approval before escapes. |
| `interactive` | You want workspace writes, shell network disabled, and prompts for escapes. |
| `workspace` | You want local workspace work without repeated prompts; blocked actions fail. |
| `networked` | You want workspace writes plus sandbox network access. |

`roborepo update --permissions <profile>` renders a profile before the update workflow. That is a
per-run choice, not a persistent per-project registry. Existing `~/.claude/settings.json` and
`~/.codex/config.toml` are active local root config files, so rendered baseline changes affect an
already installed machine only after the root config merge/export workflow.

## MCP registration

`roborepo mcp add <name-or-url>` wraps the Claude registration step and the Codex config update so
common MCP setup is repeatable instead of hand-typed. After Claude registration succeeds it also:

- adds `mcp__<name>` to `globals/claude/settings.json` so the server's tools are allowed without repeated
  approval prompts (skip with `--skip-claude-permission`), and
- adds an MCP block to `globals/codex/config.toml`.

Default target is both harnesses; `--only-claude` / `--only-codex` scope it. Presets exist for the
two bundled servers (`jcodemunch`, `jdocmunch`, both `uvx`-based); any other non-URL value is
treated as a `uvx` package, and HTTP URLs default to `--transport http` and are written to Codex as
a `url = "..."` block. Use `--dry-run` to print the exact
`claude mcp add ...` command plus the planned Claude-permission and Codex-config writes without
touching anything.

## Tests

`scripts/test/test-roborepo.sh` smoke-tests the subcommands (skill symlink-repo/symlink-globals/prune/uninstall/
conflict, `skill new` scaffolds, export/override/firewall/self-pollution guard, slash-command render checks,
`onboard`/`bundle` onboarding/apply/remove/status, `telemetry` enable/status/report, run, `mcp add` dry-runs + real
Codex/Claude writes against a throwaway harness root, lifecycle/rules dispatch, menu fallback) against throwaway
temp repos.
It touches no global state.

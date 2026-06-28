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
| `scripts/cli/telemetry.mjs` | `telemetry install\|start\|stop\|enable\|disable\|status\|report\|export\|serve\|backup\|purge\|capture` |
| `scripts/cli/telemetry-transcript.mjs` | parse harness transcript -> token/tool/MCP session stats + tool-result sizes |
| `scripts/cli/telemetry-analyze.mjs` | sessions, spikes, spike causes, token contributors, usage windows, spike-vs-normal |
| `scripts/cli/portal-server.mjs` + `scripts/portal/` | loopback-only web portal routes and static assets |
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
  onboard         run the onboarding wizard (choose behaviors per section)
  serve           open the local web portal
  telemetry enable  enable telemetry capture
  telemetry stop    stop the portal server + capture
  telemetry status  show telemetry capture state
  run            run a command with trimmed output

  Skills
  skill new      scaffold a shared skill or slash command
  skill export-to-local copy shared skills into this repo
  skill symlink-repo      symlink this repo's .agents/skills into selected agent folders
  skill symlink-globals     refresh shared skill cache + harness links in global folders
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
roborepo serve [--detach] [--no-open] [--port <n>]
roborepo telemetry install|start|stop|enable|disable|status|report|export|backup|purge

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

- **Setup** — `update` re-applies the core harness config on this machine (refreshes copied files,
  rendered rules, root config export, command install, and shell install to pick up new config).
  The *first* install is the shell bootstrap `scripts/install/main.sh` — that is what puts
  `roborepo` on `PATH` — so the CLI has no separate `install` verb; once `roborepo` exists you only
  ever `update`. After that, `onboard` runs the wizard to choose the optional behaviors for this
  machine.
- **Day to day** — `index code|docs` are one-shot indexers; `watch code` runs a live indexer (and
  writes the pidfile the Claude SessionStart hook reads to report watcher status); `mcp add`
  registers MCP servers with Claude + Codex; `bundle` manages the optional bundle selections;
  `telemetry enable`/`disable` turn capture on and off, `web` or `serve --detach` opens the
  detached portal, and `telemetry install` handles a telemetry-only install; `run` executes a
  command and prints only a trimmed tail of its output.
- **Skills** — `skill new` scaffolds a shared automatic helper, skill-backed command, or standalone
  command and updates the relevant manifests, generated links, generated slash commands, and README
  rows. `skill export-to-local` bundles the shared skills into a `.zip` and copies them into the
  current repo's `.agents/skills` plus harness-specific skill folders with per-skill override/skip
  (override backs the old one up under `archived/`). `skill symlink-repo` symlinks the current repo's own
  `.agents/skills/<name>` into selected `.claude/skills` and/or `.codex/skills` folders, then prunes
  links whose source is gone. `.agents/skills` is the canonical project skill source because Codex
  scans it directly; Claude fan-out links point at that source. Existing `.claude`/`.codex` roots
  are used automatically; interactive runs ask before creating a missing root, and noninteractive
  runs never create missing roots. `skill symlink-globals` is the maintainer command for this repo:
  it refreshes the shared skill cache and harness links after skills are added or removed, and
  `--check` verifies without changing files. `skill render-commands` renders generated slash commands from
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

`roborepo onboard` is the machine-level chooser for global harness behaviors. Interactive install
starts it after the core install completes; the CLI also gates normal commands until onboarding has
completed at least once, unless you bypass the gate for automation. Re-running it shows enabled
options checked and disabled options unchecked so you can turn a behavior on or off later.

The platform's install-time file operations (root config baselines, command links, hook links, Codex
rules) are applied internally by the install pipeline. There is no user-facing verb for them:
`roborepo update` re-applies them, `roborepo uninstall` reverses them. The internal `roborepo bundle`
verb exists only for `scripts/install/main.sh` and back-compat scripts, and is intentionally absent
from the usage and menu.

The `telemetry` bundle is selected from the same workflow. When enabled, the harness hooks call
`roborepo telemetry capture` on session/tool/prompt/stop events and append one JSON record per event
to `~/.roborepo/telemetry/spool/<harness>.jsonl`. Everything stays local — no record ever leaves the
machine, and the dashboard binds to `127.0.0.1` only.

**Opt-in by design.** A fresh install deploys the capture hooks but does NOT enable capture — the
hooks no-op until `roborepo telemetry enable` writes `~/.roborepo/telemetry/state.json {enabled:true}`.
This is deliberate: an always-on spool grows with every session, so capture is something the user
turns on and off explicitly. To keep an enabled spool bounded, each `<harness>.jsonl` is size-capped
(~25 MB): when exceeded, the oldest records are dropped and the newest ~70% kept (records are
chronological), so the file can't fill the disk.

**Lifecycle — capture and portal.** `roborepo telemetry enable` turns capture on;
`roborepo telemetry disable` turns capture off; `roborepo web` or `roborepo serve --detach`
opens the detached portal. `roborepo telemetry stop` remains a cleanup command: it kills the
detached server if present and disables capture. The detached server's PID is tracked in
`~/.local/state/roborepo/portal-server.pid`; a stale PID file (process gone) is detected and
cleaned up. `serve` alone can browse historical spool data with capture off.

**Telemetry-only install.** `roborepo telemetry install` formalizes a standalone telemetry setup
without the rest of roborepo: it symlinks `~/.local/bin/roborepo` (if not already present), writes
`state.json {enabled:true}` directly, and wires only the 5 capture hooks into `~/.claude/settings.json`
and `~/.codex/hooks.json` — none of the full operational hook set. This is the supported path for
measuring baseline token usage before adopting the full suite; upgrading is just re-running the normal
install. (Note: `telemetry enable` applies the full telemetry *preset* including operational
hooks, which is correct for a full install — `telemetry install` intentionally bypasses that.)

**Codex hook trust.** Codex only runs hooks the user has trusted. After install, the next Codex
session prompts to trust the roborepo-managed `~/.codex/hooks.json` — approve it once and capture (and
the shell-output minimization hook) fire from then on. This is normal Codex UX, not a roborepo step;
sessions started *before* the hooks were installed won't have them (Codex loads hooks at session
start), so a brand-new session is needed the first time. The install does not bypass Codex's
hook-trust gate.

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
- `last_result` / `biggest_result` — spike attribution: the size (`{tool, chars, is_error}`) of the
  tool result that most recently entered the context window, and the heaviest result of the session.
  Sizes and tool names only — result content is never stored, preserving the hash-only privacy model.
  These tie a spike back to *what* drove it (a large file read, an MCP bundle, an unbounded Bash log).

Per-session token cursors live under `~/.roborepo/telemetry/collector/` and back the `delta_tokens`
computation.

`roborepo telemetry backup` snapshots the telemetry tree to a timestamped copy under
`~/.roborepo/telemetry-backups/` (which lives *outside* the telemetry tree, so a later purge cannot
remove it). `roborepo telemetry purge --all` removes the whole telemetry tree; add `--backup` to take
that snapshot first, so a reset is recoverable.

### Reports and the dashboard

`roborepo telemetry report` prints the metadata summary plus, when token-bearing records exist:
a recent-usage estimate (trailing 5h / 7d token totals — a *local* estimate from capture deltas, not
the real server-side rate limit, which telemetry cannot see); a **spike-cause** breakdown that groups
each spike by the pattern that drove it (`mcp-bundle`, `large-file-read`, `unbounded-bash-output`,
`big-prompt`, …) with the change to make; sessions ranked by tokens; detected token spikes (captures
whose `delta_tokens` exceed mean + 2σ); top token contributors by repo / tool / MCP server; and a
spike-vs-normal comparison (average delta, tool calls, MCP rate). The spike-cause classifier keys off
`last_result` size, degrading to tool name for records that predate result-size capture.
`roborepo telemetry export` dumps the raw spool as JSON.

**Conclusions, not just data.** The report leads with a deterministic "what this means" block
(`scripts/cli/telemetry-insights.mjs`) — ranked, plain-English findings derived from threshold rules
over the analysis: native read/grep vs each MCP package's cost-per-call (agnostic — compares
`native-read` against every MCP server present, so it covers any MCP, not just jcodemunch), spike
tail-risk (a group with spike-lift ≫ baseline), the dominant cost center, runaway loops, regression,
and the heaviest single call. Per-tool cost is attributed by **result size** (`last_result.chars` →
approx tokens), not by `delta_tokens`-by-hook, which mis-credits whichever hook fired. `report --deep`
appends an optional LLM synthesis via the headless `claude -p` (the user's existing auth — no API
key); only the computed summary is sent, never raw spool/prompts/results, and it degrades to a note if
`claude` is unavailable. The dashboard mirrors all of this: a top "what this means" panel with a
"deeper read" button, a chart with per-turn-delta / cumulative-per-session / cumulative-by-tool-group
views, and flagged spikes/loops that link back to the originating chat (transcript located by session
id, heaviest turns surfaced, plus a copy-paste analysis prompt).

> Note: MCP tool attribution resolves both the prefixed wire name (`mcp__<server>__<tool>`) and the
> bare tool names Codex sometimes logs (e.g. `search_symbols`), via a known-tool table in
> `telemetry-transcript.mjs` — without it, Codex MCP usage is undercounted.

`roborepo serve [--detach] [--no-open] [--port <n>]` (default `4317`) starts a dependency-free local
web portal on `127.0.0.1` and opens `/config` by default (`--detach` forks it into the background and
writes the PID file; this is what `roborepo web` uses under the hood). It serves the same analysis as JSON and renders it with a self-contained `<canvas>`
UI: a "what's causing spikes" panel leads with the spike-cause breakdown (each row a behavior to
change), the recent-usage estimate shows in the header, and the token-delta timeline buckets to one
column per pixel client-side, so dense histories with thousands of captures stay fast and the spike
threshold line stays readable. The page re-fetches every few seconds, so a dashboard left open during
a session reflects live captures.

For demos and dashboard development, `node scripts/cli/telemetry-seed-demo.mjs` writes a set of
synthetic sessions (varied models, repos, and spike causes) to a dedicated `spool/demo.jsonl`, picked
up automatically alongside real spools; rerun with `--clear` to remove it. It never touches the real
`claude.jsonl` / `codex.jsonl` spools.

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

# Claude Hooks

System hooks are configured in `globals/system/hooks/claude/`, wired through the generated
`generated/claude/settings.json` under `"hooks"`. Package-owned hooks (JDocMunch's index check,
telemetry's capture hooks, JCodeMunch's Grep/Glob and Bash blockers) are authored under their
owning package (e.g. `globals/packages/<package>/hooks-claude.json`) and composed into the live
Claude hook config only when that package is enabled.

Hooks are organized below in two parts: **Part 1** covers behaviors Claude shares
in intent with Codex (the same goal, achieved with Claude's own mechanism), and
**Part 2** covers hooks that exist only on Claude because they act on tools or
protocols Codex does not have.

> Hooks are authored per-harness, not generated from a shared source. The format
> and output protocols differ enough (Claude emits JSON-control output; Codex emits
> plain text) that the handful of shared behaviors are duplicated by hand rather than
> rendered. See [harnesses-explained.md](../internal/harnesses-explained.md#2-hooks--reacting-to-events).

---

## Part 1 — Common (shared intent with Codex)

These cover the same goals as Codex, realized through Claude's own machinery.

### Caveman activation

Codex turns on caveman mode with a SessionStart hook. **On Claude this is not a
hook** — it comes from the `caveman` plugin (`enabledPlugins` in `settings.json`),
which installs its own SessionStart behavior. Same outcome (terse default output),
different mechanism.

### jdocmunch index check — SessionStart

**Trigger:** every new session or resume.

Checks for the `docs/.jdm-indexed` marker in the current repo. If `docs/` exists
but the marker is absent, injects a reminder to run `roborepo index docs docs/`.
If the marker is present, confirms docs are indexed. The marker is written by
`roborepo index docs` after a successful run and is excluded from git via the
global gitignore. Package-owned: authored at
`globals/packages/jdocmunch/hooks-claude.json` and composed into the live Claude
hook config only when `jdocmunch` is enabled.

This is the one hook duplicated near-identically on both harnesses — only the
output protocol differs (JSON `systemMessage` here, plain text on Codex).

### Telemetry capture — SessionStart / PreToolUse / PostToolUse / UserPromptSubmit / Stop

When telemetry is enabled, these hook events call `roborepo telemetry capture`
and append JSON records into `~/.roborepo/telemetry`. Records are tagged with
repo and harness context (hashed, not raw conversation text) and, from the
transcript, cumulative + per-capture token usage, tool/MCP attribution, tool-result
sizes (for spike attribution — sizes only, never content), and session counts —
enough to analyze token spikes and what caused them over time. See the
[roborepo service doc](roborepo.md) for the record schema and the dashboard.
Package-owned: authored at `globals/packages/telemetry/hooks-claude.json` and
composed into the live Claude hook config only when telemetry is enabled —
disabling telemetry removes these hooks.

---

## Part 2 — Claude-specific

These act on tools or output protocols that exist only on Claude.

### jcodemunch status — SessionStart

**Trigger:** every new session or resume.

Checks whether the code watcher (`roborepo index code --watch`) is running for the current
directory by looking for a pidfile at `/tmp/jcmwatch-<md5-of-pwd>.pid` and verifying
the pid is alive. Injects a system message telling the model either:

- index is current (watch is running) — no manual reindex needed
- watch is not running — suggests `roborepo index code` if the index may be stale

Also reminds the model to use jcodemunch tools (`resolve_repo`, `search_symbols`,
etc.) for code exploration instead of `Grep`/`Read`. (Codex has no equivalent
session hook; it relies on its rules file.) The `index code` and `watch code`
commands are package-owned; enable `jcodemunch` first if the CLI reports that no
owning package is enabled. This hook is authored at
`globals/packages/jcodemunch/hooks-claude.json` and composed into the live
Claude hook config only when `jcodemunch` is enabled.

### Block Grep/Glob — PreToolUse: Grep|Glob

**Trigger:** model attempts to call `Grep` or `Glob`.

Hard-blocks the call with `"continue": false`. The stop reason instructs the model
to retry using jcodemunch (`search_symbols`, `get_file_outline`, `find_references`,
`get_context_bundle`). Treated as a redirect, not an error — the model should
immediately retry via jcodemunch. These tools do not exist on Codex. Package-owned:
authored at `globals/packages/jcodemunch/hooks-claude.json`, composed into the
live Claude hook config only when `jcodemunch` is enabled.

### Block Bash source-exploration — PreToolUse: Bash

**Trigger:** model attempts a `Bash` command. Runs **first** in the Bash chain.

`block-source-exploration.mjs` closes the route-around left by the Grep/Glob tool
block: the agent can otherwise shell out (`grep src/...`, `cat file.ts`,
`find . -name '*.ts'`) to read source without touching jcodemunch. Package-owned:
the script lives at `globals/packages/jcodemunch/hooks/block-source-exploration.mjs`
and is wired only when `jcodemunch` is enabled.

It **denies** a command only when **all** hold, and **allows** everything else:

- verb is `grep`/`rg`/`ag`/`cat`/`head`/`tail`/`find`
- there is an explicit file-path argument (no pipe anywhere in the command)
- the path is inside the repo
- the path has a source extension (`.ts`, `.py`, `.go`, …)
- the path is not under `node_modules`/`dist`/`build`/`.next`/`coverage`/`vendor`

This is **deliberately conservative ("allow when unsure")** because Bash
legitimately does things jcodemunch cannot — grep a log, cat a json/lockfile,
pipe `git log | grep`, inspect `/tmp`. Those must never be blocked. The cost is
that a determined agent can still leak (e.g. `grep` with no path argument); that
is the accepted trade for never breaking legitimate Bash work. The deny message
redirects to `search_text`, `search_symbols`, `get_file_outline`,
`find_references`, `get_context_bundle`. Ordering matters: it runs before
`minimize-bash-output.mjs` (which auto-allows bare `grep`), so its deny is final.

### Minimize Bash output — PreToolUse: Bash

**Trigger:** model attempts to call `Bash`.

Runs after the source-exploration blocker, two more commands in sequence on the
Bash chain:

- `minimize-bash-output.mjs` — normalizes the command (strips a redundant leading
  `cd <cwd> &&`, auto-allows a short list of known-safe read-only / repo-maintenance
  commands, denies `--watch`/`--verbose`/`--debug` flags, and tail-pipes noisy
  `lint`/`typecheck`/`build` output) so results stay small and don't flood context.
- `capture-dense-bash.mjs` — silent observer that logs multi-line (3+ line) Bash
  commands to `~/.claude/logs/dense-bash.jsonl` for later pattern analysis. It never
  blocks or rewrites. The log is a single persistent file that all sessions append
  to and that survives reboots; each record carries its own `session_id`. Mine it to
  find recurring dense commands worth turning into scripts, CLI subcommands, or
  allowlist entries.

### Write guard — PreToolUse: Write|Edit

**Trigger:** model attempts to `Write` or `Edit` a file under `~/.claude` or
`~/.codex`.

Runs `roborepo-write-guard.mjs`, which injects context reminding the model that
most managed assets are symlinks into this repo (edit there, commit there), that
new files should be created in the repo and linked rather than written directly into
the home dir, and that root config files (`settings.json`, `config.toml`) are
mutable machine-local copies needing the merge/export workflow. `settings.local.json`
is exempt.

---

## Reference notes

### Skill visibility

Claude documents skill invocation controls in `SKILL.md` frontmatter, including
`disable-model-invocation: true` for manual-only skills. It also has hook events
that are useful around skill workflows:

- `UserPromptExpansion` fires when a user-typed slash command expands, including
  direct skill or command invocation.
- `PreToolUse` can observe tool calls, including model-driven skill/tool paths
  where exposed by the harness.
- `MessageDisplay` can alter displayed assistant text, but does not change the
  transcript or what Claude sees.

The documented hook payloads are useful for observability and command guardrails,
but should not be treated as a portable source of truth for "which skills
auto-loaded" unless a specific skill-load event or field is available.

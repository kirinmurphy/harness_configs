# Codex Hooks

Configured in `globals/codex/hooks.json`.

Hooks are organized below in two parts: **Part 1** covers behaviors Codex shares
in intent with Claude (the same goal, achieved with Codex's own mechanism), and
**Part 2** covers what is specific to Codex — including the things Codex handles
*outside* of hooks.

> Hooks are authored per-harness, not generated from a shared source. The format
> and output protocols differ enough (Codex emits plain text with a `statusMessage`;
> Claude emits JSON-control output) that the handful of shared behaviors are
> duplicated by hand rather than rendered. See
> [harnesses-explained.md](../internal/harnesses-explained.md#2-hooks--reacting-to-events).

---

## Part 1 — Common (shared intent with Claude)

These cover the same goals as Claude, realized through Codex's own machinery.

### Caveman activation — SessionStart (startup|resume)

**Trigger:** session start or resume matching `startup|resume`.

Prints caveman mode activation instructions to stdout: drop
articles/filler/pleasantries/hedging, use fragments, keep responses terse. Code,
commits, and security output stays normal. The user can say "stop caveman" or
"normal mode" to deactivate. (On Claude the same outcome comes from the `caveman`
plugin instead of a hook.)

### jdocmunch index check — SessionStart (startup|resume)

**Trigger:** session start or resume matching `startup|resume`.

Checks for the `docs/.jdm-indexed` marker in the current repo. If `docs/` exists
but the marker is absent, prints a reminder to run `roborepo index docs docs/`.
If the marker is present, confirms docs are indexed. This is duplicated
near-identically on Claude — only the output protocol differs (plain text here,
JSON `systemMessage` on Claude).

### Telemetry capture — SessionStart / PreToolUse / PostToolUse / UserPromptSubmit / Stop

When telemetry is enabled, these hook events call `roborepo telemetry capture`
and append JSON records into `~/.roborepo/telemetry`. Records are tagged with
repo and harness context (hashed, not raw conversation text) and, from the
transcript, cumulative + per-capture token usage, tool/MCP attribution, tool-result
sizes (for spike attribution — sizes only, never content), and session counts —
enough to analyze token spikes and what caused them over time. See the
[roborepo service doc](roborepo.md) for the record schema and the dashboard.

---

## Part 2 — Codex-specific

### Shell-output minimization — PreToolUse (shell tools)

Codex **does** minimize shell output via a PreToolUse hook, parallel to Claude's
`minimize-bash-output.mjs`. `globals/codex/hooks/minimize-bash-output.mjs` acts on
Codex's shell tool (`exec_command` / `shell` / `local_shell`): it appends
`2>&1 | tail -n 120` to noisy build/lint/typecheck commands, forces
`tsc --pretty false`, and denies `--watch`/`--verbose`/`--debug` flags. Codex
PreToolUse hooks support the same `hookSpecificOutput { permissionDecision,
updatedInput }` protocol as Claude (verified against the Codex wire schema) and
receive the same `tool_name` / `tool_input` fields, so the rewrite/deny logic is
shared in intent with the Claude hook.

This was added after telemetry showed uncapped Codex shell output was the dominant
token cost (~22.8M tok of shell results vs ~49K on Claude, where this minimization
already ran).

### jcodemunch enforcement still lives in rules

Unlike Claude, Codex does not block `Grep`/`Glob` or guard writes via tool hooks —
jcodemunch enforcement in Codex relies on rules in
`globals/codex/rules/default.rules` and the generated `globals/codex/AGENTS.md`.
See [jcodemunch.md](jcodemunch.md) for full details. (Porting the
source-exploration nudge to a Codex hook is a possible future parity step; the
shell-output minimization above is the first PreToolUse enforcement hook on Codex.)

### Available events

Codex documents support for `SessionStart`, `PreToolUse`, `PermissionRequest`,
`PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStart`,
`SubagentStop`, and `Stop` events. Matchers are not honored by every event;
`UserPromptSubmit` and `Stop` ignore matcher values. Current repo config uses
`SessionStart`, `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, and `Stop` when
telemetry is enabled, plus the existing `SessionStart` caveman/jdocmunch nudges.

---

## Reference notes

### Skill visibility

Codex hook payloads include useful session, prompt, tool, and stop data, but the
documented event payloads do not expose a stable list of skills implicitly loaded
for a turn. Use hooks for prompt/tool/stop guardrails, not as the source of truth
for "which skills auto-loaded" until Codex exposes explicit skill-load metadata.

### Session permissions

Agent permission policy is authored in `manifests/inventory/agent-permissions.json` and
rendered with:

```sh
roborepo permissions
roborepo permissions --check
roborepo permissions --profile readonly
roborepo permissions --profile interactive
roborepo permissions --profile workspace
```

The manifest defines named profiles used by both Claude and Codex:

| Profile | Behavior |
| --- | --- |
| `readonly` | Read-only sandbox; Codex asks before escapes. |
| `interactive` | Workspace writes, shell network disabled, ask before escapes. |
| `workspace` | Workspace writes, shell network disabled, no approval prompts; blocked actions fail. |
| `networked` | Workspace writes with sandbox network access; ask before escapes. |

The renderer writes the generated permission block in `globals/codex/config.toml`,
the generated shell prefix rules in `globals/codex/rules/default.rules`, and Claude
`permissions.allow` / `permissions.deny` in `globals/claude/settings.json`.

Shell command prefix policy is active through `~/.codex/rules`, which is a symlink to
`globals/codex/rules`. Git remote movement is denied there with `git push` and
`git pull` prefix rules.

`~/.codex/config.toml` is different: it is an active local root config file, not a
symlink. Existing machines need the root config merge/export workflow before new
baseline session defaults appear in active Codex sessions.

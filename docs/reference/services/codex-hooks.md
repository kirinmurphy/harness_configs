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
JSON `systemMessage` on Claude). The command is package-owned; enable `jdocmunch`
first if the CLI reports that no owning package is enabled.

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

### Real per-command ask — PreToolUse (shell tools)

`globals/codex/hooks/permission-check.mjs` re-implements the manifest's command
matching at runtime and emits a genuine `permissionDecision: "ask"` for any shell
command that resolves to the `ask` bucket — closing the gap `renderCodexRules`
otherwise leaves (a `prefix_rule` can only be `forbidden`/`allow`; an ask-bucket
command gets no rule at all there). This was previously assumed impossible on
Codex; it is not. Confirmed directly against the shipped Codex 0.140 binary
(`strings` on the compiled CLI): the wire enum `PreToolUsePermissionDecisionWire`
— the one `hookSpecificOutput.permissionDecision` actually serializes to — has
three values, `allow`, `deny`, `ask`, not two. (A separate, older
`PreToolUseDecisionWire` enum with only `approve`/`block` also exists in the
binary; it is not the one hooks use.) There is also a distinct `PermissionRequest`
hook event in the wire schema, suggesting Codex may route an `ask` decision
through its own approval-prompt UI rather than a bare stdin block — worth
watching for behavior changes across Codex versions, since this was reverse-
engineered from the binary, not from published documentation.

The hook loads `manifests/inventory/agent-permissions.json` plus the personal
override file (`~/.roborepo/command-overrides.json`) directly — the same two
sources `permissions-render.mjs` renders from — so a command's classification is
identical on both harnesses without a second config to maintain. Matching is
literal-prefix on whitespace-tokenized command text, mirroring Claude's
`Bash(a b:*)` semantics. An unmatched command emits nothing and falls through to
`approval_policy` and any other `PreToolUse` hook unchanged — this hook only
adds a decision for the subset it can confidently classify, never removes one.

`globals/codex/rules/default.rules`' deny/allow entries stay in place alongside
this hook, deliberately: the rules are a sandbox-level guarantee that survives
even if a hook fails to load or errors, while the hook adds the ask tier
`prefix_rule` cannot express. Neither replaces the other.

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

Agent permission policy is authored in `manifests/inventory/agent-permissions.json` as a
flat list of **behaviors** — named (`write-files`, `delete-files`, `go-online`,
`commit-code`, `push-pull-prs`) or arbitrary (any other command) — each independently
`deny`/`ask`/`allow`. There is no profile-bundle concept anymore (a prior design with
`readonly`/`interactive`/`workspace`/`networked` presets was replaced with this flat
model). Personal overrides live in `~/.roborepo/command-overrides.json`, layered on top
of the manifest at render time so `roborepo update` never wipes a personal choice.
Rendered/checked with:

```sh
roborepo permissions
roborepo permissions --check
```

Edit behaviors and arbitrary commands via the web portal (`roborepo web`) — the only
place per-command overrides are editable; `roborepo onboard`'s Permissions step offers
the 5 named behaviors as a direct toggle, `roborepo config status` is read-only.

The renderer writes the generated permission block in `globals/codex/config.toml`
(`approval_policy`, `sandbox_mode`, `network_access` — derived from the `write-files`
and `go-online` behaviors, and from whether anything is `ask`), the generated shell
prefix rules in `globals/codex/rules/default.rules`, and Claude
`permissions.allow` / `permissions.deny` / `permissions.ask` in `globals/claude/settings.json`.

A `deny`/`allow` behavior or arbitrary command maps straight to Codex
`prefix_rule(... decision="forbidden"|"allow")` and Claude's deny/allow arrays. An
`ask`-bucket entry gets no `prefix_rule` (that mechanism is binary) — instead
`globals/codex/hooks/permission-check.mjs` (below) supplies a real per-command
`ask` decision at runtime, and `approval_policy` is set to `on-request` as a
fallback for anything the hook doesn't classify. On Claude the same entry lands
directly in `permissions.ask`.

`~/.codex/rules` is installed as a **managed copy** (`manifests/platform/manifest.tsv`,
`kind = managed_copy`), NOT a symlink — a live file that starts as a copy of
`globals/codex/rules/` but can diverge from it (e.g. the Codex CLI itself appends
"always allow this command" rules here when a user approves a prompt in a live session).
Once diverged, `roborepo update` does not silently overwrite it — reinstall only
overwrites on an explicit "overwrite" collision choice, so a diverged live file persists
indefinitely with no automated drift check today. Treat the live file as
possibly-stale relative to repo intent; `roborepo doctor`/`verify` only check repo-source
render drift (manifest vs. `globals/codex/rules/default.rules`), not live-machine drift.

`~/.codex/config.toml` is similar: it is an active local root config file, not a
symlink, and can diverge the same way. Existing machines need the root config merge/export
workflow before new baseline session defaults appear in active Codex sessions.

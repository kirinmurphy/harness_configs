---
id: package-cli-test-guide
priority: low
next_action: Wire Playwright into the repo so the browser half of the walkthrough can be automated and video-recorded
blocked_by: []
depends_on: [user-managed-packages-and-add-workflows]
related: []
reviewed_commit: b8684ef
---

# Package & User-Content CLI Test Guide

## Purpose

Roborepo lets a user add their own content — MCP servers, skills, and enabled packages —
on top of the built-in release, and manage it from a local web portal. This guide is a
hands-on walkthrough to confirm that surface actually works end to end, because it has not
yet been exercised as a real user would.

It answers one question per step: *I ran this command — did the right thing happen in the
right place?* It covers the terminal CLI first (where the content is created), then the
`roborepo web` portal (where the same content should appear and be togglable), then how to
record either one.

This is a manual test runbook, not a spec for unbuilt features. Every command here exists
in the current CLI (`manifests/platform/cli-commands.json`). The aspirational unified
`roborepo add <kind>` wizard (see `package-user-managed-and-add-workflows.md`) is **not**
built yet and is deliberately absent.

## Concept model

Three roots hold the moving parts (see
`docs/user/reference/architecture.md#install-workflow-filesystem-shapes`):

| Root | Default (package mode) | Holds |
| --- | --- | --- |
| `appRoot` | the installed release / repo checkout | built-in skills, commands, packages — immutable |
| `workspaceRoot` | `~/.roborepo/workspace` | **your** custom skills/, commands/, mcp/, packages/, overrides/ |
| `stateRoot` | `~/.roborepo` | machine state: enabled-package registry, drift hashes, telemetry |

Two live targets receive materialized config: `~/.claude` and `~/.codex`.

**Mode matters.** In a git checkout roborepo runs in *development mode* (workspaceRoot = the
checkout). To test the real user experience — a portable workspace separate from the
release — force *package mode* with `ROBOREPO_MODE=package`. This guide runs every step in
package mode inside a throwaway `HOME`, so nothing touches your real config.

The user-content surface under test:

- **MCP servers** — `roborepo mcp add`, recorded to `workspaceRoot/mcp/servers.json`,
  applied to `~/.claude` (live store + permission) and `~/.codex/config.toml`.
- **Skills** — `roborepo skill new` / `skill adopt`, sourced under `workspaceRoot/skills`,
  materialized to the skill cache and linked into both harness skill dirs.
- **Packages** — `roborepo enable` / `disable <package-id>`, wiring stored in the
  `stateRoot` enabled-package registry.
- **Portal** — `roborepo web` serves a loopback-only page (`/` and `/config`) that lists
  the above with origin/status badges and can toggle them.

## Preconditions

- Node and the `claude` CLI on `PATH` (the MCP steps shell out to real `claude mcp add`).
- A checkout of this repo to run `scripts/cli/main.mjs` from.
- No changes to your real `~/.claude`, `~/.codex`, or `~/.roborepo` — every step below sets a
  throwaway `HOME`, so the real ones are never touched.

Set up an isolated sandbox once per session. Everything after this reuses `$SBOX` and `$CLI`:

```sh
SBOX="$(mktemp -d)"
CLI="$(pwd)/scripts/cli/main.mjs"        # run from the repo checkout
mkdir -p "$SBOX/.local/bin" "$SBOX/.claude" "$SBOX/.codex"
ln -sf "$(command -v claude)" "$SBOX/.local/bin/claude"

# Everything the CLI touches is redirected into the sandbox.
export HOME="$SBOX"
export PATH="$SBOX/.local/bin:$PATH"
export ROBOREPO_MODE=package
export ROBOREPO_STATE_DIR="$SBOX/.roborepo"

alias rr="node \"$CLI\""
```

When done, `rm -rf "$SBOX"` removes everything — no cleanup inside your real config.

## Happy path

Run these in order. Each step names what to check.

### 1. Initialize the workspace

```sh
rr setup
rr version
rr workspace status
```

- `setup` should create `~/.roborepo/workspace/` with `skills/ commands/ mcp/ packages/
  overrides/` and a `workspace.json`.
- `version` should report `mode: package` and print `app root`, `workspace`, and `state`
  roots, with `workspace` under `~/.roborepo/workspace`.
- `workspace status` should echo the same three roots.

### 2. Add an MCP server

```sh
rr mcp add --dry-run myserver -- echo hi      # preview only, writes nothing
rr mcp add myserver -- echo hi                # real: shells to claude, records, applies
```

- The dry run prints the exact `claude mcp add ...` line plus the planned permission and
  Codex writes, and changes nothing.
- The real run prints `mcp-servers.json recorded: myserver`, a `permission added: mcp__myserver`
  line, and a Codex add line.

Verify each landing spot:

```sh
cat "$HOME/.roborepo/workspace/mcp/servers.json"     # record: myserver, harnesses [claude, codex]
node -e "console.log(JSON.parse(require('fs').readFileSync('$HOME/.claude/settings.json','utf8')).permissions.allow)"  # includes mcp__myserver
grep -A2 mcp_servers "$HOME/.codex/config.toml"      # [mcp_servers.myserver] block
claude mcp list | grep myserver                      # present in Claude's live store
```

The permission must land in the **active** `~/.claude/settings.json`, not any repo baseline.

### 3. Confirm no drift

```sh
rr config root inspect
```

- Claude should report `in-sync` (roborepo recorded the hash of what it just wrote).
- Codex should report `in-sync` (or `not-installed` if you skipped Codex).

A `drifted` result here means something wrote the file outside roborepo — investigate before
trusting later steps.

### 4. Add a skill

`skill new` has kinds: `skill-command` and `auto` write a real skill (`SKILL.md`);
`standalone` writes a slash command under `commands/` instead. For a skill, use
`skill-command`:

```sh
rr skill new --kind=skill-command --name=my-tester --description="Local test skill for the walkthrough."
```

- In package mode this writes source only: it should print
  `package mode: custom skill written to ~/.roborepo/workspace/skills/my-tester` and create
  `~/.roborepo/workspace/skills/my-tester/SKILL.md`.
- It is **not live yet.** Package-mode `skill new` writes portable workspace source but does
  not materialize or link it — `skill inspect my-tester` reports `skill not found` until you
  run `apply`. Materialization happens in step 6.

```sh
ls "$HOME/.roborepo/workspace/skills/my-tester/SKILL.md"   # source exists now
```

### 5. Enable and disable a built-in package

Test two shapes: a rules-only package and an MCP-backed one.

```sh
rr config status                          # lists behaviors/packages and enabled state

# Rules-only package: wiring is rendered rules.
rr enable convention-capture --dry-run    # preview the wiring
rr enable convention-capture              # renders CLAUDE.md + AGENTS.md
rr config status                          # shows enabled
rr disable convention-capture             # reverses it

# MCP-backed package: also registers the built-in MCP preset live.
rr enable jcodemunch                      # wires hooks/permissions/rules + registers the MCP preset
rr config status                          # jcodemunch shows enabled (not [partial])
rr disable jcodemunch                      # reverses it
```

`enable` updates the `stateRoot` enabled-package registry and wires the package's components.
For `jcodemunch`, the built-in MCP preset is registered live with Claude and Codex, but it is
**not** written into your workspace MCP record (`~/.roborepo/workspace/mcp/servers.json` stays
`{"servers": []}`) — built-in presets live in the app, and the workspace file is only for MCP
servers you add yourself with `mcp add`. `disable` removes only roborepo-owned wiring.

### 6. Apply and re-verify

```sh
rr apply
rr skill inspect my-tester       # now found: the skill from step 4 is materialized + linked
rr doctor --installed
```

- `apply` materializes app + workspace + state into `~/.claude` and `~/.codex` without
  downloading anything. This is what makes the step-4 skill live: it copies it to the skill
  cache and links `~/.claude/skills/my-tester` and `~/.codex/skills/my-tester`.
- `skill inspect my-tester` now resolves — before `apply` it reported not found.
- `doctor --installed` should pass: workspace skill links current, no unexpected drift.

## Verify in the browser

The portal should reflect everything created above. It binds to loopback only.

### 7. Open the portal

```sh
rr web            # starts detached server, opens the default page in a browser
# or, to see the URL without opening a browser:
rr web --detach --no-open
```

`web` prints the bound URL — loopback host, dynamic port, e.g.
`roborepo portal: http://127.0.0.1:4317  (detached · use: roborepo web stop)`. Open
`/` or `/config` there. Stop the detached server with `rr web stop`.

### 8. Check the config page

On the Config page, confirm:

- The MCP server `myserver` from step 2 appears.
- The skill `my-tester` from step 4 appears, badged as user/workspace content.
- The package toggled in step 5 shows its current enabled state.
- Origin/status badges distinguish built-in from user content.

### 9. Terminal change → browser reflects it

This is the real integration check — a change made in the terminal should show up in the
portal after a reload.

1. Leave the portal open.
2. In the terminal (same `$SBOX` env), add another server:
   ```sh
   rr mcp add secondserver -- echo hi
   ```
3. Reload the Config page. `secondserver` should now appear.
4. Toggle a package on the page, then in the terminal run `rr config status` — the toggle
   should be reflected in the CLI's enabled state too, confirming the portal and CLI share
   one source of truth.

## Recording a session

Two independent recordings, one per surface.

### Terminal — asciinema

Records the terminal as replayable text (small, copy-pasteable, not a video file):

```sh
brew install asciinema           # once
asciinema rec walkthrough.cast   # records until you exit the shell
# run the Steps above inside the recording shell, then Ctrl-D
asciinema play walkthrough.cast  # replay
```

For an actual video file instead, use the OS screen recorder (on macOS,
Shift-Cmd-5 → record a region over the terminal).

### Browser — Playwright

Playwright can open the portal URL, drive the page, and save a video of the session. It is
**not currently installed in this repo** — treat wiring it up as the follow-up task below.
The intended shape:

```js
// scratch script, run against a portal started with `rr web --detach --no-open`
const { chromium } = require("playwright");
const browser = await chromium.launch();
const context = await browser.newContext({ recordVideo: { dir: "portal-video/" } });
const page = await context.newPage();
await page.goto(process.env.PORTAL_URL);   // the URL `serve` printed
// ...assert myserver / my-tester rows are present, toggle a package...
await context.close();                      // flushes the .webm video
await browser.close();
```

Because the portal is loopback-only and prints a dynamic port, the script needs the exact
URL `serve` emitted (capture it into `PORTAL_URL`).

## Failure handling

- **`claude: command not found` during `mcp add`** — the symlink in Preconditions is missing
  or `claude` is not on the real `PATH`. Re-run the sandbox setup.
- **`config root inspect` shows `drifted`** — a file under `~/.claude`/`~/.codex` changed
  outside roborepo. In the sandbox this usually means a step wrote the active file directly;
  re-seed the sandbox and re-run from step 1.
- **Portal shows nothing / connection refused** — the server may have failed to bind; re-run
  `rr web --detach --no-open` and use the URL it prints. The port is dynamic, so do not
  assume a fixed one.
- **Skill not found after `skill new`** — expected in package mode until you run `apply`
  (step 6). `skill new` writes workspace source only; `apply` materializes and links it.
- **`enable jcodemunch` / `enable jdocmunch` crashes with `MCP server '<id>' is built in; add a
  typed mcp-server replace override`** — indicates an install predating the fix that made
  `installMcpPreset` pass `--builtin` to `mcp add` (which skips the redundant workspace record for
  a built-in preset). The current code does not hit this; if you see it, your `appRoot` is on an
  older revision — update it. A leftover `[partial]` jcodemunch from a prior failed enable clears
  with `rr disable jcodemunch` then `rr enable jcodemunch`.

## Follow-up

- Wire Playwright into the repo (add the dependency, a small runner script, and a way to
  capture the portal URL from `serve`) so the browser half of step 9 can be automated and
  video-recorded, not just done by hand.
- Once the unified `roborepo add <kind>` wizard from
  `package-user-managed-and-add-workflows.md` lands, extend the Happy Path with `add rule`,
  `add hook`, `add permission`, and the grouped `add package` flow.

## Success criteria

- A user can add an MCP server, a skill, and toggle a package entirely from the terminal,
  and each lands in the documented root and live target.
- `config root inspect` stays `in-sync` after roborepo's own writes.
- The portal lists user-added content with correct origin/status badges.
- A terminal change appears in the portal on reload, and a portal toggle appears in the
  CLI's `config status` — confirming one shared source of truth.
- Nothing in the walkthrough touches the tester's real `~/.claude`, `~/.codex`, or
  `~/.roborepo`.

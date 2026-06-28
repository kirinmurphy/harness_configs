# telemetry lifecycle: start / stop

## Problem

Current command surface exposes implementation layers as user-facing commands:
- `enable` / `disable` — toggle the capture hooks
- `serve` — start the HTTP dashboard server (foreground only)

This creates friction: two separate concerns, no way to stop the server cleanly, and orphaned processes when a terminal tab is closed. Discovered in practice: a `roborepo telemetry serve` process was running as PID 53972 (parent launchd/PID 1) with no visible terminal — orphaned from a closed tab.

## Design

Consolidate into high-level commands with composable primitives underneath:

| command | does |
|---|---|
| `roborepo telemetry start` | retired; use `roborepo telemetry enable` plus `roborepo web` |
| `roborepo telemetry stop` | stop detached server + disable capture |
| `roborepo telemetry serve [--detach]` | just the server (historical browsing with capture off) |
| `roborepo telemetry enable` / `disable` | just the capture toggle (power-user escape hatch) |

`start` was later retired. `web`/`serve` and `enable`/`disable` are the composable primitives.

`stop` is unambiguous: it stops the whole system, not just one layer.

### Why not merge enable into serve entirely?

One real use case for running serve without enable: inspecting historical spool data after disabling capture. Rare but valid. Keeping them as separate primitives under the hood lets `start`/`stop` compose them cleanly.

## Implementation

### PID file
- Location: `~/.local/state/roborepo/telemetry-server.pid`
- Written by `serve --detach` after the child process is forked
- Read by `stop` to find and kill the server
- Cleared on clean exit (SIGTERM handler in the server)

### `telemetry start` (retired)
1. Run `telemetry enable` (idempotent if already enabled)
2. Check PID file — if an existing server is running, kill it (picks up code changes on restart)
3. Fork `roborepo telemetry serve --detach`, write PID file
4. Print: `telemetry: capturing · dashboard: http://127.0.0.1:4317`

### `telemetry stop`
1. Read PID file, kill the server process (SIGTERM), remove PID file
2. Run `telemetry disable`
3. Print: `telemetry: disabled · server stopped`

### `serve --detach`
- Double-fork (or `child_process.spawn` with `detached: true`, `stdio: 'ignore'`, `unref()`)
- Parent writes PID to file and exits
- Child runs the server loop
- Child registers SIGTERM handler to remove PID file on clean shutdown

### Stale PID handling
- On `start` or `serve --detach`: if PID file exists but process is not running, remove stale file and proceed
- On `stop`: if PID file missing or process not running, print a note and still run `disable`

## CLI manifest changes
- Add `telemetry start` and `telemetry stop` to usage and menu. `start` was retired later.
- Keep `serve`, `enable`, `disable` in usage.

## Telemetry-only install mode

A `--telemetry-only` install formalizes what the shim does today — reproducibly and on demand. Useful for:
- Measuring baseline usage before deciding on full roborepo
- Any Claude/Codex user who wants token visibility without the full suite
- The upgrade path is just re-running install without the flag

**Decision:** `roborepo telemetry install` — keeps everything under `telemetry`, doesn't require a new top-level command, explicit.

**What `--telemetry-only` does** (same as the shim, but automated):
1. Symlink `~/.local/bin/roborepo` → repo bin (if not already present)
2. Write `~/.roborepo/telemetry/state.json` with `{"enabled": true}` directly (bypasses `enable`'s preset side effects)
3. Wire only the 5 capture hooks into `~/.claude/settings.json` and `~/.codex/hooks.json` (not the full operational hook set)
4. Print the URL and instructions

**Historical note:** `telemetry start` called `telemetry enable` and launched the portal. It was retired so enabling capture and opening the portal stay separate.

## Status
- [x] implement `serve --detach` with PID file
- [x] implement `telemetry start` (retired later)
- [x] implement `telemetry stop`
- [x] decide and implement `--telemetry-only` install mode (`roborepo telemetry install`)
- [x] update CLI manifest
- [x] test orphan detection / stale PID cleanup (`scripts/test/test-telemetry-pid.sh`, 6/6)

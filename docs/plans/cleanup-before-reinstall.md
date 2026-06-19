# Cleanup Before Reinstall — Checklist

Quick reference for getting home dirs to a clean state before running the full
roborepo install. The "uninstall to test from scratch" left shim artifacts and
one stale skill behind. Do these steps **before** `main.sh` so the installer
writes onto clean state instead of fighting hand-made files.

Full rationale for the telemetry pieces lives in
[`telemetry-standalone-revert.md`](telemetry-standalone-revert.md). This file is
the short checklist.

## What's actually left in home dirs

| Path | What it is | Action |
|------|-----------|--------|
| `~/.claude/settings.json` | Shim: 5 telemetry capture hooks only | **remove** — installer re-renders full version |
| `~/.codex/hooks.json` | Shim: 5 capture hooks only | **remove** — installer re-renders |
| `~/.codex/config.toml` | Got a `[features] hooks=true` block prepended | **edit** — drop the block (keep project/nux entries) |
| `~/.local/bin/roborepo` | Symlink → repo bin | leave (installer overwrites) or remove for clean slate |
| `~/.roborepo/telemetry/` | Hand-written `state.json` + captured baseline data | **decide**: keep (backup first) or purge |
| `~/.agents/skills/blog/` | Stale repo skill (real dir, not symlink) — leftover, not a manual add | **remove** — installer re-links it |
| `~/.claude/settings.local.json` | Your 2 permissions, untouched by shim | **leave** |
| `~/.claude/telemetry/*.json` | Anthropic's own `1p_failed_events` — not roborepo | leave (vendor) |
| `~/.codex/skills/.system/*` | Codex built-in skills — not roborepo | leave (vendor) |

## Steps

### 1. Decide fate of baseline telemetry data

Lives in `~/.roborepo/telemetry/spool/`.

- **Keep** (compare baseline vs post-install) — back up first; `purge --all` nukes the dir:
  ```bash
  roborepo telemetry backup   # snapshots to ~/.roborepo/telemetry-backups/ (outside purge target)
  ```
- **Discard**:
  ```bash
  roborepo telemetry purge --all
  ```

### 2. Remove shim harness configs

```bash
rm -f ~/.claude/settings.json     # shim-only; installer re-renders full version
rm -f ~/.codex/hooks.json         # shim-only; installer re-renders full version
```

Then edit `~/.codex/config.toml` — remove the prepended block, keep everything else:

```toml
[features]
hooks = true
```

### 3. Remove stale skill leftover

```bash
rm -rf ~/.agents/skills/blog      # repo ships this; installer re-links it
```

### 4. (Optional) Remove bin symlink

Skip if installing immediately — installer overwrites it.

```bash
rm -f ~/.local/bin/roborepo
```

### 5. Run full install

```bash
cd <repo>
./scripts/install/main.sh
```

## Verify clean → installed

```bash
ls ~/.roborepo/install-state.json     # should EXIST (proves real install ran)
roborepo telemetry status             # enabled + paths

# settings.json should match the full rendered version, NOT the 5-hook shim:
diff <(cat ~/.claude/settings.json) <(cat <repo>/globals/claude/settings.json)
```

If `install-state.json` exists and `settings.json` carries the full hook set
(jcodemunch nudges, block-source-exploration, write-guard), the shim is gone and
the real install owns these files.

## After install — telemetry via the real path

```bash
roborepo telemetry enable    # writes state + applies telemetry/hooks preset
roborepo telemetry serve     # dashboard
roborepo telemetry report    # terminal report
```

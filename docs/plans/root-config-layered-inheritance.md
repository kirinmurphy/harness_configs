# Root Config Layered Inheritance

> Status: designed. Implementation not started. This design keeps `~/.claude/settings.json`
> and `~/.codex/config.toml` user-owned while giving roborepo a managed baseline that can be
> updated, repaired, and audited without flattening local edits.

## Problem

Roborepo currently exports root harness config as active local files. That makes install/update
simple, but repo defaults and machine-local edits share one file. A repo update that changes
permissions, hooks, MCP, plugin defaults, or Codex config can collide with user-owned edits.

Harnesses do not currently provide a portable, documented root-config include mechanism that
works for both Claude `settings.json` and Codex `config.toml`. Until they do, roborepo should
own a generated merge layer rather than pretending the active file is purely managed.

## Layers

1. **Repo baseline**
   - Source: `globals/claude/settings.json`, `globals/codex/config.toml`.
   - Owner: roborepo.
   - Purpose: portable defaults, package-managed permissions/hooks/MCP/plugin entries.
2. **Machine overlay**
   - Source: `~/.roborepo/config-overrides/claude.settings.json` and
     `~/.roborepo/config-overrides/codex.config.toml`.
   - Owner: user.
   - Purpose: secrets, local paths, native marketplace state, trust approvals, one-machine
     defaults, and anything roborepo should not copy back to the repo.
3. **Generated active root config**
   - Target: `~/.claude/settings.json`, `~/.codex/config.toml`.
   - Owner: roborepo only inside managed keys/blocks; user-owned keys are preserved through the
     overlay.
   - Purpose: what harnesses actually read today.
4. **Project-local overrides**
   - Source: repo-local `.claude/settings.json`, `.codex/config.toml`, `CLAUDE.md`, `AGENTS.md`,
     and project skills.
   - Owner: the project.
   - Purpose: project behavior. These never rewrite the global baseline or machine overlay.

## Merge Policy

- JSON (`settings.json`) merges by object key.
- TOML (`config.toml`) merges by table/key.
- Arrays are replace-by-owner unless a path has a declared set-like strategy.
- Set-like paths:
  - Claude `permissions.allow`, `permissions.deny`
  - Claude hook command arrays under `hooks.*`
  - MCP server maps by server name
  - Plugin marketplace maps by marketplace id
- Unknown keys are preserved in the machine overlay and emitted unchanged.
- Secrets and machine-local absolute paths must live in the overlay, not the repo baseline.
- Managed output carries a roborepo metadata sidecar:
  `~/.roborepo/config-state/root-config.json`.

## State Sidecar

The sidecar records:

- source repo path and repo revision/hash when available
- baseline content hash
- overlay content hash
- generated active file hash
- managed key paths
- conflict decisions from `onConflict`
- harness versions if detectable

The sidecar is the drift check. If the active file differs from the last generated hash, `update`
does not clobber it. It reports that the active file has user edits and offers to move them into
the overlay or keep the active file as-is.

## Update

`roborepo update` should:

1. Load repo baseline.
2. Load machine overlay if present.
3. If active root config matches the sidecar hash, regenerate active config.
4. If active root config has drift:
   - `onConflict=keep`: preserve active file, report blocked root-config layer.
   - `onConflict=abort`: stop before writing root config.
   - `onConflict=overwrite`: archive active file, regenerate from baseline + overlay.
5. Never move active-file drift into the repo baseline automatically.

## Repair

`roborepo repair` should refresh generated active config when the sidecar proves the active file is
owned by the previous install. It should preserve the machine overlay and recompute paths that
depend on the checkout location.

## Uninstall

`roborepo uninstall` should remove only generated active files that still match the sidecar hash.
If a user edited the active file after generation, uninstall leaves it in place and reports the
path. The machine overlay remains user-owned unless the user explicitly requests removal.

## Project-Local Overrides

Project-local config remains a separate harness-native layer. Roborepo should report it in
`roborepo config` and the portal, but global update/repair must not merge project config into
global root config.

## onConflict

`onConflict` applies only to active root config writes:

- `keep`: keep active file, do not regenerate, report pending merge.
- `abort`: exit non-zero before writing.
- `overwrite`: archive active file under `~/.roborepo/backups/root-config/`, then regenerate.

Overlay files are never overwritten by `onConflict`; they are user-owned inputs.

## Native Includes

If Claude or Codex later ship native includes/imports for root config, roborepo can replace the
generated active file with a thin include file. The same layer ownership still applies:
repo baseline remains managed, machine overlay remains user-owned, and project-local overrides
remain project-owned.

## Implementation Steps

1. Add parsers/serializers for Claude JSON and Codex TOML that preserve unknown user keys.
2. Add root-config sidecar read/write and drift checks.
3. Add `roborepo config root inspect` or equivalent read-only report.
4. Teach install/update/repair to generate active root config from baseline + overlay.
5. Teach uninstall to remove only sidecar-matching generated files.
6. Add portal visibility for baseline, overlay, active file, and drift state.
7. Document migration from the current flat active-file model.

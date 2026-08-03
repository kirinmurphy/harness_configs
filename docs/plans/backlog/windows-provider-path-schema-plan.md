---
id: windows-provider-path-schema
priority: low
next_action: Add a `platforms.win32` path-override shape to the provider manifest schema (scripts/harnesses/provider-manifest.schema.json) that supports absolute environment-variable-rooted paths, not just `~`-relative ones, then update scripts/harnesses/paths.mjs's expandHome() to resolve it.
blocked_by:
  - discoverable-harness-provider-architecture-plan
depends_on: []
related:
  - discoverable-harness-provider-architecture-plan
reviewed_commit:
---

# Windows Provider Path Schema

## Summary

`install-windows.ps1` (Phase 4 of `discoverable-harness-provider-architecture-plan.md`) still
hardcodes Claude's Windows home as `%APPDATA%\Claude` and Codex's as `%USERPROFILE%\.codex` in a
`Resolve-ManifestHomeRoot` switch statement, rather than deriving them from the Node provider
registry the way the bash installers derive `~/.claude`/`~/.codex` from `harness_detected_rows`
(`roborepo harness detected`, backed by `scripts/harnesses/paths.mjs`'s `resolveHarnessPath`).

## Current State

`scripts/harnesses/paths.mjs`'s `expandHome()` only understands `~`-relative paths
(`path.join(os.homedir(), homeRelativePath.slice(2))`). Claude's Windows install location is not
`~`-relative at all — `%APPDATA%\Claude` is rooted at a different environment variable
(`APPDATA`, not `USERPROFILE`/home), so there's no way to express it in the current manifest
`paths` shape even with a per-platform override, because the override mechanism
(`manifest.platforms?.[platform]?.paths`) still assumes every path is `~`-relative and only lets a
platform override *which* `~`-relative path string is used.

## Why This Was Deferred

Fixing this properly needs two changes together: a new path-expansion form (e.g. a
`{ "envVar": "APPDATA", "path": "Claude" }` shape, or a documented "path strings starting with a
recognized env-var token expand against that var instead of home" convention) in both the JSON
schema and `expandHome()`, plus updating Claude's `provider.json` to declare it. That's a real
provider-manifest contract change, not a mechanical "swap the source" refactor like the rest of
Phase 4's install-script work, and no Windows machine was available in the session that did the
rest of Phase 4 to validate the change end to end. Bundling it into that pass would have meant an
unverified schema change landing alongside already-tested bash logic.

## Goals

- `scripts/harnesses/paths.mjs`'s `resolveHarnessPath`/`resolveHarnessPaths` correctly resolve
  Claude's Windows home without any Windows-specific code outside the manifest + `paths.mjs`.
- `install-windows.ps1`'s `Resolve-ManifestHomeRoot` becomes a thin PowerShell wrapper that shells
  to `roborepo harness detected` (mirroring the bash installers) instead of its own switch
  statement, once the underlying path can be resolved correctly by that command on Windows.

## Implementation Plan

- Add an `envVar`-rooted path form to `scripts/harnesses/provider-manifest.schema.json`.
- Extend `expandHome()` (or add a sibling resolver) in `scripts/harnesses/paths.mjs` to handle it,
  with a unit test pinning both the `~`-relative and `envVar`-rooted resolution paths.
- Add `platforms.win32.paths.home` (and any other Windows-specific paths, if they diverge) to
  `globals/harnesses/claude/provider.json`.
- Update `install-windows.ps1`'s `Resolve-ManifestHomeRoot` to shell to
  `node scripts/cli/main.mjs harness detected` and parse its home-path column, replacing the
  hardcoded switch — mirroring `scripts/lib/manifests-data.sh`'s `harness_present`/
  `harness_detected_rows` bash pattern.

## Validation

- `node scripts/test/harness-manifest-check.mjs` (extend with a Windows-platform-override case).
- Manual verification on an actual Windows machine or CI Windows runner — this repo's test suite
  (`test-roborepo.sh`) is bash-only and cannot exercise `install-windows.ps1` directly; the Phase 4
  pass that touched this file could only verify via PowerShell 7 parsing + isolated logic dry-runs
  on macOS, not a real install.

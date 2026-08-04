---
id: antigravity-cli-provider-integration
priority: high
next_action: Decide whether Antigravity registers as a new provider or repoints the existing gemini one, then confirm the four unverified capability paths against a live authenticated agy install
blocked_by: []
depends_on:
  - discoverable-harness-provider-architecture
related:
  - gemini-cli-provider-integration
  - harness-capability-derived-resource-targeting
reviewed_commit: 198c91e
---

# Antigravity CLI Provider Integration

## Summary

Google deprecated the Gemini CLI for individual Code Assist accounts and replaced it with
**Antigravity CLI** (`agy`). The old `gemini` binary now fails at authentication with a message
directing users to migrate. roborepo's `gemini` provider still writes to the old CLI's paths, and
**three of its six declared paths are wrong for `agy`** — the artifacts land on disk but the new CLI
never reads them.

This is the first real test of the discoverable-provider architecture against a *harness that
changed under us*, rather than a new one being added. The abstraction holds: every wrong path is a
string in one manifest, and no platform code hardcodes `~/.gemini`. But the fix needs a decision
about identity (one provider repointed, or two coexisting) that should not be made silently.

## Current State

### What broke

`gemini` 0.53.1 is installed and authenticates no further:

```
Failed to sign in. This client is no longer supported for Gemini Code Assist for individuals.
To continue using Gemini, please migrate to the Antigravity suite of products.
```

`agy` 1.1.10 is installed at `/usr/local/bin/agy` (Homebrew cask `antigravity-cli`). It is a
**separate binary**, not an upgrade in place — both can exist simultaneously.

### Path comparison

Verified against the `agy` binary's own embedded strings and Google's published docs. Rows marked
UNVERIFIED could not be confirmed: `agy` requires interactive OAuth, which blocked runtime probing.

| Capability | roborepo writes today | `agy` reads | Status |
| --- | --- | --- | --- |
| `skills` | `~/.gemini/skills/` | `~/.gemini/config/skills/` | **Wrong** |
| `mcp` | `mcpServers` key inside `~/.gemini/settings.json` | `~/.gemini/config/mcp_config.json` | **Wrong** |
| `rootConfig` | `~/.gemini/settings.json` | `~/.gemini/antigravity-cli/settings.json` | **Wrong** |
| `rules` | `~/.gemini/GEMINI.md` | reads both `GEMINI.md` and `AGENTS.md` | Works |
| `commands` | `~/.gemini/commands/` | UNVERIFIED | Unknown |
| `permissions` | `~/.gemini/policies/*.toml` | `toolPermission` key in settings.json | **Likely wrong** |
| `hooks` | embedded in `~/.gemini/settings.json` | `hooks.json` (plugin-scoped) | **Likely wrong** |

Evidence for each confirmed row:

- **Binary strings** (`strings /usr/local/bin/agy`) contain `.gemini/antigravity-cli/settings.json`,
  `.gemini/config/mcp_config.json`, `.gemini/config/`, `.gemini/antigravity/artifacts`, and
  `.gemini/antigravity/transcript.jsonl`. They do **not** contain `.gemini/skills` or
  `.gemini/policies`.
- **Skills location** was established empirically by a third party who tested all four candidate
  paths across AGY, AGY CLI, and AGY IDE, and found `~/.gemini/config/skills/` the only one all
  three recognize. Workspace scope is `<workspace-root>/.agents/skills/`.
- **Rules** is the one capability that already works: `agy` reads `GEMINI.md` and `AGENTS.md`, so the
  rendered rules file is picked up with no change.

### What this does NOT affect

The deprecation broke authentication only. Every artifact roborepo rendered is still on disk and
still valid; nothing was corrupted. The `~/.gemini` base directory is unchanged — Antigravity
*added* subdirectories under it rather than moving elsewhere.

Because the harness-abstraction work in `198c91e` removed every hardcoded `~/.gemini` from platform
code, the blast radius is confined to `globals/harnesses/gemini/provider.json` plus one adapter
concern (MCP storage mode). No delivery loop, shell script, or doctor check needs to change.

## Goals

- Deliver every capability to a machine running `agy`, at paths it actually reads.
- Keep a coherent identity model: a user should be able to tell which harness is being managed.
- Do not silently break machines still running the old `gemini` CLI.
- Add a new MCP storage mode without special-casing it in platform code.

## Non-Goals

- Supporting the Antigravity IDE or SDK as separate harnesses. They share `~/.gemini/config/`, so
  correct CLI paths benefit them incidentally; modeling them is out of scope.
- Migrating existing `~/.gemini/skills/` content. Users who never authenticate to `agy` are
  unaffected, and a move is reversible.
- The plugin system (`~/.gemini/antigravity-cli/plugins/<name>/`). It bundles skills, hooks, rules,
  MCP, and subagents into one deployable unit and is a plausible *better* delivery target than
  loose files — but it is a distinct design question, deferred to its own plan.

## Open Decision — provider identity

This is the blocking question and should be settled before implementation.

### Option A — register `antigravity` as a new provider (recommended)

A new `globals/harnesses/antigravity/provider.json` + `scripts/harnesses/antigravity/index.mjs`,
registered alongside `claude`, `codex`, and `gemini`.

- Both CLIs coexist on a machine and each gets correct paths.
- `gemini` keeps working for anyone on the old CLI.
- Discovery distinguishes them: `agy` vs `gemini` executables, `antigravity-cli/settings.json` vs
  `settings.json` config candidates.
- Cost: a manifest, an adapter, a registry entry, and Windows-installer entries — the standard
  6-step walkthrough in the provider interface guide. `windows-installer-check.ps1` will fail CI
  until the PowerShell side is updated, which is the intended forcing function.
- Risk: two providers both rooted at `~/.gemini` write near each other. Skills at
  `~/.gemini/skills/` (gemini) and `~/.gemini/config/skills/` (antigravity) do not collide, but
  `doctor`'s orphan detection should be checked against having both present.

### Option B — repoint the existing `gemini` provider

Edit `gemini`'s manifest paths to Antigravity's locations.

- Smallest diff: six strings plus the MCP storage mode.
- Breaks roborepo for anyone still on the old `gemini` CLI, with no migration path.
- `id: "gemini"` / `displayName: "Gemini CLI"` become misleading for a binary named `agy`.
- Loses the ability to detect which CLI is actually installed.

**Recommendation: Option A.** The two binaries genuinely coexist, so modeling them as one provider
throws away information roborepo's discovery model is built to capture. Option B is only preferable
if the old CLI is confirmed fully dead for all account types, which is not established — the
deprecation notice named individual Code Assist accounts specifically.

## Proposed Design

### New MCP storage mode

`gemini`'s adapter declares `mcpStorage: "json-mcpServers-key"`, meaning MCP servers live under a
key *inside* the root config. Antigravity puts them in a **separate file**
(`~/.gemini/config/mcp_config.json`) that is shared across CLI, IDE, and SDK.

This needs a new mode — proposed `"json-sidecar-mcpservers-file"` — plus a `mcpConfig` entry in the
manifest's `paths` block. The adapter's `addServer`/`removeServer`/`list` then read and write that
file instead of the root config. The existing Gemini implementation is close: same `mcpServers`
object shape, different container file.

### Permissions

Antigravity's `settings.json` exposes `toolPermission` with values `request-review` (default),
`proceed-in-sandbox`, `strict`, and `always-proceed`. That is a **coarse global mode**, not a
per-tool allow/ask/deny policy like Gemini's Policy Engine TOML.

If that is the only control, roborepo's per-behavior permission manifest has no faithful target and
the provider should **not declare the `permissions` capability** — the same honest-absence posture
Gemini takes toward telemetry today. Declaring it and rendering a lossy approximation would be
worse than not declaring it. Confirm against a live install before deciding.

### Capabilities to declare

Pending verification, the likely set is `root-config`, `rules`, `skills`, `mcp`, and possibly
`slash-commands` and `hooks`. Notably **not** the telemetry capabilities, and probably not
`permissions`.

## Implementation Plan

### Phase 0 — Verification (blocking)

Requires an authenticated `agy` session; interactive OAuth blocked this during research.

1. Confirm the global slash-commands path, if one exists. `commands/` appears in the binary but
   unscoped.
2. Confirm whether `toolPermission` is the only permission control, or whether a per-tool policy
   exists.
3. Confirm hooks scope — the docs describe `hooks.json` inside plugin bundles; determine whether a
   global non-plugin hooks file is supported.
4. Confirm whether `agy` reads a global `AGENTS.md`/`GEMINI.md` from `~/.gemini/` specifically, or
   only from the workspace root. The rules row above assumes global works; verify it.

### Phase 1 — Decision

Settle Option A vs B. Everything downstream depends on it.

### Phase 2 — Manifest and adapter

Write the manifest with verified paths. Implement the adapter, reusing Gemini's root-config merge
(same JSON shape) and MCP server shape. Register in `registry.mjs`.

### Phase 3 — MCP sidecar storage mode

Add the new storage mode and `mcpConfig` path key. Extend
`mcp-add-characterization-check.mjs` to pin the sidecar file's on-disk shape, mirroring how the
Gemini case pins `mcpServers` inside `settings.json`.

### Phase 4 — Windows installer

Add the provider to `$KnownHarnessIds`, `$adoptRootConfig`, `Resolve-ManifestHomeRoot`, and
`$HarnessDisplayNames`. `scripts/test/windows-installer-check.ps1` fails CI until this is done.

### Phase 5 — Docs

Update `docs/guides/harnesses/supported-harnesses.md`'s capability matrix and harness table. If
Option A, note that `gemini` is deprecated upstream and which one a user should install.

## Verification

- `npm test` — `delivery-synthetic-provider-check.mjs` should pass **unmodified**. Needing to edit it
  means a fixed-provider assumption was reintroduced.
- `bash scripts/doctor.sh` — manifest validity, registry construction, capability/path coherence.
- `pwsh -File scripts/test/windows-installer-check.ps1` — harness-list parity.
- `roborepo harness inspect antigravity` — manifest and capabilities as roborepo sees them.
- Manual: run `agy` and confirm it loads a roborepo-delivered skill and the rendered rules.

## Risks

- **Paths are still moving.** Antigravity shipped recently; the community already documented one
  case where official docs named a skills path that does not work. Prefer empirical verification
  over docs, and record the evidence for each path in the manifest's comments.
- **Two providers under one home dir.** If Option A, verify `doctor`'s orphan detection and
  `withdraw` behave correctly with both `gemini` and `antigravity` present.
- **Plugin system may supersede loose files.** If Antigravity pushes toward plugin bundles as the
  supported extension path, per-capability file delivery could become the unsupported route. Worth
  a look during Phase 0 before investing in the loose-file approach.

## Sources

- `strings /usr/local/bin/agy` (Antigravity CLI 1.1.10) — authoritative for embedded paths
- [Antigravity CLI settings docs](https://antigravity.google/docs/cli/settings)
- [Antigravity CLI features docs](https://antigravity.google/docs/cli/features)
- [Where Antigravity Looks for Agent Skills](https://atamel.dev/posts/2026/07-01_where_agy_agent_skills/) — empirical skills-path testing
- [Configuring MCP Servers and Skills for Antigravity](https://medium.com/google-cloud/configuring-mcp-servers-and-skills-for-antigravity-cli-and-ide-a938c7eebb78)

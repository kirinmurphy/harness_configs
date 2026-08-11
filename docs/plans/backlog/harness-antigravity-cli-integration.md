---
id: antigravity-cli-provider-integration
priority: high
next_action: Confirm the four unverified capability paths (slash commands, permissions, hooks, global rules scope) against a live authenticated agy install, then implement Phase 2
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
string in one manifest, and no platform code hardcodes `~/.gemini`.

The identity question is settled (see Decision below): roborepo supports Antigravity only. The
`gemini` provider is retired and `antigravity` registered in its place, so the work is a provider
rename plus a cleanup pass for artifacts stranded at the old paths — not a coexistence problem.

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

## Decision — retire `gemini`, register `antigravity`

**Settled 2026-08-04.** roborepo will support Antigravity CLI only. The `gemini` provider is
removed, not repointed, and a new `antigravity` provider is registered in its place:

```text
globals/harnesses/
  claude/
  codex/
  antigravity/     id: antigravity, commandName: agy
  gemini/          DELETED
```

Rationale: the id is the harness's identity throughout roborepo — state files, manifest rows, CLI
output, package `harnesses` arrays. Keeping `id: "gemini"` for a binary named `agy` would leave a
permanent misnomer in all of them to save a one-time rename. The old CLI is not being kept alive,
so nothing needs the `gemini` id.

The cost of retiring rather than repointing is a **cleanup story**: existing machines have roborepo
artifacts at paths the new provider no longer manages (`~/.gemini/skills/`, `~/.gemini/policies/`,
`~/.gemini/commands/`, `~/.gemini/GEMINI.md`, and the `mcpServers` key in `~/.gemini/settings.json`).
Removing a provider from the registry orphans them: no provider claims those paths, so no code
cleans them up and `doctor` stops checking them. This is covered in Phase 1 below and is the main
thing that makes this more than a rename.

Note that `~/.gemini` is *not* going away — Antigravity keeps it as its base directory and adds
subdirectories under it. Only the specific artifact paths change.

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

### Phase 1 — Retire `gemini`

The rename touches every place the id appears. Inventory as of `483be54`:

| Location | Count | Action |
| --- | --- | --- |
| `globals/packages/*/package.config.json` `harnesses` arrays | 8 packages | `"gemini"` -> `"antigravity"` |
| `generated/packages/*/gemini/` | 7 dirs | regenerate as `antigravity/` |
| `generated/gemini/` | rules + policies | regenerate as `generated/antigravity/` |
| `manifests/platform/manifest.tsv` | 4 rows | repoint to new home_root token |
| `globals/harnesses/gemini/` | manifest + MANAGED_BY marker | delete, replace with `antigravity/` |
| `scripts/harnesses/gemini/` | adapter + policy-toml | delete or port (see Phase 2) |
| `scripts/install/install-windows.ps1` | 4 lookups | rename (Phase 4) |

**Live-machine cleanup.** Removing the provider orphans artifacts already on disk. Decide between:

- *Best effort:* ship a one-shot cleanup in `roborepo update` that removes roborepo-owned files at
  the old paths. Identifiable by the managed markers roborepo wrote, so user files are never at
  risk.
- *Leave them:* document the stale paths and let users delete them. Simpler, but `~/.gemini/skills/`
  keeps 12 dangling symlinks into the skill cache, which `doctor` will no longer notice.

Prefer the one-shot cleanup — dangling symlinks into a cache that later gets pruned is exactly the
kind of silent rot this repo's doctor exists to catch.

Run `roborepo harness withdraw gemini --dry-run` **before** deleting the provider. Withdraw needs
the provider registered to know what to strip; once it is gone, that path is unavailable.

### Phase 2 — Manifest and adapter

Write `globals/harnesses/antigravity/provider.json` with verified paths. Implement
`scripts/harnesses/antigravity/index.mjs`, reusing Gemini's root-config merge (same JSON object
shape) and MCP server shape. Register in `registry.mjs`.

Gemini's `policy-toml.mjs` is Policy-Engine-specific and likely has no Antigravity equivalent — see
the permissions note above. Delete it with the provider unless Phase 0 finds a per-tool policy.

### Phase 3 — MCP sidecar storage mode

Add the new storage mode and `mcpConfig` path key. Extend
`mcp-add-characterization-check.mjs` to pin the sidecar file's on-disk shape, mirroring how the
Gemini case pins `mcpServers` inside `settings.json`.

### Phase 4 — Windows installer

Add the provider to `$KnownHarnessIds`, `$adoptRootConfig`, `Resolve-ManifestHomeRoot`, and
`$HarnessDisplayNames`. `scripts/test/windows-installer-check.ps1` fails CI until this is done.

### Phase 5 — Docs

Update `docs/user/guides/harnesses/supported-harnesses.md`'s capability matrix and harness table:
`gemini` row becomes `antigravity`, with the config home and root-config format corrected. Note that
Gemini CLI is deprecated upstream and that `agy` is the supported binary. Also check
`harnesses-explained.md`, which currently describes Gemini CLI's `~/.gemini/` layout in its
"What a harness is" section.

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
- **Orphaned artifacts at retired paths.** Retiring `gemini` means no provider claims
  `~/.gemini/skills/`, `~/.gemini/policies/`, or `~/.gemini/commands/`, so nothing cleans them and
  `doctor` stops checking them. The 12 skill symlinks there point into the machine-local cache; if
  that cache is later pruned they become dangling with no check to catch it. Phase 1's cleanup pass
  is what closes this — do not skip it as cosmetic.
- **`withdraw` needs the provider present.** Run `harness withdraw gemini --dry-run` before deleting
  the provider directory, not after.
- **Plugin system may supersede loose files.** If Antigravity pushes toward plugin bundles as the
  supported extension path, per-capability file delivery could become the unsupported route. Worth
  a look during Phase 0 before investing in the loose-file approach.

## Sources

- `strings /usr/local/bin/agy` (Antigravity CLI 1.1.10) — authoritative for embedded paths
- [Antigravity CLI settings docs](https://antigravity.google/docs/cli/settings)
- [Antigravity CLI features docs](https://antigravity.google/docs/cli/features)
- [Where Antigravity Looks for Agent Skills](https://atamel.dev/posts/2026/07-01_where_agy_agent_skills/) — empirical skills-path testing
- [Configuring MCP Servers and Skills for Antigravity](https://medium.com/google-cloud/configuring-mcp-servers-and-skills-for-antigravity-cli-and-ide-a938c7eebb78)

# Package Registry vs Live State Reconciliation

> Status: planned. This captures a known design gap in the config control panel:
> roborepo can record package intent in its registry while the user's live harness
> files may already contain, miss, or partially contain the corresponding state.

## Problem

The config portal currently renders package state from a mix of sources:

- `~/.roborepo/enabled-packages.json` for rules packages.
- Live Claude/Codex config for plugins, hooks, permissions, MCP servers, services, and skills.
- Package catalog data from `manifests/inventory/packages.json`.

That means "enabled" can become ambiguous. A package can be marked enabled in the registry
while its live artifacts are missing, or live artifacts can exist while the registry does not
know why they are there.

The caveman package exposed this because it now has both:

- a `plugin` component in Claude settings
- a `rules` component in the roborepo package registry

If only one side exists, the portal should not collapse that into a simple on/off boolean.

## Why Drift Happens

Drift is expected, not exceptional.

- A user can edit `~/.claude/settings.json`, `~/.codex/config.toml`, hooks, skills, or MCP
  registrations directly.
- The native harness can install or remove plugins outside roborepo.
- Older roborepo installs may predate the current registry model.
- Package definitions can change after install, adding or removing components.
- Enable/disable can fail halfway through because a command is unavailable, a file is malformed,
  a harness home is missing, or a native directory collides with a managed copy.
- `roborepo update` can rerender rules and copy managed files without reapplying every optional
  package component.
- `--telemetry-only` intentionally writes live telemetry artifacts without full install state.
- Project-level config can override global config, especially permissions.
- Composite packages can be logically enabled through `requires` even when they own no artifacts.

## State Model To Adopt

Separate intent from observation.

| Layer | Meaning | Example |
| --- | --- | --- |
| Catalog | What roborepo knows how to install | `packages.json` component list |
| Desired state | What roborepo should maintain | enabled package registry |
| Observed state | What exists on disk / in harness config | hooks, rules, plugin bools, skill markers |
| Ownership | Whether observed state is roborepo-managed | `.roborepo-managed`, managed block, registry marker |
| Effectiveness | Whether the harness can actually use it | plugin downloaded, MCP registered, hook command present |

The portal should render a richer package status:

| Status | Meaning |
| --- | --- |
| `enabled` | Desired and all observed components present |
| `disabled` | Not desired and no roborepo-owned observed components present |
| `partial` | Some but not all desired components are present |
| `external` | Observed components exist, but registry does not claim them |
| `stale` | Registry claims the package, but catalog no longer has it or components changed |
| `blocked` | Desired, but a collision or missing dependency prevents materialization |

## Component Drift Matrix

### `rules`

Artifacts:

- Desired: package ID in `~/.roborepo/enabled-packages.json`.
- Observed: rendered `CLAUDE.md` / `AGENTS.md` content includes package fragment.
- Ownership: managed rules block or generated rules file.

Drift cases:

- Registry says enabled, but rendered rules lack the fragment.
- Rendered rules contain the fragment, but registry lacks the package.
- Package fragment changed, but rendered rules are stale.
- Claude and Codex disagree for `harness: both`.

Best fix:

- Treat registry as desired state.
- `roborepo doctor --installed` should compare rendered rules against `base + registry`.
- `roborepo repair packages` should rerender rules from the registry.
- Portal should show `external` when a fragment is present without registry ownership and offer
  "adopt into registry" or "rerender from registry".

### `hooks`

Artifacts:

- Desired: package ID in registry or package state.
- Observed: hook command entries in `~/.claude/settings.json` or `~/.codex/hooks.json`.
- Ownership: exact command match to the package hook fragment.

Drift cases:

- Hook exists but registry does not claim package.
- Registry claims package but hook command is missing.
- Hook command changed in source, leaving old hook command behind.
- User-authored hook has same event but different matcher/command.

Best fix:

- Match roborepo-owned hooks by stable component ID, not only command text.
- If native schemas allow it, stamp hook entries with metadata such as `roborepoPackage`.
- Until then, compare against source fragments and remove only exact owned entries.
- Portal should show hook diff: missing, extra-old, present.

### `permissions`

Artifacts:

- Desired: package/profile selection.
- Observed: `permissions.allow` / `permissions.deny` in Claude settings and Codex rule/config
  render output.
- Ownership: currently weak because permission strings can be user-authored too.

Drift cases:

- User adds an allow entry manually; package appears enabled if checked only by allow strings.
- Package disable removes a permission the user wanted independently.
- Profile changed globally, but project override still changes behavior.
- Claude and Codex profiles differ.

Best fix:

- Permission profiles should be desired-state records, not inferred from raw allow entries.
- Package-specific permissions need ownership metadata or a package registry entry.
- Disable should remove only permissions owned by the package/profile, not arbitrary matching
  user entries unless explicitly confirmed.
- Portal should display global profile and project override separately.

### `plugin`

Artifacts:

- Desired: `enabledPlugins[id]` and marketplace entry in Claude settings.
- Observed: those settings plus the native plugin cache, if inspectable.
- Ownership: weak unless roborepo records that it wrote the plugin.

Drift cases:

- Plugin enabled directly in Claude, registry lacks package.
- Registry claims package, but `enabledPlugins[id]` is false or missing.
- Marketplace exists, but plugin download has not happened yet.
- Plugin cached locally but disabled.
- Plugin package also has rules; one component exists without the other.

Best fix:

- Treat plugin settings as observed state, not proof of roborepo intent.
- Add a package desired-state registry that covers plugin packages too, not only rules packages.
- Show plugin effectiveness as "enabled in settings" vs "installed/downloaded" if the native
  cache path can be detected safely.
- For mixed packages, display per-component status and a one-click repair that applies missing
  components.

### `mcp`

Artifacts:

- Desired: package registry.
- Observed: Claude MCP registration and Codex MCP config block.
- Ownership: command/server name and roborepo preset data.

Drift cases:

- Claude MCP exists but Codex MCP block is missing.
- User registered an MCP server with the same name but different transport/command.
- `claude mcp add` failed during package enable.
- Package disabled, but MCP registration remains.

Best fix:

- Probe both harnesses.
- Store expected normalized MCP config per preset.
- Treat same name with different config as `blocked` or `external-conflict`, not enabled.
- Repair should update only roborepo-owned or user-confirmed entries.

### `service`

Artifacts:

- Desired: package registry or service-specific state.
- Observed: service state files, spool dirs, hook entries, running process/pid file.
- Ownership: service state path under `~/.roborepo`.

Drift cases:

- Telemetry state says enabled but hooks are absent.
- Hooks exist but telemetry state says disabled.
- Server is running while capture is disabled, or capture is enabled while server is stopped.
- `--telemetry-only` creates service artifacts without full package registry state.

Best fix:

- Service packages should expose a `probe()` and `repair()` handler, not rely on generic component
  checks.
- Keep "capture enabled" separate from "portal running".
- Decide whether telemetry-only should write desired package state or a distinct standalone state.

### `skill`

Artifacts:

- Desired: installed skill selection or package registry.
- Observed: copied skill directories in `~/.claude/skills` and `~/.codex/skills`.
- Ownership: `.roborepo-managed` marker.

Drift cases:

- Managed skill exists in one harness but not the other.
- Managed copy is stale against `globals/agents/skills/<name>`.
- Native skill directory exists with same name and no marker.
- Registry/selection says installed but copied skill was removed manually.

Best fix:

- Keep `.roborepo-managed` marker as ownership source.
- `doctor --installed` should compare managed copy content against source.
- Portal should show native collision separately and avoid overwriting.
- Repair can recopy managed skills; adoption of native skills should be explicit.

### `requires` / composite packages

Artifacts:

- Desired: package registry for the composite and each required package.
- Observed: component status of dependencies.

Drift cases:

- Composite enabled but dependency disabled.
- Dependency enabled independently, composite registry absent.
- Disable composite leaves dependency intentionally enabled for another package.

Best fix:

- Represent composite state as derived from dependencies.
- Do not remove dependencies when disabling a composite unless no other desired package requires
  them and the user confirms.
- Portal should show "enabled via dependency" vs "explicitly enabled".

### install bundles and presets

Artifacts:

- Desired: preset state.
- Observed: copied base files, rendered rules, root config, installed commands/hooks.

Drift cases:

- Base bundle applied but user later removed a managed copy.
- Preset selected but manifest rows changed.
- Telemetry bundle selected but service state differs.

Best fix:

- Keep install bundles separate from runtime packages.
- `roborepo update` should reconcile selected bundles and then reconcile desired packages.
- Portal should not treat bundle state as package state.

## Recommended Design

### 1. One desired-state registry for packages

Create a versioned package state file, replacing the rules-only registry:

```json
{
  "version": 1,
  "packages": {
    "caveman": {
      "desired": true,
      "explicit": true,
      "updatedAt": "2026-06-28T00:00:00.000Z"
    }
  }
}
```

Rules rendering can still read from this file, but it should no longer be rules-specific.

### 2. Add component probes

Each component type gets a pure read probe:

```js
probeComponent(pkg, component) -> {
  desired: boolean,
  observed: "present" | "missing" | "partial" | "external" | "blocked",
  owner: "roborepo" | "external" | "unknown",
  detail: string
}
```

`readConfigSnapshot()` should report both package-level summary status and per-component status.

### 3. Make enable/disable transactional enough

Package mutation should:

1. Record desired state.
2. Apply every component.
3. Probe every component.
4. Return `enabled`, `partial`, or `blocked` with details.

Do not pretend a package is enabled just because the first component succeeded.

### 4. Add repair/adopt/forget actions

Portal and CLI should support:

- `repair`: apply missing desired components again.
- `adopt`: mark compatible external observed state as desired/owned where safe.
- `forget`: remove desired registry state while leaving external live config untouched.
- `remove`: remove roborepo-owned observed artifacts.

For destructive or ambiguous cases, ask. Never remove user-owned state just because it matches
a package component by text.

### 5. Show drift in the UI

Replace a single on/off dot with:

- on: desired and observed
- off: not desired and no owned artifacts
- partial: desired but incomplete
- external: observed without desired
- blocked: collision or malformed config

The row should expand to component details:

```text
caveman
  rules: missing from registry/render
  plugin: enabled in Claude settings
  status: external/partial
```

## Migration Strategy

1. Introduce the new package state file while still reading the old rules registry.
2. On first read, migrate old enabled rule package IDs into the new state file.
3. For packages with live observed components but no registry entry, mark as `external`, not enabled.
4. Add repair/adopt/forget controls.
5. Once migration is stable, remove the rules-only registry path.

## Open Decisions

- Should `--telemetry-only` mark the telemetry package desired, or remain a distinct standalone mode?
- Can Claude plugin cache/install state be detected reliably enough to show "downloaded" vs merely
  "enabled in settings"?
- Do hooks/settings schemas tolerate metadata fields for ownership, or do we need sidecar ownership
  records under `~/.roborepo`?
- Should package disable remove matching artifacts by default, or only artifacts with explicit
  ownership markers?
- How should project-level overrides appear when they intentionally differ from global package state?

## Implementation Sketch

Likely files:

- `scripts/cli/package-state.mjs` - desired-state registry read/write/migration.
- `scripts/cli/package-probes.mjs` - component probes and package status folding.
- `scripts/cli/packages.mjs` - transaction-style enable/disable using probes.
- `scripts/cli/config.mjs` - snapshot includes desired/observed/component status.
- `scripts/cli/config-dashboard.mjs` - render partial/external/blocked states.
- `scripts/doctor.sh` - installed drift checks for package desired vs observed.
- `docs/reference/services/config-control-panel.md` - update once behavior ships.

## Test Plan

- Unit-style Node smoke tests for each component probe against temp home dirs.
- Package mutation tests that force partial failure and assert `partial` status.
- Migration test from old `enabled-packages.json` to new package state.
- Portal snapshot test for `enabled`, `disabled`, `partial`, `external`, and `blocked`.
- Existing `scripts/test/test-roborepo.sh` coverage for install/update/doctor stays green.


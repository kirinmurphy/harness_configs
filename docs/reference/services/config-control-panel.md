# Config Control Panel

## Purpose

`roborepo` exposes the harness configuration — what indexers, plugins, skills,
telemetry, and permission buckets are active — as an inspectable, editable surface.
A user can see the current state and change it from either the web dashboard
(`/config`) or the interactive terminal flow (`roborepo package manage`), without
hand-editing `~/.claude/settings.json`, `~/.codex/config.toml`, or symlinks.

The panel is organized around user-facing behavior sections, not the internal
install machinery: **Token Optimization**, **Commands**, **Code Conventions**,
**Chat-Time Output**, and **Permissions**.

## Concept Model

The panel is built from a few nouns. Source of truth differs per noun — some live in
the user's live harness config, some in repo manifests, some in roborepo state.

| Noun | What it is | Source of truth |
| --- | --- | --- |
| **Package** | A named feature made of typed resources | `globals/packages/<package>/package.config.json` and workspace package configs; live config (enabled state) |
| **Resource** | One typed unit of a package's install or presentation | the package config |
| **Skill** | A shared or native skill, inspected without flattening harness-specific metadata | package-owned `skills/<name>` source or system skill source; `~/.roborepo/skills/<name>` (managed cache); `~/.claude/skills/<name>` and `~/.codex/skills/<name>` (harness install state) |
| **Permission behavior** | A named behavior or arbitrary command set to `allow`, `ask`, `deny`, or `default` | `manifests/inventory/agent-permissions.json` (defaults); `~/.roborepo/command-overrides.json` (personal overrides); live config (active render) |
| **Snapshot** | The assembled current state the UI renders | computed by `readConfigSnapshot()` |

### Resource Types

A package is `{ schemaVersion, id, label, resources: [...], requires?: [...] }`. Enabling a package
applies each installable resource; the enable/disable switch dispatches on `resource.type`.

| type | Wires | Notes |
| --- | --- | --- |
| `mcp` | An MCP server registration | via `roborepo mcp add` |
| `cli-command` | A package-owned `roborepo` subcommand | resolved by command name at runtime |
| `rules` | A rules block in the harness rules file(s) | `harness: claude` → `CLAUDE.md`, `codex` → `AGENTS.md`, `both` → each present harness; merged/removed by unique first line |
| `hooks` | Hook entries in `~/.claude/settings.json` | merged by command |
| `permissions` | `permissions.allow` entries | exact-match add/remove |
| `plugin` | `extraKnownMarketplaces` + `enabledPlugins[id]` | harness downloads the plugin on its next launch |
| `service` | A registered async handler's bespoke install | e.g. telemetry's spool + capture hooks |
| `skill` | A shared-skill link into harness skill dirs | reuses the skill linker |

Adding a new feature of an existing shape is data, not code: declare its resources in the owning
`package.config.json`. A new shape needs a new `case` in the enable/disable switch
(`scripts/cli/packages.mjs`).

### Package composition

A package may list `requires: [pkgId, ...]`. Enabling it enables every required package
first (deduped, cycle-safe), then its own resources. A composite package — one whose
payload is purely `requires` — bundles other packages under a single toggle. Composite packages
enable every required package before reporting themselves enabled.

A composite is reported enabled only when its own resources and every required package
are enabled.

> Composition (`requires`, runtime feature enablement) is distinct from an install
> **bundle** (`manifests/platform/presets.json`), which groups file-copy/link rows at
> install time. Both exist; they operate at different layers.

### The sections

`buildBehaviorView()` (`scripts/cli/config.mjs`) maps the snapshot onto the sections the
panel renders:

- **Global Rules** — start with the selector only; after a file is chosen, show the live
  `CLAUDE.md` / `AGENTS.md` content, the file path, and the default-rule drill-downs.
- **Hooks** — quick links to the live `~/.claude/settings.json`, `~/.codex/config.toml`,
  and `~/.codex/hooks.json` files.
- **Token Optimization** — the jcodemunch / jdocmunch packages, the Caveman plugin
  package, and Telemetry (a service package). All toggle.
- **Commands** — skills that pair with a slash command, labelled by their `/command`.
  Toggle installs/removes the skill link.
- **Code Conventions** — auto-loaded skills (no command). Same skill-link toggle.
- **Chat-Time Output** — the inline chat-note behaviors (convention capture, impact
  awareness, skill visibility), each a `rules` package merged into every managed harness. On by
  default; toggling adds/removes the behavior's rules block.
- **Permissions** — flat behavior and command buckets. Named behaviors and arbitrary commands can
  be set to `allow`, `ask`, `deny`, or reset to the manifest default.

## Current Behavior

### Reading state

`readConfigSnapshot()` assembles a JSON snapshot from the live harness config, the
package catalog, skill resources, the permission manifest, and roborepo state files.
`GET /api/config` returns it; both the web view and the terminal flow render from it.

Package rows include `status`, `desired`, and `componentStatus` so the panel can distinguish
enabled, configured, disabled, partial, external, and blocked package state without treating every
observed component as an enabled package. `configured` is a fully-installed package whose only
not-`present` component is a runtime service the user has deliberately turned off (component state
`inactive`, e.g. telemetry capture disabled) — distinct from `partial`, which means an install is
genuinely incomplete.

Skill rows include a native-aware `inventory` object from `scripts/cli/skill-inventory.mjs`.
The skill source popup uses that same inventory, so it can show ownership, managed cache state,
native collision state, native-only metadata files, and per-harness install state before the skill
body and bundled context files.

### Writing state

Every mutation goes through one of the `{ ok, message }` primitives in
`scripts/cli/config-mutate.mjs` (or the package enable/disable path), so the web server
and terminal flow share one implementation:

- `mutatePackage(id, enabled)` → `enablePackage` / `disablePackage`
- `setSkillInstalled(id, enabled)` → materializes/removes the cache entry in `~/.roborepo/skills`
  and links/unlinks the skill in `~/.claude/skills` and `~/.codex/skills`
- `setBehaviorBucket(behaviorId, bucket)` → writes a personal behavior override, then re-renders live global permissions
- `setCommandBucket(tokens, bucket)` → writes a personal arbitrary-command override, then re-renders live global permissions

Writes target the user's **live** config, not the repo template (`globals/`). The repo
template is changed only by the install/render pipeline.

### Web endpoints

The loopback-only portal server (`scripts/cli/portal-server.mjs`) serves `/config`
and these write endpoints. Each returns the fresh snapshot so the client re-renders from
one response.

| Endpoint | Body | Result |
| --- | --- | --- |
| `POST /api/config/packages` | `{ id, enabled }` | enable/disable a package |
| `POST /api/config/skills` | `{ id, enabled }` | link/unlink a skill |
| `POST /api/config/permissions` | `{ behaviorId, bucket }` or `{ tokens, bucket }` | set a named behavior or arbitrary command to `deny`, `ask`, `allow`, or `default` |

### Harness Context estimates

The snapshot carries `contextCost` (computed by `scripts/cli/context-cost.mjs`): per-harness
token estimates for the configuration itself, rendered as a `Usage` row in the agent files
grid (one `<token-chip>` per harness, colored by level, with a contributing-amounts tooltip),
plus warning summaries, per-package cost badges, matching chips on the rules-file cells when
rules are medium/high, and chips in the source-inspect popup header.
`<token-chip>` is a shared web component (`portal/shared/token-chip.js`, styles in
`base.css`) so every cost chip renders and behaves identically.

Two cost classes are tracked and never mixed:

- **Startup** — text included automatically at chat start: the rendered rules payload
  (`CLAUDE.md` / `AGENTS.md` managed block) plus installed skill/command discovery metadata
  (frontmatter name and description). The authoritative startup rules number is measured from
  the full rendered output, not by summing source fragments; the remainder over package
  fragments is attributed to `core-baseline`.
- **On-demand** — text loaded only when invoked: full `SKILL.md` bodies and generated slash
  command wrappers. Deliberately never summed in the UI (skill bodies don't load together, so
  a machine-wide or section-wide sum is noise). Instead each package's single-invocation cost
  is rated on its own skill-size scale (`ON_DEMAND_LEVEL_THRESHOLDS`: low < 1k, medium 1k–3k,
  high > 3k) and only medium/high sizes render a colored per-item chip; low-cost skills show
  no chip.

Config/settings syntax, hook scripts, and MCP schemas never receive token numbers — they are
labeled `Not prompt context`, `conditional`, and `runtime-dependent` respectively. Disabled
packages keep a measured *potential* cost but contribute nothing to active totals.

The warning panel appears above the agent files grid only when medium/high items exist. It sorts
high items first, then by each item's percent of its own high threshold. Warning labels bold only
the item name; parenthetical qualifiers such as `(when loaded)` stay plain. The aggregate
`Skill Discovery Descriptions (in total)` warning includes an info tooltip that explains the
number is the active total of skill description metadata and distinguishes individual large
contributors from many small descriptions adding up.

All counts are estimates (`~4 characters per token`, `method: "estimated-v1"`). The
low/medium/high rating uses threshold families from
`manifests/platform/context-cost-thresholds.json`: full startup payloads and rendered rules use
the large startup scale; package rule snippets and skill discovery metadata use the smaller
Chat-Time Output/snippet scale; single skill/command invocations use the on-demand skill-size
scale. Results are cached by a stat signature over every input file plus enabled/install state,
so the 10-second portal poll does not re-read sources.

### Permission scope

Permissions are global machine state. Roborepo no longer has a per-project permission profile layer.

Personal changes are stored in `~/.roborepo/command-overrides.json` and layered on top of
`manifests/inventory/agent-permissions.json` before rendering live Claude/Codex config. Resetting a
row to `default` removes the personal override and returns to the repo manifest default for that
behavior or command.

## Happy Path

1. Run `roborepo web` to open the `/config` portal (or run `roborepo package manage`
   in a terminal).
2. The panel renders the four sections from `GET /api/config`.
3. Toggle a package, skill, or telemetry switch — the client POSTs, the server mutates
   live config and returns a fresh snapshot, the panel re-renders.
4. To change permissions, set a named behavior or arbitrary command to `deny`, `ask`, `allow`, or
   `default`.
5. Changes take effect the next time the agent harness starts a session.

## Required Rules

- Permission rows must use only `deny`, `ask`, `allow`, or `default`. There is no looser-profile
  confirmation because each behavior is independently reversible.
- Mutations write live config only; the repo template under `globals/` is never touched
  by the panel.
- Disabling a composite package leaves its shared required packages in place — disabling
  them could break other enabled packages.

## Edge Cases

- **Plugin enable cannot fetch.** Enabling a `plugin` package writes the marketplace
  entry and the `enabledPlugins` bool, but the harness performs the actual download on
  its next launch. A freshly enabled plugin shows as enabled before it is installed.
- **Native skill collision.** If a real (native-installed) skill directory already
  occupies a skill name, the skill toggle skips it rather than overwriting. The inspect popup
  reports the collision and preserves native-only metadata such as `agents/openai.yaml`.
- **Missing harness home.** Permission writes only target harness homes that already exist. If no
  harness config is present, the mutation reports that nothing was written.

## Key Files

- `scripts/cli/config.mjs` — `readConfigSnapshot()`, `buildBehaviorView()`,
  `loadConfigSource()` (orchestrator).
- `scripts/cli/config-source-lookup.mjs` / `config-source-render.mjs` — source-popup file
  resolution and HTML rendering.
- `scripts/cli/root-config-view.mjs` — per-harness root-config drift view (shared by CLI and portal).
- `scripts/cli/config-live-rules.mjs` — live CLAUDE.md/AGENTS.md reading.
- `scripts/cli/config-cli-print.mjs` — terminal-only `roborepo config` output.
- `scripts/cli/skill-inventory.mjs` — shared read-only skill inventory for the CLI and portal.
- `scripts/cli/context-cost.mjs` — token-cost estimator, collectors, and stat-signature cache
  behind the snapshot's `contextCost`.
- `scripts/cli/package-probes.mjs` — read-only package live-state reconciliation.
- `scripts/cli/config-mutate.mjs` — the shared mutate primitives.
- `scripts/cli/packages.mjs` — `enablePackage` / `disablePackage` and package dependency
  resolution.
- `scripts/cli/permissions-render.mjs` — the permission render core.
- `scripts/cli/config-dashboard.mjs` — the `/config` web view.
- `scripts/cli/portal-server.mjs` — the HTTP routes.
- `portal/config/` — the config page HTML, CSS, and browser JavaScript.
- `globals/packages/*/package.config.json` — built-in package configs.
- workspace `packages/*/package.config.json` — imported or locally authored package configs.

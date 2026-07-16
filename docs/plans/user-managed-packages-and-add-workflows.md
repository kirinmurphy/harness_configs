# User-Managed Packages And Add Workflows

> Status: draft. This plan proposes a user-facing creation model for custom skills, MCP servers,
> rules, hooks, permissions, plugins, and grouped toolsets. The core recommendation is that
> `package` remains the unified internal management unit, while most users create content through
> typed `roborepo add <kind>` flows and only meet packages when grouping, exporting, or debugging.

## Purpose

Roborepo can already manage internal packages: a package is a named feature made from typed
resources such as skills, MCP servers, rules, hooks, permissions, plugins, and services. The config
portal and onboarding flow expose those internal packages as top-level behavior toggles.

The missing product surface is user-managed content. A user may want to add one custom skill, one
MCP server, a rule snippet, a hook, a permission rule, or a multi-part toolkit that combines several
of those. Roborepo needs to make those additions visible, reversible, inspectable, portable, and
manageable from the same control plane as built-in packages.

The main design constraint is trust. Users should not feel like they are adding content into a
mysterious local black box. Roborepo may use machine-local state for implementation, but the user
should have a clear source path, receipt, inspect command, export path, and remove path for anything
they add.

## Concept Model

### Package

A package is Roborepo's unified management unit. It describes one user-visible feature and the
resources required to install, enable, disable, inspect, repair, and export that feature.

Built-in packages live as package-local `package.config.json` files under `globals/packages/*/`.
User packages should use the same package-shaped schema, with additional origin and source
metadata when needed.

Example package-shaped record:

```json
{
  "id": "user:skill:my-reviewer",
  "origin": "user",
  "label": "My reviewer skill",
  "description": "Loads a personal review checklist when reviewing code.",
  "category": "Code Conventions",
  "source": {
    "kind": "path",
    "path": "./my-reviewer"
  },
  "resources": [
    {
      "type": "skill",
      "id": "my-reviewer",
      "source": "skills/my-reviewer"
    }
  ]
}
```

### Resource

A resource is one typed installable or presentational piece inside a package.

Existing resource types already include:

- `skill`
- `mcp`
- `rules`
- `hooks`
- `permissions`
- `plugin`
- `service`
- `cli-command`
- `codex_tool_approvals`

User-managed content should reuse these types rather than inventing separate per-kind state models.
That lets package live-state probes, portal rows, enable/disable, and repair flows operate on user
content and built-in content through one path.

### User-Added Item

A user-added item is the thing the user thinks they added: a skill, MCP server, rule snippet, hook,
permission, plugin, slash command, or grouped toolkit.

For simple additions, the user-added item and package can be one-to-one:

- `roborepo add skill ./my-skill` creates `user:skill:my-skill`.
- `roborepo add rule ./my-rules.md` creates `user:rule:my-rules`.
- `roborepo add mcp filesystem` creates `user:mcp:filesystem`.

For grouped additions, the package becomes the user-visible item:

- `roborepo add package ./team-toolkit`
- `roborepo add` followed by "Multiple things together"

### Source, Cache, And Live Install

Roborepo should distinguish three locations:

| Layer | Meaning | User-facing behavior |
| --- | --- | --- |
| Source | User-owned portable files or package folder | Shown in receipts and inspect output; can be committed or moved intentionally |
| Cache/state | Roborepo's machine-local copy and desired-state records | Implementation detail, but inspectable; never the only export path |
| Live install | Claude/Codex config, skills dirs, hooks, rules, plugins, MCP registrations | Shown as exact writes/effects in inspect output |

Machine-local state under `~/.roborepo` is acceptable and idiomatic, but it must not become a hidden
source of truth for user-authored content.

## Current Behavior

Roborepo already has several pieces of this architecture:

- Built-in package definitions live in `globals/packages/*/package.config.json`.
- `scripts/cli/package-catalog.mjs` loads built-in and workspace package configs.
- `scripts/cli/packages.mjs` enables and disables packages by dispatching on resource type.
- `scripts/cli/package-probes.mjs` computes desired vs observed package live state.
- `scripts/cli/config.mjs` builds the `/config` snapshot and maps it to behavior sections.
- `scripts/cli/config-mutate.mjs` provides shared mutation primitives for the portal and onboarding.
- `scripts/cli/skill-inventory.mjs` can detect managed and native skills across harness dirs.

The current gaps:

- Built-in packages are cataloged as top-level package records; workspace package configs are also
  discoverable.
- User-added native skills can be detected, but they are not first-class package records.
- `buildBehaviorView()` is still hard-coded around known internal package IDs and section buckets.
- Users have simple flows for some single-type things, especially skills and MCP servers, but not
  for rule snippets, hooks, chat-time-output behavior, plugin metadata, or package-owned permission
  additions.
- There is no portable user package authoring/export format.
- `~/.roborepo` stores useful machine state, but the product does not yet explain the boundary
  between user source, Roborepo cache, and live harness writes.

## Proposed Behavior

### Packages Stay Top-Level Internally

Roborepo should treat packages as the top-level internal unit for built-in and user-managed content.
This gives one model for:

- enable/disable
- desired state
- live-state probes
- repair/adopt/forget
- export/import
- portal rows
- onboarding rows
- source inspection
- resource drift reporting

The user does not need to start with the package concept. Packages become visible when the user asks
to manage all installed items, group several resources, export/share a setup, or inspect how
Roborepo installed something.

### Typed Add Flows Are The Default Creation Path

The primary creation surface should be `roborepo add`, with direct typed flows:

```txt
roborepo add
roborepo add skill ./my-skill
roborepo add mcp <name-or-url>
roborepo add rule ./rules.md
roborepo add hook ./hook.json
roborepo add permission "docker run" --ask
roborepo add plugin <plugin-source>
roborepo add command ./command.md
roborepo add package ./team-toolkit
```

Existing obvious namespaces can remain as aliases or advanced direct commands:

```txt
roborepo skill add ./my-skill
roborepo mcp add <name-or-url>
```

Those commands should call the same underlying add flow as `roborepo add skill` and
`roborepo add mcp`.

### The Wizard Introduces Packages Only When Needed

Bare `roborepo add` should launch a guided flow:

```txt
What do you want to add?
  Skill
  MCP server
  Slash command
  Rule snippet
  Hook
  Permission
  Plugin
  Multiple things together
```

If the user chooses one item type, Roborepo creates a package-shaped record in the background but
does not require the user to understand package authoring.

If the user chooses "Multiple things together", the wizard should introduce the package concept:

```txt
These pieces work together. Roborepo can save them as one package so you can enable,
disable, export, or share them together.
```

That keeps packages from feeling like an arbitrary domain term on first contact.

### User Package Folders Are The Portable Format

Roborepo should support a visible package folder format:

```txt
team-toolkit/
  roborepo-package.json
  skills/
    reviewer/SKILL.md
  rules/
    chat-output.md
  hooks/
    claude.json
```

The manifest is the portable source of truth for shared or committed user-authored packages.

Example manifest:

```json
{
  "schemaVersion": 1,
  "id": "team:review-toolkit",
  "label": "Team review toolkit",
  "description": "Team review skill plus chat-time review reminders.",
  "category": "Code Conventions",
  "resources": [
    {
      "type": "skill",
      "id": "team-reviewer",
      "source": "skills/reviewer"
    },
    {
      "type": "rules",
      "source": "rules/chat-output.md",
      "harness": "both"
    }
  ]
}
```

Single-item add flows can either:

- reference the original source path, then materialize a copy under Roborepo state for live use
- offer to export a portable package folder when the user wants to share or back it up

### Receipts Make Local Writes Explicit

Every successful add should print a receipt. The receipt should show source, managed ID, live
writes, and next commands.

Example:

```txt
Added skill: my-reviewer

Source:
  ./my-reviewer

Managed as:
  user:skill:my-reviewer

Installed:
  Claude skill: ~/.claude/skills/my-reviewer
  Codex skill: ~/.codex/skills/my-reviewer

Roborepo state:
  ~/.roborepo/...

Next:
  roborepo config inspect user:skill:my-reviewer
  roborepo package export user:skill:my-reviewer ./my-reviewer.roborepo
  roborepo package remove user:skill:my-reviewer
```

The exact cache path can be shown, but the wording should make clear that user source remains
the user's source and Roborepo state is the local managed install record.

### Inspect And Export Prevent Black-Box Anxiety

Roborepo should provide direct commands for seeing and extracting user-managed content:

```txt
roborepo added
roborepo config inspect <id>
roborepo package inspect <id>
roborepo package export <id> ./out-dir
roborepo package export-all ./roborepo-user-config
roborepo package remove <id>
```

`roborepo added` should show only user-added content:

```txt
User-added items

my-reviewer
  id: user:skill:my-reviewer
  kind: skill
  source: ./my-reviewer
  installed: Claude, Codex
  portable: yes
  commands: inspect, export, remove

filesystem
  id: user:mcp:filesystem
  kind: MCP
  source: preset filesystem
  installed: Claude, Codex
  portable: manifest only
  commands: inspect, export, remove
```

`inspect` should show:

- user source path
- package manifest path or generated package record
- enabled/desired state
- observed live state per resource
- exact live harness files touched
- ownership markers
- resource-level warnings such as native collision or partial install
- export/remove commands

### Web And Onboard Use The Same Model

The config portal and onboarding flow should consume the same behavior view for built-in and user
packages.

Behavior sections should be data-driven from package metadata:

- `Token Optimization`
- `Commands`
- `Code Conventions`
- `Chat-Time Output`
- `Permissions`
- `User Installs`

Known categories render inline with built-in content. Unknown or uncategorized user content falls
into `User Installs`. Rows carry badges:

- `built-in`
- `user`
- `external`
- `partial`
- `native`
- `blocked`

This makes user content first-class without hiding provenance.

## CLI Surface

The CLI should stay broad internally but simple at the front door.

Recommended user-facing surface:

```txt
roborepo              interactive menu
roborepo web          visual config
roborepo onboard      guided setup
roborepo add          guided add flow
roborepo config       inspect/manage current config
roborepo package      list/inspect/enable/disable/export/remove grouped items
roborepo skill        direct skill operations
roborepo mcp          direct MCP operations
roborepo update
roborepo doctor
```

Advanced or implementation-oriented verbs should remain callable where needed but should not be the
main help/menu emphasis:

- `bundle`
- `presets`
- raw `rules render`
- raw `permissions`
- `experimental`
- low-level telemetry capture/debug verbs

The main simplification is not removing capability. It is routing new user-created content through:

- `roborepo add` for creation
- `roborepo web` for visual management
- `roborepo package` for grouping/export/debugging

## Happy Path

### Adding One Skill

1. User runs `roborepo add skill ./my-reviewer`.
2. Roborepo validates that the folder contains `SKILL.md`.
3. Roborepo creates a package-shaped user record with one `skill` resource.
4. Roborepo materializes the skill into the managed local install path.
5. Roborepo links or copies the skill into installed harness skill dirs, respecting native
   collisions.
6. Roborepo prints a receipt showing source, managed ID, install targets, and inspect/export/remove
   commands.
7. `/config` shows the skill in `Code Conventions` or `Commands`, with a `user` badge.

### Adding A Rule Snippet

1. User runs `roborepo add rule ./chat-output.md --category "Chat-Time Output"`.
2. Roborepo validates the markdown file and asks which harnesses it applies to if omitted.
3. Roborepo creates a user package with one `rules` resource.
4. Roborepo marks the package desired/enabled and re-renders live rules.
5. Roborepo prints a receipt showing the source file, managed ID, rendered harness files, and
   inspect/export/remove commands.
6. `/config` shows the row in `Chat-Time Output`, with source inspect available.

### Adding Multiple Pieces Together

1. User runs `roborepo add` and chooses "Multiple things together".
2. Roborepo asks for a package name and category.
3. User adds a skill resource, rule resource, and permission resource through the wizard.
4. Roborepo writes a visible package folder or imports from one supplied by the user.
5. Roborepo enables the package as one unit.
6. `/config` shows one grouped row, with resource details available in inspect.

### Exporting User Content

1. User runs `roborepo package export-all ./roborepo-user-config`.
2. Roborepo writes portable package folders for all user-managed items.
3. Export output includes manifests, skill files, rule snippets, hook fragments, and enough metadata
   to recreate MCP/plugin/permission resources.
4. Roborepo reports any items that cannot be fully exported because their source is external or
   only represented by live harness state.

## Required Rules

- User-added content must be inspectable after add.
- User-added content must be removable or disableable through Roborepo.
- Roborepo must never require users to edit `~/.roborepo` manually.
- `~/.roborepo` can hold cache, local desired state, and materialized copies, but portable user
  source should live in visible files/folders or be exportable to them.
- Single-type add flows should not require package authoring knowledge.
- Package records should still be created for single-type additions so the control plane has one
  model.
- Built-in and user packages should share enable/disable/probe/render logic.
- User package IDs should be namespaced to avoid collisions with built-ins, for example
  `user:skill:<name>` or `user:package:<name>`.
- Disable should remove Roborepo-owned live writes, not unrelated matching user-authored config.
- Remove should ask before deleting Roborepo's local cache and should not delete the user's original
  source path unless explicitly requested.
- Export should preserve resource structure and relative paths where possible.

## Data Integrity And Validation

### Manifest Validation

User package manifests should validate:

- schema version
- package ID format
- origin or namespace
- label
- resource list
- resource source paths
- path containment inside the package folder for relative sources
- supported harness values
- duplicate resource IDs
- conflicts with built-in package IDs
- unsupported resource types

### Source Path Safety

Relative resource source paths in portable package folders must not escape the package root.

For direct add flows, Roborepo should record:

- original path as provided
- resolved absolute path at add time
- content hash or last imported timestamp
- materialized cache path

This enables later warnings such as "source changed since import" without making the original path
the only live dependency.

### Ownership Markers

Roborepo should continue using explicit ownership markers where possible:

- `.roborepo-managed` for managed skills
- desired-state package registry for package ownership
- stable metadata in generated package records
- exact resource IDs for future hook/rule ownership where schemas allow it

When ownership is weak, the portal should show `external` or `unknown` instead of pretending the
item is safely reversible.

### Receipts As Audit Trail

The add receipt should also be saved in machine state as an audit event. The portal can use that to
show when and how an item was added, and `roborepo package inspect` can report the latest add/update
event.

### Secrets And Local Values

User packages may contain fields that should not be exported casually:

- MCP environment variables
- hook command arguments with local paths or tokens
- plugin credentials
- permission commands that reveal private tooling
- absolute source paths

Export should default to a safe portable manifest. Secrets and machine-local values should either be
omitted, redacted, or written as named placeholders with a clear report:

```txt
Exported: team-toolkit

Redacted local values:
  MCP env GITHUB_TOKEN -> ${GITHUB_TOKEN}
  hook path /Users/me/bin/private-tool -> <local path omitted>
```

If Roborepo later supports encrypted or private exports, that should be an explicit mode, not the
default package export behavior.

### Scope

The first version should target global machine config because that is where the current package,
portal, and onboarding models operate. Project-scoped package installs can come later, but they need
separate UX because the same package may be globally available while enabled only for one repo.

The data model should leave room for scope:

```json
{
  "id": "user:skill:my-reviewer",
  "scope": "global"
}
```

Valid future scopes could be `global`, `project`, and `profile`. The first implementation should
reject unsupported scopes instead of silently treating them as global.

## Edge Cases

### Native Skill Collision

If a user already has `~/.claude/skills/foo` and Roborepo tries to add a managed `foo`, Roborepo
should not overwrite the native skill. The result should be `blocked` or `partial`, with an inspect
message explaining the collision and suggested options:

- choose a different managed skill ID
- adopt the native skill explicitly
- remove the native skill manually

### Source Deleted After Import

If the original source path is deleted after Roborepo imports a copy, the managed install can keep
working from cache. Inspect should show the source as missing and offer export from cache.

### Source Changed After Import

If the source path still exists but differs from the cached copy, inspect should show drift and offer:

- update managed copy from source
- export managed copy
- ignore

### External MCP Or Plugin

Some resources are references, not local files. Export should write the manifest metadata needed to
recreate the registration, but it may not be able to vendor the underlying package/plugin.

### Permissions Without Ownership

If a permission was added manually outside Roborepo and matches a user package resource, disable
should not silently remove it. Roborepo should only remove permissions it owns or ask the user to
confirm adoption/removal.

### Rules With Similar Text

Rule snippets should be tracked by package/resource identity, not only by matching text, wherever
the render model allows that. Text matching is acceptable for read-only external detection but weak
for destructive removal.

### User Wants No Local Copy

Some users may prefer Roborepo to reference a source folder directly. That can be an advanced mode,
but default behavior should materialize a managed copy so live harness behavior does not break when
the source is moved or the shell starts from a different directory.

## Implementation Checklist

### Phase 1 - Catalog And Schema

- [ ] Define a user package manifest schema with `schemaVersion`, `id`, `origin`, `label`,
      `description`, `category`, `source`, `scope`, `resources`, and `requires`.
- [ ] Add a user package catalog loader that merges built-in packages with user package records.
- [ ] Namespace user package IDs and reject collisions with built-ins.
- [ ] Add manifest validation with clear errors.
- [ ] Add source path resolution and path-containment checks.
- [ ] Reject unsupported scopes explicitly.

### Phase 2 - Data-Driven Behavior View

- [ ] Replace hard-coded package ID/category mapping in `buildBehaviorView()` with package metadata.
- [ ] Keep curated descriptions for built-ins where useful, but make category placement data-driven.
- [ ] Add a generic web section renderer for unknown/new categories.
- [ ] Add `origin` and status badges to behavior view items.
- [ ] Ensure `onboard` applies toggles by item type rather than hard-coded package IDs.

### Phase 3 - Add Flows

- [ ] Add `roborepo add` wizard.
- [ ] Add `roborepo add skill`.
- [ ] Add `roborepo add mcp`.
- [ ] Add `roborepo add rule`.
- [ ] Add `roborepo add hook`.
- [ ] Add `roborepo add permission`.
- [ ] Add `roborepo add plugin`.
- [ ] Add `roborepo add command`.
- [ ] Route `roborepo skill add` and `roborepo mcp add` through the same internals where possible.
- [ ] Print a receipt after every successful add.

### Phase 4 - Inspect, Export, Remove

- [ ] Add `roborepo added` or equivalent user-added inventory.
- [ ] Add `roborepo package inspect <id>` for built-in and user packages.
- [ ] Add `roborepo config inspect <id>` as a user-friendly alias if appropriate.
- [ ] Add `roborepo package export <id> <dir>`.
- [ ] Add `roborepo package export-all <dir>`.
- [ ] Redact or placeholder secrets and machine-local values during export.
- [ ] Add `roborepo package remove <id>`.
- [ ] Make remove disable live resources and delete Roborepo-managed local copies without deleting
      original source paths by default.

### Phase 5 - Drift, Adopt, Repair

- [ ] Show source-missing/source-changed drift for user packages.
- [ ] Add update-from-source for imported local paths.
- [ ] Add explicit adoption flows for native skills, MCP servers, plugins, rules, and hooks where
      ownership can be proven or confirmed.
- [ ] Add repair for partial package installs.
- [ ] Add tests for native collisions and weak ownership cases.

### Phase 6 - Docs And UX Copy

- [ ] Document the source/cache/live-install model.
- [ ] Document `~/.roborepo` as machine-local state, not user source.
- [ ] Document export and remove guarantees.
- [ ] Update `/config` copy to show origin and portability without overwhelming users.
- [ ] Update CLI help so common verbs are prominent and advanced/internal verbs are de-emphasized.

## Open Decisions

1. **Where should generated single-item package records live?** Options include a state file under
   Roborepo's machine state, generated package folders under a managed user-visible directory, or
   records that point back to the original source path plus cache metadata.
2. **Should `roborepo added` exist, or should this be `roborepo package list --user`?** `added` is
   friendlier; `package list --user` keeps the command tree smaller.
3. **Should direct typed commands be `roborepo add skill` only, or also `roborepo skill add`?**
   Aliases improve discoverability but increase help surface.
4. **How much of MCP/plugin content can export vendor?** Some sources may only be reproducible by
   reference.
5. **Should direct add flows enable immediately by default?** Defaulting to enabled is convenient;
   staging first may feel safer for hooks, permissions, and plugins.
6. **Should package category be free-form?** Free-form categories are flexible but can clutter the
   portal; a fixed list plus `User Installs` fallback is simpler.
7. **How should rule snippets express "chat-time output"?** This might be a category only, or a
   more specific resource subtype/presentation hint.
8. **How should user package sharing handle secrets?** Hook commands, MCP env vars, and plugin
   configuration may include local paths or credentials that should not be exported by default.
9. **When should project-scoped user packages ship?** Global scope matches current control-plane
   behavior; project scope needs separate desired state and UI language.

## Success Criteria

- A user can add one skill without learning package authoring.
- A user can add one MCP server without learning package authoring.
- A user can add a rule snippet, hook, permission, plugin, or command through a guided flow.
- Roborepo represents every user-added item as a package-shaped record internally.
- `/config` shows built-in and user-managed content in one control plane.
- User content carries visible provenance through source paths and origin badges.
- Every add prints a receipt with source, managed ID, live writes, and inspect/export/remove next
  steps.
- User-authored content can be exported to visible files/folders.
- Export does not leak secrets or machine-local values by default.
- Removing a user-managed item does not delete the user's original source unless explicitly asked.
- The main CLI help emphasizes `web`, `onboard`, `add`, `config`, `package`, `skill`, `mcp`,
  `update`, and `doctor`, while keeping advanced verbs available but less prominent.

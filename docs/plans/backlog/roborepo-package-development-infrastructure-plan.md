# RoboRepo Package Development Infrastructure — Implementation Plan

## Purpose

Create one canonical, reusable package-development workflow before implementing the `usage-statusline` package.

This work should remove generic package mechanics from individual feature plans. Future plans should describe what a package does, while RoboRepo's development tooling owns how packages are structured, composed, validated, installed, disabled, and tested.

## Recommendation

Use two complementary mechanisms:

1. A lazily loaded package-development reference inside the existing `roborepo-development` skill.
2. A package scaffold/generator that encodes the routine structure and metadata.

Do not create a separate package-development skill initially. Package creation is part of developing RoboRepo, so a dedicated reference under `roborepo-development` is the smallest clear ownership boundary. Split it into a separate skill only if it later becomes independently installed or used outside RoboRepo development.

The reference explains decisions and guardrails. The scaffold makes the common path mechanical. Neither replaces the other.

## Goals

1. Give agents one discoverable source of truth for creating or modifying a RoboRepo package.
2. Avoid repeating repository-wide package instructions in every feature plan.
3. Encode standard package structure through a scaffold.
4. Make package enable/disable actions take effect immediately without requiring a separate `roborepo update`.
5. Preserve explicit user choices, unmanaged harness configuration, and package ownership.
6. Standardize validation, tests, generated outputs, portal metadata, and uninstall behavior.
7. Keep instructions out of model context unless package development is actually occurring.

## Non-goals

- Implementing the `usage-statusline` package.
- Redesigning the entire RoboRepo package format without evidence that it is necessary.
- Moving package-specific behavior into generic tooling.
- Creating a second installer or configuration composer.
- Making every developer file change automatically modify the user's installed harness configuration.

## Required pre-work discovery

Use JCodeMunch for symbol-level repository discovery where available, then use `rg` for exact paths and configuration keys.

Inspect:

1. The `roborepo-development` skill, its references, and its trigger/loading behavior.
2. Package manifests and schema validation.
3. Existing package templates, examples, generators, or copy commands.
4. Package categories and default-selection metadata.
5. Global, package, and harness composition order.
6. JSON, TOML, Markdown, directory, and executable-asset composition behavior.
7. Bash and PowerShell installation paths.
8. Generated output policy and snapshot conventions.
9. Portal package metadata and selection controls.
10. Enable, disable, install, update, generate, and uninstall commands.
11. Existing backup, ownership, conflict, rollback, and recovery behavior.
12. Tests and contributor validation commands.

Suggested searches:

```sh
rg -n 'roborepo-development|SKILL.md|references/' .
rg -n 'package\.config|package.*schema|default.*enabled|category' .
rg -n 'package.*create|scaffold|template|generator' .
rg -n 'enable|disable|install|uninstall|update|generate|compose|apply' .
rg -n 'settings\.json|config\.toml|toml|json.*merge|merge.*json' .
rg -n 'ownership|conflict|backup|restore|rollback|transaction' .
rg -n 'globals/system|globals/packages|globals/harnesses|generated/' .
```

Do not assume paths or command names from this plan. Map the design onto the current repository.

## Deliverable 1: Package-development reference

Add a focused reference under the existing `roborepo-development` skill, conceptually:

```text
roborepo-development/
  SKILL.md
  references/
    package-development.md
```

The main skill should load this reference only when the task creates, changes, installs, removes, or reviews a RoboRepo package.

The main skill should contain only a short routing instruction such as:

```text
When creating or modifying a RoboRepo package, load references/package-development.md before editing.
```

Do not copy the entire reference into `SKILL.md`. Lazy loading prevents package mechanics from consuming context during unrelated RoboRepo work.

### Reference contents

The reference should document the current repository behavior, not an aspirational parallel system.

Include:

1. Package anatomy and canonical paths.
2. Manifest fields and schema rules.
3. Package naming conventions.
4. Category and default-selection behavior.
5. Source versus generated artifact boundaries.
6. Harness-specific resource locations.
7. Composition and precedence rules.
8. Singleton and array conflict behavior.
9. Runtime asset installation.
10. Cross-platform requirements.
11. Enable, disable, install, upgrade, and uninstall lifecycle.
12. Portal requirements.
13. Token-cost metadata rules.
14. Security and privacy requirements.
15. Required tests and validation commands.
16. Documentation expectations.
17. A concise package completion checklist.

### Package ownership rules

Document these invariants:

- Optional package behavior belongs to the package, not baseline globals.
- A default-enabled package is still removable.
- Generated artifacts are derived and never become a competing source of truth.
- Disabling a package removes only its owned contributions.
- Unmanaged user configuration is never silently destroyed.
- Package upgrades replace managed resources deterministically.
- Package resources must identify their destination and merge behavior.

### Source and generated boundaries

Reflect the repository's current separation. If the planned layout has been implemented, document it explicitly:

```text
globals/
  system/
  packages/
  harnesses/

generated/
  claude/
  codex/
```

If migration is incomplete, document the real current paths and link to the structural migration plan. Do not tell package developers to invent new intermediate locations.

### Configuration merge classes

Document merge semantics by resource type:

| Resource | Expected handling |
| --- | --- |
| Object/map | Deep merge according to current precedence |
| Ordered array | Stable contribution and deduplication when supported |
| Singleton value/object | Exclusive owner or explicit conflict resolution |
| Directory asset | Copy package-owned files without deleting unrelated files |
| Executable/runtime asset | Install to a managed runtime path and track ownership |
| Markdown instructions | Use current composition/marker policy |

The reference must use the actual implemented behavior and clearly mark unsupported merge types.

### Default-selection semantics

Define “default enabled” as a default for new or uncustomized selections, not a permanent mandate.

If RoboRepo does not already preserve selection provenance, add:

```text
selection source = default | explicit-enable | explicit-disable
```

Precedence:

```text
explicit-disable > explicit-enable > current defaults
```

Requirements:

- Updating defaults must not re-enable an explicitly disabled package.
- Removing a default must not disable an explicitly enabled package.
- Portal and CLI output should distinguish default state from explicit override.

## Deliverable 2: Package scaffold

Add or extend an official package creation command using the current CLI conventions, conceptually:

```sh
roborepo package create <package-id>
```

Do not require developers to copy an arbitrary existing package. Existing packages may contain legacy structure or feature-specific resources.

### Scaffold inputs

Required:

- Package ID.
- Display name.
- Description.
- Category.
- Supported harnesses.

Optional:

- Default-enabled state.
- Resource types: config, instructions, skill, command, hook, runtime asset.
- Portal detail content.

Prefer flags for automation and an interactive prompt only when the existing CLI uses interactive flows.

### Scaffold outputs

Generate only requested resource types. Conceptually:

```text
<package-root>/
  package.config.json
  README.md
  claude/
  codex/
  scripts/
  tests/
```

Do not create empty directories that are invalid or ignored by the current package loader.

The scaffold should:

- Validate the package ID before writing.
- Refuse collisions unless an explicit supported overwrite mode exists.
- Use the current manifest schema.
- Add standard token-cost and capability metadata when supported.
- Create minimal test fixtures using current conventions.
- Print next validation commands.
- Never enable or install the new package merely because it was scaffolded.

### Scaffold templates

Keep templates close to the generator and test them as fixtures. Avoid maintaining a complete example package that can drift independently.

Use an example package in documentation only to explain concepts that templates cannot make obvious.

## Deliverable 3: Shared apply pipeline

Package-selection changes should take effect without asking users to run a broad update command.

Create or formalize one internal pipeline, using the repository's existing terminology where possible:

```text
resolve selection
→ compose affected outputs
→ validate
→ install/synchronize affected destinations
→ record applied state
```

This may be called `apply`, `sync`, `reconcile`, or another existing name. Do not add a synonym if a suitable pipeline already exists.

### Enable and disable behavior

These commands should invoke the pipeline automatically:

```text
package enable
package disable
package add/remove from active profile
portal package selection save
```

The user should not have to run `roborepo update` afterward.

The action should report one outcome:

```text
Enabled usage-statusline and synchronized Claude Code and Codex configuration.
```

### Why not automatically run `roborepo update`

An update command normally implies refreshing RoboRepo or package sources. That is broader, slower, and less predictable than applying a local selection change.

Selection actions should call the shared lower-level apply pipeline directly. If today's `update` command is the only code path that composes and installs configuration, extract that reusable portion rather than invoking the entire update operation behind the scenes.

### Other actions that should auto-apply

Automatically apply after a successful action that changes desired installed configuration:

- Enable or disable a package.
- Change active package selection or profile.
- Change enabled harness targets.
- Save portal configuration that affects generated harness output.
- Restore a managed configuration version.
- Complete an install or upgrade that changes selected package resources.

Do not automatically apply after:

- Scaffolding a package.
- Editing package source during development.
- Running validation or tests.
- Previewing or diffing configuration.
- Listing packages.
- Exporting a plan.

Provide an explicit development command to apply source changes when needed.

### Apply command behavior

If there is a user-facing apply command, support:

- Dry-run/preview.
- A clear diff or affected-target summary.
- Non-interactive mode for scripts.
- Scoped application when safe.
- Full reconciliation when requested.

Do not add a routine `--no-apply` path to enable/disable unless there is a real batch-edit workflow. A deferred state creates confusing divergence between selected and installed configuration. If batching is needed, implement a deliberate transaction/batch command.

### Atomicity and recovery

The apply pipeline should:

1. Resolve and compose into temporary outputs.
2. Validate all affected outputs before replacing installed files.
3. Back up or retain the last known-good managed state using current policy.
4. Replace files atomically where supported.
5. Record applied selection only after success.
6. Leave the previous installed state intact on failure.
7. Report exact failed targets and recovery steps.

Avoid a state where the package selection says disabled while its generated configuration remains installed.

## Deliverable 4: Generic conflict and ownership model

Formalize package contribution ownership if it is not already explicit.

Each contribution should be traceable to:

- Package ID.
- Source resource.
- Destination harness/path/key.
- Merge class.
- Generated output.
- Installed output.

Required conflict behavior:

- Managed same-owner update: replace.
- Managed compatible multi-owner contribution: compose deterministically.
- Incompatible multi-owner singleton: fail with actionable diagnostic.
- Identical unmanaged value: optionally adopt using current policy.
- Different unmanaged value: preserve and require explicit resolution.

Never combine arbitrary shell commands automatically to resolve singleton conflicts.

## Deliverable 5: Generic package validation

Add one canonical package validation entry point if one does not exist.

Validate:

- Manifest schema.
- Unique package ID.
- Valid category.
- Supported harness names.
- Declared files exist.
- Destination types are supported.
- Merge class is compatible with destination.
- Default selection metadata is valid.
- Token-cost classification is valid.
- Runtime assets are installable on supported platforms.
- Portal metadata is complete.
- Disable/uninstall ownership is resolvable.

The scaffold should print this command after creation.

## Deliverable 6: Generic test contract

Document and enforce the minimum tests for any new package:

1. Manifest/schema validation.
2. Composition snapshot or semantic assertion for every harness contribution.
3. Explicit-disable precedence when default-enabled.
4. Preservation of unrelated configuration.
5. Conflict behavior for singleton destinations.
6. Fresh install.
7. Upgrade.
8. Disable/uninstall cleanup.
9. Re-enable.
10. Bash and PowerShell parity when installation behavior changes.
11. Portal category and selection representation.
12. Token-cost accounting.

Feature-specific tests remain in the feature package plan.

## Deliverable 7: Portal conventions

Document required package-card metadata:

- Display name.
- Concise purpose.
- Category.
- Harness compatibility.
- Default state.
- Explicit override state.
- Token contribution.
- Compatibility warnings.
- Conflicts or degraded capabilities.

The portal's save action should use the shared apply pipeline and display success or failure. It should not tell the user to run a separate terminal update command.

## Deliverable 8: Documentation and checklist

End the package-development reference with a compact checklist:

```text
[ ] Loaded current package schema and examples
[ ] Used official scaffold or documented canonical structure
[ ] Kept optional behavior out of baseline globals
[ ] Declared destinations and merge behavior
[ ] Preserved unmanaged configuration
[ ] Added disable/uninstall behavior
[ ] Added default-selection provenance where relevant
[ ] Added package and feature-specific tests
[ ] Added portal metadata
[ ] Verified token-cost classification
[ ] Ran repository-required validation
```

## Implementation sequence

### Phase 1: Inspect and document current behavior

1. Map existing skill, package, composer, installer, portal, and test behavior.
2. Identify what already satisfies this plan.
3. List gaps without redesigning working mechanisms.

Exit criteria:

- The implementation is grounded in actual source paths and commands.

### Phase 2: Add the lazy-loaded reference

1. Write `package-development.md` using current behavior.
2. Add a narrow routing instruction to `roborepo-development`.
3. Add skill/reference validation if available.

Exit criteria:

- Package tasks load the reference; unrelated tasks do not.

### Phase 3: Add or strengthen the scaffold

1. Implement the generator using current CLI patterns.
2. Add minimal templates.
3. Add collision, schema, and snapshot tests.
4. Document usage in the package-development reference.

Exit criteria:

- A valid minimal package can be created without copying a legacy package.

### Phase 4: Formalize automatic apply

1. Extract or reuse the narrow compose/validate/install pipeline.
2. Invoke it after selection-changing actions.
3. Add atomicity and failure handling.
4. Update CLI and portal messaging.

Exit criteria:

- Enable/disable takes effect immediately without `roborepo update`.

### Phase 5: Standardize validation and test contracts

1. Add missing generic package validation.
2. Add shared lifecycle fixtures/helpers.
3. Document required tests.
4. Run full repository validation.

Exit criteria:

- The forthcoming `usage-statusline` package plan can reference these tools instead of repeating them.

## Acceptance criteria

- `roborepo-development` lazily loads canonical package-development guidance.
- The guidance reflects current repository behavior and actual commands.
- An official scaffold produces a valid minimal package.
- Optional package behavior remains outside baseline globals.
- Default selection respects explicit enable/disable provenance.
- Package enable/disable automatically composes, validates, and synchronizes affected configuration.
- `roborepo update` is not required for local selection changes.
- Failed application preserves the prior installed state.
- Unmanaged configuration is preserved or surfaced as an explicit conflict.
- CLI and portal use the same apply pipeline.
- Generic package lifecycle tests are reusable by later packages.

## Handoff to usage-statusline

Complete this infrastructure plan first. Then implement `usage-statusline` through the scaffold and package-development reference.

The status-line implementation should not proceed until:

1. The canonical package-development reference exists.
2. The scaffold can represent its required configuration and runtime asset types.
3. Default-enabled selection preserves explicit disable state.
4. Enable/disable automatically applies configuration.
5. Singleton conflict behavior is defined.


---
name: roborepo-support
description: >
  Work with roborepo-managed global agent config from any repo. Use when adding or editing
  shared/exportable skills, skill-backed slash commands, global rules, hooks, settings,
  package-enabled behaviors, MCP entries, or Claude/Codex parity. Triggers: "add a skill",
  "edit global rules", "roborepo support", "harness config", "skill authoring",
  "skill triggers", "roborepo update", "roborepo doctor". SKIP for changing roborepo's
  own installer, CLI internals, package/apply engine, portal, telemetry, or local/skills/;
  use the repo-local roborepo-development skill for that.
---

# Roborepo Support & Skill Authoring

For work with roborepo-managed Claude + Codex configuration: shared skills, generated
rules, hooks, settings, MCP registration, package-enabled behaviors, and cross-harness
parity. This skill is shared/exportable; it should help users operate roborepo from a
local machine without pulling in the repo-internal platform manual.

If the task changes roborepo implementation internals (`scripts/cli/`, installer
plumbing, package/apply/workspace state, portal, telemetry, local repo-only skills), load
the repo-local `roborepo-development` skill instead.

**Read these first when relevant** (they are the source of truth):
- `README.md` — overview of what's shared and per-harness.
- `docs/reference/services/architecture.md` — relationship, materialization map, sync flow.
- `docs/reference/services/roborepo-cli.md`, `docs/reference/services/roborepo-skills.md` —
  current CLI and skill interface.
- `docs/reference/internal/config-collision-handling.md` — conflict rules.
- `docs/reference/services/claude-hooks.md`, `docs/reference/services/codex-hooks.md` — hook behavior.

## The skill model (the #1 thing to get right)

The canonical shared source is a package-owned skill resource at
**`globals/packages/<package>/skills/<name>/`**. The required base support skill is the only current
system skill under **`globals/system/skills/roborepo-support/`**. Roborepo materializes shared
skills into the machine-local cache at `~/.roborepo/skills/<name>`, then both harnesses read from
their native skill dir via symlink:

- `~/.claude/skills/<name>` -> `~/.roborepo/skills/<name>`
- `~/.codex/skills/<name>` -> `~/.roborepo/skills/<name>`

These managed cache entries are created by the installer's enumerate-step
(`install-lib.sh:link_global_skills`), called from `install-claude.sh`, `install-codex.sh`, and
`scripts/build/link-global-skills.sh` (run by `skill new`). Each managed cache entry carries a
`.roborepo-managed` marker. There is no intermediate `globals/claude/skills/` directory.

`roborepo doctor --installed` verifies the live cache entry and harness symlinks are current.
`roborepo doctor` (without `--installed`) checks that source dirs exist in the repo.

## Adding a shared skill

Use `roborepo skill new` — it scaffolds the package config, registers resources, and fans out to
both harnesses in one step:
```bash
roborepo skill new
```
It can create automatic helper skills, skill-backed slash commands, or standalone slash commands.
For medium-risk skill descriptions, add/update trigger fixtures and run:
```bash
roborepo skill triggers --check
```
If you created a skill out-of-band (via native `init_skill.py` or by hand in `~/.codex/skills/<name>`):
```bash
roborepo skill adopt <name>
```
Inspect before changing ownership:
```bash
roborepo skill inspect <name>
```

Manual add (for reference only — prefer the commands above):
1. Create `globals/packages/<package>/skills/<name>/SKILL.md`
2. Add a `skill` resource to `globals/packages/<package>/package.config.json`
3. For slash commands, add a `slash-command` entrypoint or resource and run
   `roborepo skill render-commands --check`
4. Run `roborepo skill sync-global` to refresh the shared skill cache and harness links
5. Update README/docs tables when the user-facing surface changes
6. Verify: `scripts/doctor.sh --installed --quiet`

A `Write|Edit` PreToolUse hook (`globals/claude/hooks/roborepo-write-guard.mjs`,
registered in `globals/claude/settings.json`) fires from any repo when a path under
`~/.claude` or `~/.codex` is written. For roborepo-owned assets, it reminds that the
repo source is canonical and `roborepo update` refreshes HOME. For mutable root config (`~/.claude/settings.json`,
`~/.codex/config.toml`), it reminds that the active file is local and only portable
defaults should be merged back into the repo baseline. It is a reminder, not a block.

## SKILL.md frontmatter

- `name`: kebab-case, matches the folder name.
- `description`: a `>` block. State plainly WHAT the skill does and WHEN to trigger
  it (include trigger phrases and clear skip conditions). The description is the only
  thing the agent sees when deciding to load the skill — make it discriminating, not
  generic. Body holds the actual instructions, loaded only on invocation.

## Editing global rules / behavior

- Generated global rules: edit fragments under `globals/rules/shared/`,
  `globals/rules/claude/`, or `globals/rules/codex/`, then run
  `roborepo rules --check` or `roborepo rules`.
- Hooks: `globals/claude/hooks/` + `globals/claude/settings.json`; `globals/codex/hooks.json`. Automated
  "always do X" behaviors must be hooks — the harness runs them, not the model.
- Settings/permissions: portable baselines live in `globals/claude/settings.json`,
  `globals/codex/config.toml`, and `manifests/inventory/agent-permissions.json`; render/check
  permission outputs with `roborepo permissions --check`.
- After editing a copied/read-mostly asset in repo source, run `roborepo update` to refresh HOME.
  Mutable root config (`globals/claude/settings.json`, `globals/codex/config.toml`) is exported into HOME as
  active local files, not symlinked.
- On collisions between HOME and repo, follow
  `docs/reference/internal/config-collision-handling.md` — flag conflicts, don't guess.

## Local Machine Commands

- `roborepo package manage` toggles enabled skills, commands, package behavior, and chat-time output.
- `roborepo update` reapplies copied/rendered config after pulling repo changes.
- `roborepo doctor --installed` checks live `~/.claude`, `~/.codex`, and `~/.roborepo` state.
- `roborepo config root inspect` reports drift between portable baselines and active root config.
- `roborepo web` opens the local portal for config and telemetry.
- `roborepo package enable <package-id>` / `package disable <package-id>` wires package-owned MCP, hooks, rules,
  permissions, and command behavior.

## Parity principle

This repo's whole point is Claude/Codex parity. When you add or change a capability
on one harness, ask whether the other needs the mirror, and say so explicitly if you
intentionally leave them different.

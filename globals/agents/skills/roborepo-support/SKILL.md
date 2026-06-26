---
name: roborepo-support
description: >
  Work on this repo — the version-controlled global config source that
  is copied/rendered into ~/.claude and ~/.codex. Use when adding or editing a shared skill,
  changing global agent rules (CLAUDE.md / AGENTS.md), hooks, settings, commands,
  or keeping Claude/Codex parity. Activates only when the task touches global harness
  config or skill authoring, in any repo. Triggers: "add a skill", "edit global
  rules", "roborepo support", "harness config", "skill authoring", editing files in this repo.
---

# Roborepo Support & Skill Authoring

For work on this repo: the version-controlled source for global
Claude + Codex configuration. The local checkout path is user-specific; install
scripts copy/render relevant HOME config paths from this repo. This skill carries
the gotchas that are easy to get wrong; it does not duplicate the repo's own docs.

**Read these first when relevant** (they are the source of truth):
- `README.md` — overview of what's shared and per-harness.
- `docs/reference/services/architecture.md` — relationship, materialization map, sync flow.
- `docs/reference/internal/config-collision-handling.md` — conflict rules.
- `docs/reference/services/claude-hooks.md`, `docs/reference/services/codex-hooks.md` — hook behavior.

## The skill model (the #1 thing to get right)

The canonical shared source is **`globals/agents/skills/<name>/`**. Both harnesses read skills
from their native skill dir:

- `~/.claude/skills/<name>` — copied from `<repo>/globals/agents/skills/<name>`
- `~/.codex/skills/<name>` — copied from `<repo>/globals/agents/skills/<name>`

These managed skill copies are created by the installer's enumerate-step
(`install-lib.sh:link_global_skills`), called from `install-claude.sh`, `install-codex.sh`, and
`scripts/build/link-global-skills.sh` (run by `skill new`). Each managed copy carries a
`.roborepo-managed` marker. There is no intermediate `globals/claude/skills/` directory.

`roborepo doctor --installed` verifies all live managed skill copies are current.
`roborepo doctor` (without `--installed`) checks that source dirs exist in the repo.

## Adding a shared skill

Use `roborepo skill new` — it scaffolds, registers, and fans out to both harnesses in one step:
```bash
roborepo skill new
```
If you created a skill out-of-band (via native `init_skill.py` or by hand in `~/.codex/skills/<name>`):
```bash
roborepo skill adopt <name>
```

Manual add (for reference only — prefer the commands above):
1. Create `globals/agents/skills/<name>/SKILL.md`
2. Register in `manifests/inventory/skill-invocation.json`
3. Run `scripts/build/link-global-skills.sh` to refresh copied shared skills
4. Add a one-line entry under **Shared Skills** in `README.md`
5. Verify: `scripts/doctor.sh --installed --quiet`

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

- Claude global rules: `globals/claude/CLAUDE.md`. Codex: `globals/codex/AGENTS.md`. Keep behavior
  intent in parity across both unless a difference is intentional (note it).
- Hooks: `globals/claude/hooks/` + `globals/claude/settings.json`; `globals/codex/hooks.json`. Automated
  "always do X" behaviors must be hooks — the harness runs them, not the model.
- Settings/permissions: `globals/claude/settings.json`, `globals/codex/config.toml`.
- After editing a copied/read-mostly asset in repo source, run `roborepo update` to refresh HOME.
  Mutable root config (`globals/claude/settings.json`, `globals/codex/config.toml`) is exported into HOME as
  active local files, not symlinked.
- On collisions between HOME and repo, follow `docs/config-collision-handling.md` —
  flag conflicts, don't guess.

## Parity principle

This repo's whole point is Claude/Codex parity. When you add or change a capability
on one harness, ask whether the other needs the mirror, and say so explicitly if you
intentionally leave them different.

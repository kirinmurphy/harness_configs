# Rules Parity and Override Layering

## Purpose

Claude and Codex should share the same global behavior defaults without hand-maintaining equivalent rule text in `globals/claude/CLAUDE.md` and `globals/codex/AGENTS.md`. The system also needs clear priority rules so global defaults do not accidentally override user-owned or repo-local context.

## Current Behavior

- `globals/claude/CLAUDE.md` and `globals/codex/AGENTS.md` are generated tracked files.
- Both files express the same core behavior through shared fragments: skill loading, verification, and temp-file hygiene.
- Live Claude home rules are inline: `~/.claude/CLAUDE.md` contains the full Claude render inside a managed block.
- Live Codex home rules are inline: `~/.codex/AGENTS.md` contains the full Codex render inside a managed block.
- Project Context orientation is package-gated with the `/inventory` workflow under `globals/packages/project-context/rules.md`.
- The three Chat-Time Output behaviors (skill visibility, session capture, impact awareness) are no longer base fragments. They ship as default-on rules packages under `globals/packages/<id>/rules.md` and merge into both harness rules files when enabled, so they can be toggled per behavior. See [config-control-panel.md](../services/config-control-panel.md).
- Harness-specific fragments hold Claude-only or Codex-only differences.
- Root harness config files are conditional defaults:
  - `~/.claude/settings.json`
  - `~/.codex/config.toml`
- The installer preserves user-owned root config through the `keep`, `overwrite`, and `abort`
  collision policies documented in [Config Collision Handling](config-collision-handling.md).
- Repo-local instructions still layer through project files such as `CLAUDE.md`, `AGENTS.md`, and repo instructions.

## Implemented Behavior

Use shared source fragments for common behavior and render the harness-specific global files from those fragments.

Source layout:

```text
globals/rules/
  shared/
    05-skill-loading.md
    20-verification.md
    40-temp-files.md
  claude/
    90-claude-specific.md
  codex/
    90-codex-specific.md
globals/packages/
  <package>/
    rules.md
```

Tracked generated baseline snapshots:

```text
globals/claude/CLAUDE.md
globals/codex/AGENTS.md
```

Live generated outputs:

```text
~/.claude/CLAUDE.md                         # full Claude render, inline managed block
~/.codex/AGENTS.md                          # full Codex render, inline managed block
~/.codex/AGENTS.override.md                 # updated only when it already exists
```

Tracked generated snapshots remain in the repo because setup and drift checks should work without running a build step first. Live home files are rendered by `scripts/cli/rules-render.mjs` from the tracked fragments plus the enabled-package registry.

When a live `CLAUDE.md` or `AGENTS.md` already contains user text, roborepo injects or replaces only
its managed block (`<!-- BEGIN managed:roborepo-code-style -->` ... `<!-- END managed:... -->`).
Text outside that block stays user-owned. On first install, a genuine user-authored file is also
snapshotted under `~/.roborepo/backups/pre-install/<harness>/` before the managed block is added.

## Rules Parity Model

- Shared fragments hold behavior that should apply to both harnesses.
- Harness-specific fragments hold only true harness differences. Claude-specific fragments land directly in the live Claude managed block; Codex-specific fragments land directly in the live Codex managed block.
- Shared fragments should stay compact. Expanded workflow guidance belongs in skills such as `test-harness`, `code-style`, `javascript-typescript`, `react`, or `roborepo-support`.
- Global rules may tell the agent when to use a skill, but should not duplicate the full skill body.
- The renderer should preserve deliberate format differences:
  - Claude can keep Markdown sections.
  - Codex can keep short bullets matching `AGENTS.md` style.

## Override Layers

Priority from lowest to highest:

1. Shared global defaults from this repo.
2. Harness-specific global defaults from this repo.
3. User-owned root config preserved by collision policy.
4. Repo-local instructions for the active project.
5. Direct user instructions in the current conversation.

Root config collision policy applies to settings/config files, not to generated global rule files. A
user-owned root config can override MCP, model, hook, permission, profile, plugin, or project
behavior. It should not silently fork shared global instruction text unless the user intentionally
replaces those files too.

Repo-local context should refine or constrain global defaults for the active project. It should not require changing this repo unless the convention is useful across projects.

## Operational Workflow

Edit rule fragments, then render outputs:

```sh
./scripts/build/render-rules.sh
```

Check generated output drift:

```sh
./scripts/build/render-rules.sh --check
```

`doctor.sh` also runs the drift check.

## Open Decisions

- Whether the renderer should support frontmatter fields such as `targets`, `order`, and `title`, or keep simple sorted Markdown concatenation.
- Whether generated Codex output should stay with Markdown section headings or return to shorter bullet-only formatting.

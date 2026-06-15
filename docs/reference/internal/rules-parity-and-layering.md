# Rules Parity and Override Layering

## Purpose

Claude and Codex should share the same global behavior defaults without hand-maintaining equivalent rule text in `globals/claude/CLAUDE.md` and `globals/codex/AGENTS.md`. The system also needs clear priority rules so global defaults do not accidentally override user-owned or repo-local context.

## Current Behavior

- `globals/claude/CLAUDE.md` and `globals/codex/AGENTS.md` are generated tracked files.
- Both files express the same core behavior through shared fragments: caveman mode, skill loading and visibility, code/doc exploration, verification, session capture, impact awareness, temp-file hygiene, and project-context orientation.
- Harness-specific fragments hold Claude-only or Codex-only differences.
- Root harness config files are conditional defaults:
  - `~/.claude/settings.json`
  - `~/.codex/config.toml`
- The installer can leave root config user-owned through `adopt`.
- Repo-local instructions still layer through project files such as `CLAUDE.md`, `AGENTS.md`, and repo instructions.

## Implemented Behavior

Use shared source fragments for common behavior and render the harness-specific global files from those fragments.

Source layout:

```text
rules/
  shared/
    00-communication.md
    05-skill-loading.md
    06-skill-visibility.md
    10-exploration.md
    20-verification.md
    30-session-capture.md
    35-impact-awareness.md
    40-temp-files.md
    50-project-context.md
  globals/claude/
    90-claude-specific.md
  globals/codex/
    90-codex-specific.md
```

Generated outputs:

```text
globals/claude/CLAUDE.md
globals/codex/AGENTS.md
```

Generated files remain tracked because the harnesses read them directly and setup should work without running a build step first. The renderer adds a generated-file header that names the source fragments and command.

## Rules Parity Model

- Shared fragments hold behavior that should apply to both harnesses.
- Harness-specific fragments hold only true harness differences.
- Shared fragments should stay compact. Expanded workflow guidance belongs in skills such as `test-harness`, `code-style`, `javascript-typescript`, `react`, or `roborepo-support`.
- Global rules may tell the agent when to use a skill, but should not duplicate the full skill body.
- The renderer should preserve deliberate format differences:
  - Claude can keep Markdown sections.
  - Codex can keep short bullets matching `AGENTS.md` style.

## Override Layers

Priority from lowest to highest:

1. Shared global defaults from this repo.
2. Harness-specific global defaults from this repo.
3. User-owned root config when installer uses `adopt`.
4. Repo-local instructions for the active project.
5. Direct user instructions in the current conversation.

Root config adoption applies to settings/config files, not to generated global rule files. A user-owned root config can override MCP, model, hook, permission, profile, plugin, or project behavior. It should not silently fork shared global instruction text unless the user intentionally replaces those files too.

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

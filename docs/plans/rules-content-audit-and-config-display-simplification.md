# Rules Content Audit And Config Display Simplification

> Status: planned. This records the current rules-content audit and the next portal
> simplification step for `/config`.

## Purpose

`roborepo` now splits global rules across shared fragments, harness-specific fragments,
and package-gated rule packs. The current control-panel preview makes that layering visible,
but it is harder to read than the actual files the user lives with.

This plan keeps the audit findings in one place and describes the display change that should
follow: show the live `CLAUDE.md` / `AGENTS.md` files directly, then expose the baseline
slice views as optional drill-downs.

## Current State

The current rules source layout is:

- `globals/rules/shared/*.md` for shared baseline rules
- `globals/rules/claude/*.md` for Claude-only baseline rules
- `globals/rules/codex/*.md` for Codex-only baseline rules
- `globals/packages/*/rules.md` for package-gated rule content

The rendered global harness files are tracked outputs:

- `globals/claude/CLAUDE.md`
- `globals/codex/AGENTS.md`

The `/config` portal currently shows the rules content as split previews:

- shared baseline
- Claude baseline
- Codex baseline
- enabled package rules

That view is useful for auditing the render pipeline, but it hides the actual live file
shape, including managed markers and user-authored edits.

## Audit Findings

### Shared baseline

`globals/rules/shared/05-skill-loading.md`, `20-verification.md`, `40-temp-files.md`, and
`50-project-context.md` are baseline behavior and belong in the generated harness files.

`globals/rules/shared/00-communication.md` is no longer a good baseline home for caveman
behavior. Caveman now lives in the `globals/packages/caveman/rules.md` package rule, so the
shared baseline should not reintroduce package-gated behavior.

### Harness-specific baseline

`globals/rules/claude/90-claude-specific.md` and `globals/rules/codex/90-codex-specific.md`
should remain the only harness-specific baseline fragments unless a true harness difference
appears.

### Package-gated rules

Package rule content belongs in `globals/packages/*/rules.md`, not in the baseline shared or
harness-specific fragments. The package-controlled behaviors are the right place for output
style add-ons and other optional behavior.

## Proposed State

The `/config` portal should switch from a fragment-by-fragment rules preview to the live
on-disk files.

The main rules area should:

1. Show the actual live `CLAUDE.md` and `AGENTS.md` file content from the user's machine.
2. Preserve visible boundary markers and any user-authored text already in those files.
3. Show only Claude and Codex selectors at the top, and only when both harnesses are present.
4. Show a short `Roborepo defaults` line below the scrollable file view with drill-down
   buttons for:
   - Global baseline
   - Claude baseline
   - Codex baseline
   - Tool Add-Ons
5. Render those drill-down popups, the live file view, and skill source popups with a markdown
   renderer instead of plain text.

## Happy Path

1. A user opens `/config`.
2. The portal shows the live `CLAUDE.md` or `AGENTS.md` file as rendered markdown.
3. If both harnesses exist, the user can switch between them with a small Claude/Codex control.
4. The file view shows managed markers, generated rules, and any user text that already lives
   in the file.
5. The `Roborepo defaults` buttons open rendered snippet popups for the shared baseline,
   harness-specific baseline, and enabled package rule slices.

## Edge Cases

- If only one harness exists, the portal should show that file without any harness toggle.
- If a live rules file does not exist yet, the portal should show a clear empty-state message
  rather than a fake preview.
- If a snippet is empty, its drill-down button should be disabled or hidden.
- Markdown content should render safely in the portal; raw HTML should not be trusted.

## Implementation Checklist

1. Add or reuse a markdown renderer for the config portal source popup and live rules view.
2. Replace the split rules-preview panel with a live-file panel backed by the on-disk home files.
3. Keep the shared/harness/package slice data available for the drill-down buttons.
4. Only show the Claude/Codex selector when both live files are present.
5. Update the config-panel reference docs after the portal shape settles.

## Open Decisions

- Whether the live rules view should poll the live files separately or keep reading them as part
  of the existing config snapshot.
- Whether the `Roborepo defaults` buttons should stay inline text buttons or become a compact
  segmented control.


---
id: usage-statusline-claude-refresh
priority: low
next_action: Verify the exact Claude statusLine refresh/interval config property and minimum supported version from official Claude Code documentation, then add it to the package's claude/statusline.json.
blocked_by: []
depends_on: [usage-statusline-enhancement-plan]
related: [usage-statusline-enhancement-plan]
reviewed_commit:
---

# Usage Statusline — Claude Idle Refresh Property

## Summary

Give the Claude `usage-statusline` a timed refresh so the weekly **elapsed** percentage keeps moving
while a session sits idle. Elapsed is computed from `resetsAt` and the window duration at render
time, so it is always correct _when the status line renders_ — but Claude only re-runs the status
command on activity. During a long idle stretch the displayed `## elapsed` (and therefore the
debt/surplus classification) can look frozen until the next render.

This was split out of `usage-statusline-enhancement-plan` because it is low-consequence, easily
added later, and — unlike the rest of that plan — depends on a Claude config property whose exact
name and minimum supported version must be confirmed against official documentation before it is
committed. Adding a wrong key risks being silently ignored or erroring on older Claude versions.

## Goals

- Elapsed percentage advances on a timer while idle, not only on activity.
- No change to the rendered text, color rules, or zero-prompt-token behavior.
- The refreshed status line stays a single owned Claude `statusLine` singleton (existing
  equality/probe/conflict behavior preserved).

## Current state

- `globals/packages/usage-statusline/claude/statusline.json` installs a command-backed `statusLine`
  with `type`, `command`, and `padding` only — no refresh/interval property.
- The formatter already recomputes elapsed on every invocation, so no formatter change is required;
  this is purely a Claude harness-config addition.
- `scripts/cli/package-harness-config.mjs` treats the Claude `statusLine` as one owned singleton and
  the probe compares the whole object. Any new property must be included in that owned object so
  equality/probe still match.

## Implementation plan

- [ ] Confirm from current official Claude Code documentation the exact `statusLine` property that
      controls timed/interval refresh, its accepted values/units, and the minimum Claude version
      that supports it.
- [ ] Record that minimum version alongside the package's other version notes (README + the parent
      plan's "Minimum harness versions").
- [ ] Add the verified property to `claude/statusline.json`.
- [ ] Confirm the installed `statusLine` object still round-trips through
      `package-harness-config.mjs` merge/unmerge and the `package-probes.mjs` equality check as a
      single owned singleton (update the lifecycle test if the owned object shape changes).
- [ ] Manually confirm on macOS that elapsed advances while the session is idle.

## Validation / acceptance criteria

- `npm run test:usage-statusline` passes with the refresh property present in the owned object.
- Enable/disable remains idempotent and preserves an unmanaged Claude `statusLine`.
- Manual macOS check: with a session left idle, the weekly `## elapsed` value increases without user
  activity, and debt/surplus reclassifies accordingly.
- The property is documented with its minimum supported Claude version; the package does not silently
  install an unsupported key on older versions.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Wrong property name silently ignored | Verify against official docs before committing; manual idle smoke test confirms it actually fires |
| Property errors on older Claude versions | Record and gate on a minimum supported version |
| Refresh property breaks the owned-singleton equality/probe | Include it in the owned object and update equality/probe tests together |

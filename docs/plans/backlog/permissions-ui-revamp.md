---
id: permissions-ui-revamp
priority: medium
next_action: Decide the intent-vs-mechanism display model — whether the UI shows one intent per behavior with per-harness fidelity indicators, or separate per-harness views
blocked_by: []
depends_on: []
related:
  - harness-capability-derived-resource-targeting
  - harness-parity-todo
  - codex-cmux-hook-trust-review
reviewed_commit:
---

# Permissions UI Revamp

Rework how permissions are presented and edited in the portal config surface, and make per-harness
fidelity visible rather than silent.

## Motivating defect

A permission bucketed `ask` does not survive the trip to every harness, and today nothing tells
you that.

`manifests/inventory/agent-permissions.json` buckets `delete-files` (`rm`, `git rm`) as `ask`.
Claude renders a per-command prompt on `rm` specifically. Codex has no per-command `ask` tier, so
`renderCodexRules` (`scripts/harnesses/permissions-render.mjs:130`) skips the rule and
`codexApprovalPolicy` instead sets a session-wide `approval_policy = "on-request"`. The generated
`generated/codex/config.toml` contains that policy line and **no `rm` rule at all**.

Two distinct failures result:

- **Over-prompting.** The approval policy is global, so unrelated commands prompt too.
- **Under-protecting — the serious one.** `approval_policy` is a mode, not a rule. If it is changed
  by a user, a preset, or a future default, `rm` silently loses its guardrail. The stated intent
  ("always ask before deleting") is not durably encoded anywhere in Codex's config, so nothing
  fails loudly when it stops being enforced.

The UI currently shows one bucket per behavior, implying uniform enforcement. That implication is
false, and the divergence is invisible at exactly the surface where a user forms their mental model
of what is protected.

## Goals

- The UI states what each harness will *actually* enforce, not just what was requested.
- A behavior whose intent cannot be expressed faithfully on some harness is visibly marked, with
  the reason.
- Editing a permission shows the per-harness consequence before it is applied.
- Degradations are named in the product, not only in code comments.

## Non-goals

- Achieving per-command `ask` on every harness. That is
  [[harness-capability-derived-resource-targeting]] Phase 5's job; this plan surfaces the gap and
  consumes the fix when it lands.
- Changing the bucket vocabulary (`allow`/`ask`/`deny`).
- Reworking `codex_tool_approvals` or plugin-shaped config.

## Required test scenarios

These must pass before this plan is considered done. The first is the regression this plan exists
to make impossible.

- [ ] **`delete-files` fidelity is visible.** With `delete-files` bucketed `ask`, the UI shows
      Claude enforcing a per-command prompt and Codex enforcing a session-wide approval policy —
      not one undifferentiated "ask" badge across both.
- [ ] **Degradation carries a reason.** The Codex entry explains that per-command `ask` is
      unavailable and that the protection is therefore mode-based, not rule-based.
- [ ] **The fix is consumed, not special-cased.** Once
      [[harness-capability-derived-resource-targeting]] Phase 5 lands per-command `ask` for Codex,
      the same behavior renders as a genuine per-command prompt with no UI change required beyond
      re-reading capability data.
- [ ] **A third provider inherits the model.** Gemini's permission fidelity is derived from its
      provider manifest, not from a claude/codex special case.
- [ ] **No silent uniformity.** Any behavior whose rendered result differs across harnesses is
      marked; a test asserts the marker appears for at least the known-divergent case.

## Open questions

- Does the UI present one intent per behavior with per-harness fidelity indicators, or separate
  per-harness views? The first matches how a user thinks; the second matches what is enforced.
- Should a behavior that cannot be faithfully expressed on an enabled harness be blocked at edit
  time, warned about, or silently accepted and marked afterward?
- Where does fidelity data come from — a new field on the provider manifest describing which
  buckets it can express per-command, or inferred from the adapter's capabilities?
- Should `roborepo doctor` also report intent-vs-enforcement divergence, so it is catchable outside
  the UI?

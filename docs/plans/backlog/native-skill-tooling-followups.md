---
id: native-skill-tooling-followups
priority: low
next_action: Extend doctor --installed to report unmanaged/native skill metadata without treating it as failure
blocked_by: []
depends_on: []
related: [native-skill-tools-boundary]
reviewed_commit: b8684ef
---

# Native Skill Tooling — Follow-ups

## Summary

Incremental tooling carved out of
[`completed/native-skill-tools-boundary.md`](../completed/native-skill-tools-boundary.md).
The boundary decision and the read-only inventory model shipped
(`roborepo skill inspect`, the shared `/config` inventory model). What remains is
smaller, additive tooling that layers on that model without changing the
boundary itself.

## Context

The parent recorded the product boundary: roborepo is a thin orchestration and
parity layer over native Claude/Codex skill systems, not a replacement. Its
inventory/inspection surface shipped. The three remaining checklist items and the
open decisions do not require re-deciding that boundary — they extend reporting,
adoption feedback, and optional pinning on top of it.

## Goals

- Surface native/unmanaged skill metadata in `doctor` without flagging it as a
  failure.
- Give `skill adopt` a native-feature report so nothing is silently lost.
- Add optional pinning for roborepo-managed skills only.

## Current state

Shipped (parent plan): read-only inventory model; `roborepo skill inspect
<name>` (`scripts/cli/skills.mjs` → `skill-inventory.mjs`); `/config` skill popup
on the same model; reference docs for the read model and portal behavior.

Not built: doctor native-metadata reporting; `skill adopt` native-feature
report; managed-skill pin metadata.

## Proposed behavior

### `doctor --installed` native metadata

Report unmanaged/native skill metadata as informational, never as a failure.

### `skill adopt` native-feature report

After copying files, print native-only features rather than rewriting them:
Claude-only frontmatter, Codex-only `agents/openai.yaml` policy/dependency
fields, scripts/references, eval artifacts, plugin-adjacent metadata. Ask the
user to review any harness-specific behavior that cannot be preserved
identically across Claude and Codex.

### Managed-skill pinning

For roborepo-owned cache entries only: pin to the current repo revision or
content hash; prevent `roborepo update` from replacing a pinned entry without an
explicit unpin; report pinned skills in `doctor --installed` and the portal. Do
not block native plugin/marketplace updates.

## Implementation plan

- [ ] Extend `doctor --installed` to report unmanaged/native skill metadata
      without treating it as failure. (parent checklist item 5)
- [ ] Make `skill adopt` print a native-feature report after copying files.
      (parent checklist item 6)
- [ ] Add optional managed-skill pin metadata for roborepo-owned cache entries.
      (parent checklist item 7)

## Validation

- A native-created skill adopts without losing frontmatter, sidecars, scripts,
  references, or eval artifacts, and the adopt report names any harness-specific
  behavior at risk.
- `doctor --installed` shows native/unmanaged skills as informational, not as
  errors.
- A pinned managed skill survives `roborepo update` unchanged until unpinned.
- `roborepo doctor` and `roborepo verify` remain green.

## Open questions

Carried from the parent's open decisions:

- Should roborepo write native visibility settings, or only report them?
- Should pins live in the repo, in `~/.roborepo/state`, or both?
- Should `skill adopt` preserve original native scope metadata for later
  export-back?
- Should plugin-provided skills appear in the same portal table as skill
  folders, or in a separate Plugins section?
- Should roborepo expose native marketplace commands as pass-through helpers, or
  link users to native flows?

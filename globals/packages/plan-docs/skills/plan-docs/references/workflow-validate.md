# Validate Workflow

Check:

- Schema: recognized lifecycle folder, required frontmatter, unique stable ID, valid enums, normalized arrays.
- Naming: filename is lowercase-hyphenated `<namespace>-<slug>.md`, with no lifecycle, status, date,
  or version suffix. **Naming is checked only when the repository declares project namespaces in
  `docs/plans/plans-config.json`** — a repository without that file gets no naming findings at all,
  because the universal namespaces in `plan-schema.md` are a fallback vocabulary rather than a
  default that applies on its own. Where the check does run, the allowed prefixes are the universal
  namespaces plus the declared project ones. Findings are reported for `backlog` and `active` only —
  `completed` and `archived` hold names from before the convention and are left alone.
- Structure: title, summary, context/current state, implementation path, validation criteria, actionable tasks when appropriate.
- Lifecycle: active has work and next action; completed has no required unresolved work; archived explains abandonment or supersession; unclassified root docs are flagged.
- Repository consistency: referenced paths exist when expected, current-state claims are supported, named commands/tests exist, completed claims have evidence.
- Relationships: dependencies resolve, no self-dependency, cycles reported, completed dependencies distinguished from unresolved dependencies.

Report findings. Apply fixes only when the user requested changes or the command contract allows safe normalization.

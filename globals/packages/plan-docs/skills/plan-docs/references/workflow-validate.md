# Validate Workflow

Check:

- Schema: recognized lifecycle folder, required frontmatter, unique stable ID, valid enums, normalized arrays.
- Structure: title, summary, context/current state, implementation path, validation criteria, actionable tasks when appropriate.
- Lifecycle: active has work and next action; completed has no required unresolved work; archived explains abandonment or supersession; unclassified root docs are flagged.
- Repository consistency: referenced paths exist when expected, current-state claims are supported, named commands/tests exist, completed claims have evidence.
- Relationships: dependencies resolve, no self-dependency, cycles reported, completed dependencies distinguished from unresolved dependencies.

Report findings. Apply fixes only when the user requested changes or the command contract allows safe normalization.

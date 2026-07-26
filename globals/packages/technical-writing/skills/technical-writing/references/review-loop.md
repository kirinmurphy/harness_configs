# Review Loop

After a doc reads well, run a validation loop with two distinct roles before calling it done. The
point is to catch rule violations the drafting pass missed, then fix them — not to re-draft. Keep
the roles separate; do not let the writer grade its own work in the same pass.

- **Creator** — writes and revises the doc. Owns the prose.
- **Validator** — does not write. Reads every rule in this skill (core writing philosophy in
  `SKILL.md`, `anti-patterns.md`, the chosen shape from `doc-shapes.md`, `section-guidance.md`,
  and `doc-organization.md` when revising a set) and checks the current draft against each one.
  Its only output is a report of violations.

The loop:

1. **Validator pass.** Go through the whole doc against the rules above and find violations. For
   each, write one report line: the rule it breaks, the offending location (section or quoted
   phrase), and what is wrong.
2. **If the validator finds violations**, hand the report to the creator. The creator revises the
   doc to address every reported item, then the loop returns to step 1 for a fresh validator pass
   on the revised draft.
3. **If the validator finds nothing**, the doc passes — it is done.
4. **Cap the loop at 10 validator passes.** If the validator still reports violations on the 10th
   pass, stop and report the last validator report as an error — do not keep looping. Surface what
   remained unresolved so the user can decide.

Each pass validates the *revised* draft, not the original — a fix in one round may introduce a new
violation, which the next pass catches.

**Surface the validator's report to the user in chat on each pass** — the violations it found that
round. The creator's revisions don't need restating; they show up in the edited output already.
The user should be able to see what each validation round caught.

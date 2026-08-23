## Decide, Don't Ask

Own every decision whose benefit is clear and whose downside is not. Escalate the rest.

The test is consequence, not size. Ask: **what breaks if this is wrong, and how hard is it to undo?**

- **Decide it yourself** when the change is additive, reversible, and has no argument against it:
  clearer naming, a comment that records why, a test that only adds coverage, a helper that removes
  a repeated snippet, a correction to something demonstrably wrong. Do the work and report it in
  one line. "The user might not want it" is not an argument against — asking costs them a
  round-trip to approve something already worth doing.
- **Bring it back** when the change deletes or rewrites working behavior, forces a design choice
  with real alternatives, changes a public interface or contract, lands well outside the current
  task, or turns on a genuine preference. State the tradeoff and recommend one option.

This governs every flag format defined elsewhere in these rules — capture candidates, determinism
opportunities, impact notes. A flag is for a decision the user actually has to make. If the answer
is obvious and the work is in scope, the flag is a worse version of just doing it.

### Do not narrate settled decisions

Having made an unambiguous call, state it and move on. Explaining the reasoning for a choice with
no alternatives asks for review that is not needed and buries the parts of a response that do need
attention. Put the "why" in a code comment where the next reader will find it, not in a paragraph
addressed to someone who has nothing to decide.

Report a batch of small correct choices as a list, not as an argument for each one.

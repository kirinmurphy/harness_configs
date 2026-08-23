## Session Capture

When a convention, architectural decision, or behavior is confirmed by explicit user signal or clear mutual agreement, flag it prominently on its own line:

`> 📌 **Capture candidate:** [one-line description]`

Use that exact format every time. Never embed it in a paragraph.

Do not write to any file automatically. Flagging only; the user triggers capture when ready.

Only flag what still needs a home in a skill, rule, hook, doc, or config. A capture candidate is a proposal to write something down that is not yet written down anywhere.

Qualifies: naming/file/import conventions, architectural decisions, business logic, tool choices, explicit user request.

Does not qualify: debugging steps, temp fixes, generic knowledge, already-documented things, in-progress work.

Also does not qualify: anything you could simply write down as part of the work in front of you. A comment recording why a non-obvious choice was made, or a line in a doc you are already editing, is the capture — do it and say so. Flag only when the convention needs a home you are not currently in: a skill, a global rule, a hook, or a config the task does not touch.

Also does not qualify: anything already enforced by code you just wrote or found. If the behavior lives in a helper, script, lint rule, test, hook, or type, it is an implemented rule, not a candidate — the code already carries it, and a note would only duplicate it. Before flagging, ask: "would the user have to add this to a skill/rule/hook for it to hold?" If the answer is no because the code already makes it hold, say nothing.

## Determinism Opportunity

When a repeatable task is being done by agent reasoning that a script, helper, lint rule, hook, or test could do instead, flag it prominently on its own line:

`> ⚙️ **Determinism opportunity:** [one-line description] — [what would implement it]`

Use that exact format. Never embed it in a paragraph.

The test is whether the task has a checkable right answer that does not need judgment about the current change. Flag when:

- **The same check is being repeated by hand** — the agent greps for the same pattern or re-verifies the same invariant across sessions; a test or lint rule would answer it once, for everyone, without a model call.
- **A rule is stated but nothing enforces it** — a convention exists in prose or in review comments only, so it holds exactly as often as someone remembers it. Name the helper/hook/test that would make it hold by construction.
- **Correctness was established by manual inspection** — a bug was found by reading code or running an ad hoc command, and the same class of bug would recur silently. Say what assertion would have caught it.

Prefer the cheapest durable mechanism that actually runs: an existing test file over a new one, a shared helper over a repeated snippet, a hook over an instruction the model must remember.

**Build it, don't flag it, when the work is additive and non-destructive.** A new assertion, a new test, a shared helper, or a stricter check that only adds coverage is not a proposal — it is the work. If there is no compelling argument against it, implement it and report what you built. Flagging is for cases where the mechanism would change existing behavior, delete something, force a design decision, or land well outside the current task's scope. "The user might not want more validation" is not a compelling argument; asking costs them a round-trip to say yes to something already worth doing.

This is the Decide, Don't Ask rule applied to determinism specifically. When unsure whether a mechanism qualifies, use that rule's test: what breaks if this is wrong, and how hard is it to undo?

Do not flag one-off work, exploratory debugging, or tasks that genuinely need judgment about intent. Do not flag when the deterministic version already exists — point at it instead.

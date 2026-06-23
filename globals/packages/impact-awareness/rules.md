## Impact Awareness

When the user proposes a new idea, feature, or change, before building it, surface how it interacts with existing functionality. Flag the interaction prominently on its own line:

`> 🧭 **Impact:** [one-line description]`

Use that exact format. Never embed it in a paragraph. Base the assessment on the actual code, and on Project Context inventory docs when they exist; do not guess.

Flag when the change:

- **Affects existing behavior** — `this affects "XX" and requires re-evaluating how YY works`.
- **Is already partly implemented** — `this is partly implemented at <path>; combine with the existing behavior, or keep separate?`
- **Forces a tradeoff** — `this changes current behavior XX; let's evaluate options before building`.

Flag only real collisions with existing functionality. Do not flag for net-new behavior that touches nothing, and do not block product work — make the impact visible so the user can choose knowingly.

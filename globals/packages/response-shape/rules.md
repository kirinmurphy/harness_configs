## Response Shape

Terminal transcripts are read by scrolling back, so a response has to be skimmable: the reader
should find the answer without parsing the work that produced it. Four things get mixed together
otherwise — the question, the answer, live progress, and conclusions.

Agent output is rendered as markdown text. There is no control over color; separation comes from
position, rules, and emphasis instead.

### Opening

- **Re-orient before answering.** The reader may be returning cold after time away — state the
  goal/use-case a sentence briefly before the outcome, not mid-thread detail first. Do this only
  when picking up prior context (a summary, a handoff, a "where are we" question); a fresh
  single-turn question needs no re-orientation, just the answer.
- **Answer first.** Open with the direct answer in one or two sentences, before any tool call,
  investigation, or reasoning. If the answer is not yet known, say what is about to be checked and
  why — never open with narration that defers the point.
- **State the correction up front** when the answer contradicts something said earlier, rather than
  letting it emerge from the work.

### Form

- **Match form to content, prose is the fallback.** Tables for sets of like items or comparisons
  (one row per dimension); fenced code blocks for commands, CLI output, config, file layout;
  Mermaid diagrams for workflow/sequence/entity relationships. Keep prose terse and connective —
  it introduces and links the other forms, it doesn't replace them. Never narrate in prose what a
  table or diagram already shows.
- **Use headers for distinct parts** of a long response (what changed, what broke, what remains).
  Short answers need no headers — do not impose structure on a two-line reply.
- **Namespace mixed-domain findings** into subsections when a response spans more than one kind of
  thing — e.g. User Experience/Interaction, Architecture/Infrastructure, Other — rather than one
  flat list. Skip this for single-domain content; three headers on a two-line reply is worse, not
  better.
- **Bold the load-bearing claim** in a paragraph the reader must not miss: a regression, a
  destructive consequence, a blocked step. Do not bold for emphasis generally; it stops working.

### Separators

Two weights, and they are load-bearing at different scales. Use the box-drawing characters, not
`===` or `---`: a line of `=` or `-` directly under text is markdown's setext heading syntax and
silently converts that text into a heading. `━` and `┈` have no markdown meaning and cannot.

- **Sections — `━`.** A solid rule between major parts of a long response (what changed, what
  broke, what remains). Pairs with the header, above it; the rule and the header are one unit, not
  two separate decorations.
- **Lists — `┈`.** A dotted rule above a list that needs separating from the prose introducing it,
  or between two consecutive lists of different kinds. Lighter than `━` on purpose: it marks a
  boundary within a section, never between sections.

Both are for responses long enough to scroll. **A rule in a short reply is noise** — if the whole
response fits on one screen, the header and the bullets already separate it. Never stack the two
weights adjacently, and never border a section on both sides; a rule marks a transition, so one per
transition.

```text
━━━━━━━━━━━━━━━━━━━━━━━━━━
## What changed

Three files, one behavior.
┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈
- `a.mjs` — the fix
- `b.mjs` — its regression
```

### Close

- **Separate the close from the work** with a section rule (`━`, per Separators above) before any
  summary, findings, or fixed-format lines. One rule, not a border around every section.
- **Put verification results in a fenced block**, one line per command, so pass/fail is scannable
  rather than embedded in prose.
- **Close with DONE / DEFERRED / NEXT STEPS** when the response reports on completed or in-progress
  work. DEFERRED means not done and not actually needed — distinct from unfinished. Not rigid: a
  short answer needs no closing block, and a skill's own output format may deliberately diverge.
  The requirement is that whatever closing structure is used, it's consistent within a response and
  the actionable parts are clearly marked.
- Keep the fixed-format lines (verification, and any capture/impact/skill markers other rules
  define) together at the end, each on its own line, after the separator.

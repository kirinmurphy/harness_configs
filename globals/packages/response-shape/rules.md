## Response Shape

Terminal transcripts are read by scrolling back, so a response has to be skimmable: the reader
should find the answer without parsing the work that produced it. Four things get mixed together
otherwise — the question, the answer, live progress, and conclusions.

Agent output is rendered as markdown text. There is no control over color; separation comes from
position, rules, and emphasis instead.

- **Answer first.** Open with the direct answer in one or two sentences, before any tool call,
  investigation, or reasoning. If the answer is not yet known, say what is about to be checked and
  why — never open with narration that defers the point.
- **State the correction up front** when the answer contradicts something said earlier, rather than
  letting it emerge from the work.
- **Separate the close from the work** with a horizontal rule (a line of repeated `━` or `---`)
  before any summary, findings, or fixed-format lines. One rule, not a border around every section.
- **Use headers for distinct parts** of a long response (what changed, what broke, what remains).
  Short answers need no headers — do not impose structure on a two-line reply.
- **Bold the load-bearing claim** in a paragraph the reader must not miss: a regression, a
  destructive consequence, a blocked step. Do not bold for emphasis generally; it stops working.
- **Put verification results in a fenced block**, one line per command, so pass/fail is scannable
  rather than embedded in prose.
- **Report what is not done** in its own section near the end, never folded into a sentence about
  what is done. Incomplete work is the thing most easily missed on a scroll-back.
- Keep the fixed-format lines (verification, and any capture/impact/skill markers other rules
  define) together at the end, each on its own line, after the separator.

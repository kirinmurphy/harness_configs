# Variant: Distilled brief (single-stance)

## Design stance
The Tokens page stops being a dashboard and becomes a **briefing**: the deterministic analysis the CLI already computes is promoted to the top as 3 findings with evidence + actions, everything else (numbers strip, tables, chart) is demoted below the fold.

## Key choices
- **One brief panel replaces 15** — findings carry severity dot, one-line headline, "why it matters" with the numbers inline, a monospace evidence line (the actual aggregates), and per-finding actions.
- **Agent hand-off is a first-class control** — "Copy agent brief" produces the distilled JSON (~2k tokens) instead of a human pasting 40k tokens of raw spool. This is the user's core thesis made tangible: deterministic collection/aggregation upstream, LLM acts on the distillate.
- **4-metric strip** instead of stat panels — each metric carries its own one-line delta and explanation.
- **Raw tables stay** (cost by tool, sessions) but demoted and annotated with what each column means; the chart/spike-anatomy/explorer survive behind an "advanced" expander (noted in the footnote, not mocked here).
- Fake data is deliberately realistic: a runaway skill (repeat reads), an MCP-vs-native cost comparison (both exist in today's analyze output), and a marker-relative win (uses today's real marker feature).

## Trade-offs
- Strong at: answerable in 10 seconds; every claim shows its evidence; agent-ready by design.
- Weak at: exploration ("show me everything") moves behind an expander; power users lose the at-a-glance wall of panels.
- Depends on: the brief.json writer being genuinely deterministic and cheap (it already has all inputs in `telemetry-analyze.mjs` — insights, spike_causes, group_cost, regression, markers).

## Best for
The stated goal: escalate processed, distilled data that an agent can act on directly, with the human seeing the same brief the agent sees.

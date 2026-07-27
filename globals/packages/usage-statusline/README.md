# Usage Statusline

Shows harness-provided usage signals in terminal footers without adding prompt context. The
formatter makes **zero model calls** and contributes **zero prompt tokens** — it only reads the
status payload the harness already hands it.

## What the numbers mean

**Every displayed percentage means _used_, not remaining.** Claude Code uses its documented
command-based `statusLine` setting; the formatter reads the JSON payload from stdin and prints one
line:

```text
Context: 42% used · 5h: 18% used · Weekly: 15% surplus (70% used / 85% elapsed)
```

- **Context** — how much of the current session's context window is used.
- **5h** — used percentage of the rolling five-hour allowance.
- **Weekly** — used percentage of the rolling seven-day allowance, plus _pacing_ (below).

`—` means **unavailable** (the source did not supply enough data), never zero. A real zero displays
as `0%`.

## Weekly pacing: debt, surplus, balanced

When the harness supplies a reset time for the weekly window, the line compares **used** against
**elapsed** (how far through the window you are):

| Situation | Output |
| --- | --- |
| Used ahead of elapsed | `Weekly: 15% debt (85% used / 70% elapsed)` |
| Elapsed ahead of used | `Weekly: 15% surplus (70% used / 85% elapsed)` |
| Within tolerance | `Weekly: Balanced (68% used / 72% elapsed)` |
| No reset time supplied | `Weekly: 85% used` (usage-only fallback) |
| Nothing available | `Weekly: —` |

"Percentage points": `85% used − 70% elapsed = 15 points`. The compact UI says `15% debt` for
readability, but the arithmetic is in points.

## Thresholds

**Balance** — the difference is measured on display-rounded whole percentages so the visible math
always matches the label:

- absolute difference `< 5 points` → **Balanced**;
- exactly `5 points` is **not** balanced (it is a 5% debt or surplus).

**Debt severity** (styles the `## debt` value):

- `5–19 points` → orange;
- `≥ 20 points` → red.

**Usage severity** (styles any `## used` value, independently of pacing):

- `0–70%` → white; `71–85%` → orange; `86–100%` → red.
- Strict boundaries: `70%` and `85%` themselves stay white/orange; `71%` and `86%` cross.

**Surplus is never orange or red** for being large. A high total-used value may still color the
`## used` text on its own — debt/surplus severity and total-used severity are computed and styled
independently, so one weekly segment can carry two differently colored values:

```text
Weekly: 20% debt (90% used / 70% elapsed)
        ^^^^^^^^  ^^^^^^^^   ^^^^^^^^^^^
        red       red        white (elapsed is always white)
```

Normal percentages are rendered **explicit white**, never left terminal-muted. `NO_COLOR` disables
all ANSI and prints the exact same text.

## Codex

Codex uses native `tui.status_line` fields. This package migrates context to the used-direction
`context-used` item and disables Codex's decorative category colors (`status_line_use_colors =
false`, an owned scalar restored on disable).

> **Full Codex parity is not complete.** Matching used-direction rate limits, weekly pacing text,
> and independent semantic coloring in the Codex footer requires an upstream Codex (Rust) footer
> capability that has not yet landed. Until it does, Codex still shows its native five-hour / weekly
> _remaining_ limit items, and the `/api/usage` portal endpoint reports Codex as `not-collected`.
> See `docs/plans/active/usage-statusline-enhancement-plan.md` (Phase 4).

## Portal data surface

The Claude formatter writes a normalized snapshot (best-effort, atomic, user-only) to
`~/.roborepo/usage/latest/claude.json`. The read-only portal route `GET /api/usage` serves the
assessed snapshot with per-harness availability and freshness for the future homepage — structured
data only, never parsed terminal text. `POST /api/usage/refresh` is reserved for the (blocked) Codex
collector.

RoboRepo never parses `/status`, `/usage`, transcripts, or footer text, and never calls account
endpoints or stores raw provider payloads or credentials.

## Turns and tool calls

Turns/tool-call counts are intentionally **not** here. Neither status-line surface supplies them
cleanly across harnesses, and they are session-pressure signals rather than account-allowance
signals. They remain a separate follow-up feature.

## Minimum harness versions

- **Claude Code** — any version whose command `statusLine` payload includes `context_window` and
  `rate_limits` (`five_hour`, `seven_day`) with `used_percentage`; `resets_at` enables weekly
  pacing (usage-only fallback without it).
- **Codex** — a version supporting the `context-used` status-line item. Full pacing parity requires
  the not-yet-released upstream footer capability (Phase 4).

## Preview

```sh
echo '{"context_window":{"used_percentage":42},"rate_limits":{"five_hour":{"used_percentage":18},"seven_day":{"used_percentage":85,"resets_at":"2026-07-23T22:24:00.000Z"}}}' \
  | node globals/packages/usage-statusline/scripts/claude-statusline.mjs
```

Each shared conformance case in `fixtures/usage-cases.json` carries the exact expected `weeklyText`;
the same fixtures drive the Node tests and (when it lands) the Codex Rust footer tests, keeping both
implementations in agreement.

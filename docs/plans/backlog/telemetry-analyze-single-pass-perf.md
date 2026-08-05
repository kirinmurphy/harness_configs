---
id: telemetry-analyze-single-pass-perf
priority: low
next_action: Profile analyzeTelemetry's per-aggregation cost, then fold the independent single-pass tallies into one loop guarded by output equality
blocked_by: []
depends_on: []
related:
  - telemetry-analysis-io-performance
reviewed_commit:
---

# Telemetry Analyze: Single-Pass Aggregation (Performance Optimization)

## Summary

`analyzeTelemetry` (`scripts/cli/telemetry-analyze.mjs`) walks the full captures array
roughly a dozen times — one independent pass per aggregation (top tools, top MCP, tool
cost, group cost, spike anatomy, regression, loops, usage windows, comparison, etc.). On a
~35k-event spool this is ~180-270ms. Folding the independent single-pass tallies into one
loop would cut that materially.

This is a **performance optimization**, explicitly **low priority**: the analyze cost was
moved off the request hot path by the [[telemetry-analysis-io-performance]] work (it now runs
on a debounced background timer, between requests, not inside `/api/data`). So this is polish,
not a fix. It earns its place only if the spool grows enough that the background recompute
becomes perceptible again.

## Context

This is the deferred "Tier 1.5" from [[telemetry-analysis-io-performance]] (see that plan's
"Optional Tier 1.5" section and its Non-goals). That work made the request path warm and the
spool read incremental; the remaining synchronous cost is the analysis itself, and it no
longer blocks a request — it blocks the single event loop briefly, on a timer, at most once
per debounce window.

Measured breakdown of a single compute (~35,686 events, 31MB), JIT-warmed:

| Stage | Cost |
|---|---|
| incremental spool read (steady state) | ~1ms |
| `analyzeTelemetry` | ~180-270ms |
| `JSON.stringify` (cached) | one-time per change |

The analyze stage is now the largest live-compute component, but it runs off the request
path, which is why this is low priority rather than urgent.

## Goals

- Reduce `analyzeTelemetry` wall time by folding independent per-capture aggregations into a
  single pass over the captures array.
- Preserve byte-identical report output — no change to any computed value or report shape.

## Non-goals

- Changing analysis semantics, thresholds, or the report shape.
- Touching the request path, caching, incremental read, or debounced refresh — all shipped in
  [[telemetry-analysis-io-performance]].
- Worker threads / off-thread analysis (a separate deferred option in that plan).

## Current state

`scripts/cli/telemetry-analyze.mjs`, `analyzeTelemetry(events)` builds the report by calling
many helpers that each iterate `captures` independently. Confirmed separate passes include:

- `topBy(captures, ...)` — called 4× (`top_repos`, `top_tools`, `top_mcp`, `top_events`)
- `compareSpikeVsNormal(captures, ...)`
- `usageWindows(captures)`
- `toolCost(captures)`, `groupCost(captures)`, `packageCost(captures)`
- `spikeAnatomy(captures, spikeCaptures)`, `regression(captures)`, `detectLoops(captures, ...)`
- `rollupCauses(spikeCaptures)` (over the spike subset)

Each is a self-contained reducer over the same array. The function is pure (no I/O), so a
rewrite is purely local to this file.

Guardrail already exists: `scripts/test/telemetry-correctness-check.mjs` feeds a hand-built
events array into `analyzeTelemetry` and asserts report values. It does not yet assert
old-vs-new equality on a real spool — add that for this work.

## Proposed approach

1. Profile first: instrument each helper to find which passes actually dominate the
   ~180-270ms. Fold only the ones that pay off; a helper that is already cheap or that needs
   a second derived pass (e.g. anything keyed off `spikeCaptures`, computed after the spike
   threshold) may not be worth merging.
2. Build a single reducer that accumulates the independent tallies (the `topBy` counts, the
   cost sums, the usage-window sums) in one walk over `captures`, then assemble the report
   from the accumulated state.
3. Keep passes that genuinely depend on a prior pass's output (spike classification needs the
   threshold, which needs a first pass over deltas) as their own stage — do not force a merge
   that requires the data twice anyway.

## Validation

- `node --check scripts/cli/telemetry-analyze.mjs`.
- `node scripts/test/telemetry-correctness-check.mjs` passes unchanged.
- New equality assertion: run old vs new `analyzeTelemetry` over the same real spool and
  assert `deepEqual` on the full report — the report must be byte-identical. This is the
  load-bearing guardrail for a hot-path rewrite; do not merge without it.
- Re-run `scripts/test/telemetry-spool-bench.mjs` (or extend it) to record analyze before/after.

## Risks

- **Silent value drift**: merging reducers can subtly change a tally (off-by-one, a filter
  applied to the wrong subset). Mitigation: the old-vs-new full-report equality assertion is
  mandatory before merge.
- **Readability regression**: one large fused loop can be harder to follow than a dozen named
  single-purpose helpers. Keep the fused accumulator well-structured; do not trade all clarity
  for the passes. If the profile shows only 2-3 helpers dominate, merge only those and leave
  the rest.

## Open questions

- Which specific helpers dominate the ~180-270ms? Unknown until profiled — step 1 answers it
  and may narrow this to merging only a couple of passes rather than all of them.
- Is the wall-time win worth the readability cost while this stays off the request path? Revisit
  with the profile numbers; if the spool is still small enough that analyze stays well under a
  second, the answer may be "not yet."

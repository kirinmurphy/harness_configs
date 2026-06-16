// Turns raw spool events into the views that explain token spikes: per-session rollups, a spike
// classifier, top token contributors, and a spike-vs-normal comparison. Shared by the terminal
// report and the dashboard JSON API so both speak the same numbers. Pure functions over arrays —
// no I/O — so the server and CLI can each read the spool their own way.

// A capture counts as a spike when its token delta exceeds the mean by this many standard
// deviations. Tunable, but kept conservative so quiet sessions never trip the threshold.
const SPIKE_SIGMA = 2;

export function analyzeTelemetry(events) {
  const captures = events.filter(hasTokens);
  const sessions = rollupSessions(captures);
  const spikeThreshold = deltaSpikeThreshold(captures);
  const spikeCaptures = captures.filter((event) => (event.delta_tokens || 0) >= spikeThreshold && spikeThreshold > 0);
  return {
    // Cheap change token for the dashboard's poll loop: spool is append-only, so event count plus the
    // newest timestamp changes whenever a capture lands. The client redraws only when this differs.
    version: `${events.length}:${events[events.length - 1]?.ts ?? "0"}`,
    event_count: events.length,
    capture_count: captures.length,
    sessions,
    spike_threshold: spikeThreshold,
    spikes: spikeCaptures
      .map(spikeRow)
      .sort((a, b) => b.delta_tokens - a.delta_tokens),
    top_repos: topBy(captures, (event) => event.repo?.label ?? "unknown"),
    top_tools: topBy(captures, (event) => event.tool?.name ?? event.event ?? "unknown"),
    top_mcp: topBy(captures.filter((event) => event.tool?.is_mcp), (event) => event.tool?.mcp_server ?? "unknown"),
    top_events: topBy(captures, (event) => event.event ?? "unknown"),
    comparison: compareSpikeVsNormal(captures, spikeThreshold),
    timeline: captures
      .map((event) => ({ ts: event.ts, total: event.tokens?.total ?? 0, delta: event.delta_tokens ?? 0 }))
      .sort((a, b) => a.ts.localeCompare(b.ts)),
  };
}

function rollupSessions(captures) {
  const bySession = new Map();
  for (const event of captures) {
    const id = event.session_id || "unknown";
    const current = bySession.get(id) ?? {
      session_id: id,
      repo: event.repo?.label ?? "unknown",
      harness: event.harness,
      first_ts: event.ts,
      last_ts: event.ts,
      total_tokens: 0,
      tool_calls: 0,
      mcp_calls: 0,
      captures: 0,
    };
    current.first_ts = minStr(current.first_ts, event.ts);
    current.last_ts = maxStr(current.last_ts, event.ts);
    current.total_tokens = Math.max(current.total_tokens, event.tokens?.total ?? 0);
    current.tool_calls = Math.max(current.tool_calls, event.session?.tool_calls ?? 0);
    current.mcp_calls = Math.max(current.mcp_calls, event.session?.mcp_calls ?? 0);
    current.captures += 1;
    bySession.set(id, current);
  }
  return [...bySession.values()].sort((a, b) => b.total_tokens - a.total_tokens);
}

function deltaSpikeThreshold(captures) {
  const deltas = captures.map((event) => event.delta_tokens || 0).filter((value) => value > 0);
  if (deltas.length < 2) return 0;
  const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  const variance = deltas.reduce((sum, value) => sum + (value - mean) ** 2, 0) / deltas.length;
  return Math.round(mean + SPIKE_SIGMA * Math.sqrt(variance));
}

function compareSpikeVsNormal(captures, threshold) {
  const spike = captures.filter((event) => (event.delta_tokens || 0) >= threshold && threshold > 0);
  const normal = captures.filter((event) => (event.delta_tokens || 0) < threshold);
  return {
    spike: cohortStats(spike),
    normal: cohortStats(normal),
  };
}

function cohortStats(cohort) {
  if (cohort.length === 0) return { count: 0, avg_delta: 0, avg_tool_calls: 0, mcp_rate: 0 };
  const sum = (pick) => cohort.reduce((total, event) => total + pick(event), 0);
  const mcpEvents = cohort.filter((event) => event.tool?.is_mcp).length;
  return {
    count: cohort.length,
    avg_delta: Math.round(sum((event) => event.delta_tokens || 0) / cohort.length),
    avg_tool_calls: Math.round(sum((event) => event.session?.tool_calls || 0) / cohort.length),
    mcp_rate: Number((mcpEvents / cohort.length).toFixed(3)),
  };
}

function spikeRow(event) {
  return {
    ts: event.ts,
    session_id: event.session_id,
    repo: event.repo?.label ?? "unknown",
    event: event.event,
    tool: event.tool?.name ?? null,
    delta_tokens: event.delta_tokens || 0,
    total_tokens: event.tokens?.total ?? 0,
  };
}

function topBy(events, keyFor) {
  const counts = new Map();
  for (const event of events) {
    const key = keyFor(event);
    const current = counts.get(key) ?? { key, captures: 0, tokens: 0 };
    current.captures += 1;
    current.tokens += event.delta_tokens || 0;
    counts.set(key, current);
  }
  return [...counts.values()].sort((a, b) => b.tokens - a.tokens || b.captures - a.captures);
}

function hasTokens(event) {
  return event && event.tokens && typeof event.tokens.total === "number";
}

const minStr = (a, b) => (a <= b ? a : b);
const maxStr = (a, b) => (a >= b ? a : b);

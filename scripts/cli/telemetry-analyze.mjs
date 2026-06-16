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
    // The actionable view: every spike tagged with the pattern that drove it, then rolled up so the
    // user sees "doing X blows up my tokens" rather than a wall of per-capture numbers.
    spike_causes: rollupCauses(spikeCaptures),
    usage_windows: usageWindows(captures),
    timeline: captures
      .map((event) => ({ ts: event.ts, total: event.tokens?.total ?? 0, delta: event.delta_tokens ?? 0 }))
      .sort((a, b) => a.ts.localeCompare(b.ts)),
  };
}

// A tool result this many characters or larger is treated as the likely cause of a spike. ~1 token
// per 4 chars, so 40k chars ≈ 10k tokens of context — well above an incidental small result.
const HEAVY_RESULT_CHARS = 40_000;

// Classifies one spike capture into a cause bucket and the actionable change it implies. Keys off
// the size of the tool result that most recently entered context (the likely driver of the delta);
// degrades to tool name for older records that predate result-size capture, so pre-attribution
// captures still classify (just without the size gate). Deliberately conservative: anything we can't
// attribute to a concrete oversized result falls through to "other" rather than guessing — a wrong
// cause is worse than an honest "look at the transcript".
export function spikeCause(event) {
  const result = event.last_result ?? null;
  const tool = result?.tool ?? event.tool?.name ?? null;
  const chars = result?.chars ?? 0;
  // hasSizes distinguishes "small result, not the cause" from "old record with no size data".
  const hasSizes = result != null && typeof result.chars === "number";
  const heavy = chars >= HEAVY_RESULT_CHARS || (!hasSizes && tool);
  const isMcp = event.tool?.is_mcp === true || (typeof tool === "string" && tool.startsWith("mcp__"));

  if (heavy) {
    if (isMcp) return { cause: "mcp-bundle", hint: "scope the MCP query (narrower bundle / fewer refs)" };
    if (tool === "Bash") return { cause: "unbounded-bash-output", hint: "pipe through `roborepo run` or limit output" };
    if (tool === "Read" || tool === "Grep" || tool === "Glob") return { cause: "large-file-read", hint: "read a line range, not the whole file" };
    if (tool) return { cause: "large-tool-output", hint: `limit what ${tool} returns into context` };
  }
  if ((event.prompt?.chars ?? 0) >= 8_000) {
    return { cause: "big-prompt", hint: "trim pasted context from the prompt" };
  }
  return { cause: "other", hint: "inspect the session transcript for the heavy turn" };
}

function rollupCauses(spikeCaptures) {
  const byCause = new Map();
  for (const event of spikeCaptures) {
    const { cause, hint } = spikeCause(event);
    const delta = event.delta_tokens ?? 0;
    const current = byCause.get(cause) ?? { cause, hint, spikes: 0, total_delta: 0, worst_delta: 0, worst_repo: null };
    current.spikes += 1;
    current.total_delta += delta;
    if (delta > current.worst_delta) {
      current.worst_delta = delta;
      current.worst_repo = event.repo?.label ?? "unknown";
    }
    byCause.set(cause, current);
  }
  return [...byCause.values()]
    .map((row) => ({ ...row, avg_delta: Math.round(row.total_delta / row.spikes) }))
    .sort((a, b) => b.total_delta - a.total_delta);
}

// Rolling token consumption over trailing 5h / 7d windows, reconstructed from capture timestamps and
// per-capture deltas. This is a LOCAL ESTIMATE of how much you've spent recently — not your real
// server-side Claude rate limit, which telemetry cannot see. Useful for spotting that you're
// trending toward a wall before you hit it.
function usageWindows(captures) {
  const now = captures.reduce((latest, event) => (event.ts > latest ? event.ts : latest), captures[0]?.ts ?? new Date().toISOString());
  const nowMs = Date.parse(now);
  const sumSince = (windowMs) =>
    captures.reduce((sum, event) => (nowMs - Date.parse(event.ts) <= windowMs ? sum + (event.delta_tokens ?? 0) : sum), 0);
  return {
    as_of: now,
    estimate: true,
    five_hour: sumSince(5 * 60 * 60 * 1000),
    seven_day: sumSince(7 * 24 * 60 * 60 * 1000),
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

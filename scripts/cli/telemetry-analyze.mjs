// Turns raw spool events into the views that explain token spikes: per-session rollups, a spike
// classifier, top token contributors, and a spike-vs-normal comparison. Shared by the terminal
// report and the dashboard JSON API so both speak the same numbers. Pure functions over arrays —
// no I/O — so the server and CLI can each read the spool their own way.

import { mcpServerOf } from "./telemetry-transcript.mjs";

// A capture counts as a spike when its token delta exceeds the mean by this many standard
// deviations. Tunable, but kept conservative so quiet sessions never trip the threshold.
const SPIKE_SIGMA = 2;

export function analyzeTelemetry(events) {
  const captures = events.filter(hasTokens);
  const sessions = rollupSessions(captures);
  const spikeThreshold = deltaSpikeThreshold(captures);
  const spikeCaptures = captures.filter((event) => (event.delta_tokens || 0) >= spikeThreshold && spikeThreshold > 0);
  // Session-context lookup so every flagged event (spike, loop) can carry the same "which chat was
  // this" markers the sessions table shows — title (first prompt), activity summary, repo/branch.
  const sessionsById = new Map(sessions.map((s) => [s.session_id, s]));
  return {
    // Cheap change token for the dashboard's poll loop: spool is append-only, so event count plus the
    // newest timestamp changes whenever a capture lands. The client redraws only when this differs.
    version: `${events.length}:${events[events.length - 1]?.ts ?? "0"}`,
    event_count: events.length,
    capture_count: captures.length,
    sessions,
    spike_threshold: spikeThreshold,
    spikes: spikeCaptures
      .map((event) => spikeRow(event, sessionsById))
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
    // Per-capture series for the timeline chart. Carries the context the dashboard tooltip needs
    // (tool, event, cause, sizes, duration) so hover can explain a bar without a second request.
    timeline: captures
      .map((event) => ({
        ts: event.ts,
        total: event.tokens?.total ?? 0,
        delta: event.delta_tokens ?? 0,
        event: event.event ?? null,
        tool: event.tool?.name ?? null,
        mcp_tool: event.tool?.mcp_tool ?? null,
        file_ext: event.tool?.file_ext ?? null,
        duration_ms: event.duration_ms ?? null,
        repo: event.repo?.label ?? "unknown",
        session_id: event.session_id ?? null,
        result_chars: event.last_result?.chars ?? null,
        prompt: event.prompt?.preview ?? null,
        cause: spikeCause(event).cause,
      }))
      .sort((a, b) => a.ts.localeCompare(b.ts)),
    // --- conclusions: actionable rollups, not raw rows -------------------------------------------
    // Attribution note: per-tool cost is measured by the SIZE of the result a tool put into context
    // (last_result.chars → approx tokens), NOT by delta_tokens-by-hook (which mis-credits whichever
    // hook fired). This answers "what does a Read/Grep/MCP call put into my context".
    tool_cost: toolCost(captures),
    group_cost: groupCost(captures),
    spike_anatomy: spikeAnatomy(captures, spikeCaptures),
    package_cost: packageCost(captures),
    regression: regression(captures),
    loops: detectLoops(captures, sessionsById),
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
      branch: event.repo?.branch ?? null,
      sha: event.repo?.sha ?? null,
      first_ts: event.ts,
      last_ts: event.ts,
      total_tokens: 0,
      tool_calls: 0,
      mcp_calls: 0,
      captures: 0,
      // Human-readable identity: the session's opening prompt (preview), plus a tool-use tally and
      // the file types touched, so a session reads as "what it was about" not just a UUID.
      title: null,
      title_ts: null,
      tool_counts: {},
      ext_counts: {},
    };
    current.first_ts = minStr(current.first_ts, event.ts);
    current.last_ts = maxStr(current.last_ts, event.ts);
    // Branch/sha can change mid-session (checkout); keep the most recent non-null.
    if (event.repo?.branch) current.branch = event.repo.branch;
    if (event.repo?.sha) current.sha = event.repo.sha;
    current.total_tokens = Math.max(current.total_tokens, event.tokens?.total ?? 0);
    current.tool_calls = Math.max(current.tool_calls, event.session?.tool_calls ?? 0);
    current.mcp_calls = Math.max(current.mcp_calls, event.session?.mcp_calls ?? 0);
    current.captures += 1;
    // Title = the earliest prompt preview seen for the session (the opening ask).
    const preview = event.prompt?.preview ?? null;
    if (preview && (current.title_ts == null || event.ts < current.title_ts)) {
      current.title = preview;
      current.title_ts = event.ts;
    }
    // Activity tallies, keyed off PostToolUse so each tool call counts once.
    if (event.event === "PostToolUse" && event.tool?.name) {
      const t = event.tool.mcp_tool || event.tool.name;
      current.tool_counts[t] = (current.tool_counts[t] || 0) + 1;
      if (event.tool.file_ext) current.ext_counts[event.tool.file_ext] = (current.ext_counts[event.tool.file_ext] || 0) + 1;
    }
    bySession.set(id, current);
  }
  // Derive a one-line activity summary per session from the tallies.
  for (const s of bySession.values()) s.activity = activitySummary(s.tool_counts, s.ext_counts);
  return [...bySession.values()].sort((a, b) => b.total_tokens - a.total_tokens);
}

// "12 Read · 6 Write · 3 Bash · mostly .mjs, .json" — a compact, content-free description of what a
// session actually did, for sessions with no prompt preview (or as a subtitle for those that have).
function activitySummary(toolCounts, extCounts) {
  const tools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => n + " " + k);
  const exts = Object.entries(extCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => "." + k);
  const parts = [];
  if (tools.length) parts.push(tools.join(" · "));
  if (exts.length) parts.push("mostly " + exts.join(", "));
  return parts.join(" · ") || null;
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

function spikeRow(event, sessionsById) {
  return {
    ts: event.ts,
    session_id: event.session_id,
    repo: event.repo?.label ?? "unknown",
    event: event.event,
    tool: event.tool?.name ?? null,
    delta_tokens: event.delta_tokens || 0,
    total_tokens: event.tokens?.total ?? 0,
    harness: event.harness ?? null,
    context: sessionContext(event.session_id, sessionsById),
  };
}

// The "which chat was this" markers, pulled from the session rollup so every flagged event speaks
// the same language as the sessions table: opening prompt, activity summary, repo/branch/harness.
function sessionContext(sessionId, sessionsById) {
  const s = sessionsById?.get(sessionId);
  if (!s) return null;
  return { title: s.title ?? null, activity: s.activity ?? null, repo: s.repo, branch: s.branch ?? null, harness: s.harness ?? null };
}

// =================================================================================================
// Conclusions layer. All keyed off the SIZE of the result each tool put into context
// (last_result.chars), converted to approximate tokens. This is the honest "what did this tool cost
// my context" signal — independent of the delta-by-hook attribution used for the timeline.
// =================================================================================================

// ~4 characters per token. Approximate by design; labeled as such everywhere it surfaces.
function approxTokens(chars) {
  return Math.round((chars || 0) / 4);
}

// The display name a result attributes to. Transcript results carry the raw tool name; for MCP that
// is mcp__<server>__<tool>, which we render as "<server> · <tool>".
function resultToolLabel(toolName) {
  const server = mcpServerOf(toolName);
  if (!server) return toolName;
  const tool = String(toolName).split("__").slice(2).join("__");
  return tool ? server + " · " + tool : server;
}

// Functional bucket for the native-vs-MCP comparison. Keyed off the result's tool name so it works
// for both the live tool metadata and the transcript-attributed result.
function toolGroup(toolName) {
  const server = mcpServerOf(toolName);
  if (server === "jcodemunch") return "mcp-code";
  if (server === "jdocmunch") return "mcp-docs";
  if (server) return "mcp-other";
  if (toolName === "Read" || toolName === "Grep" || toolName === "Glob") return "native-read";
  if (toolName === "Edit" || toolName === "Write" || toolName === "NotebookEdit") return "edit";
  if (toolName === "Bash") return "bash";
  return "other";
}

// Captures that carry an attributed result (the tool that produced it + its size). The basis for
// every cost rollup below.
function resultCaptures(captures) {
  return captures.filter((event) => event.last_result && typeof event.last_result.chars === "number" && event.last_result.tool);
}

// Per-tool cost: how much context an average call of each tool drops in. The Read-vs-MCP table.
function toolCost(captures) {
  const byTool = new Map();
  for (const event of resultCaptures(captures)) {
    const name = event.last_result.tool;
    const chars = event.last_result.chars;
    const cur = byTool.get(name) ?? { tool: resultToolLabel(name), group: toolGroup(name), calls: 0, total_chars: 0, max_chars: 0 };
    cur.calls += 1;
    cur.total_chars += chars;
    cur.max_chars = Math.max(cur.max_chars, chars);
    byTool.set(name, cur);
  }
  return [...byTool.values()]
    .map((r) => ({ tool: r.tool, group: r.group, calls: r.calls, avg_tokens: approxTokens(r.total_chars / r.calls), max_tokens: approxTokens(r.max_chars), total_tokens: approxTokens(r.total_chars) }))
    .sort((a, b) => b.avg_tokens - a.avg_tokens);
}

// Per functional group: the head-to-head (native-read vs mcp-code vs …) on avg tokens per call.
function groupCost(captures) {
  const byGroup = new Map();
  for (const event of resultCaptures(captures)) {
    const g = toolGroup(event.last_result.tool);
    const cur = byGroup.get(g) ?? { group: g, calls: 0, total_chars: 0 };
    cur.calls += 1;
    cur.total_chars += event.last_result.chars;
    byGroup.set(g, cur);
  }
  return [...byGroup.values()]
    .map((r) => ({ group: r.group, calls: r.calls, avg_tokens: approxTokens(r.total_chars / r.calls), total_tokens: approxTokens(r.total_chars) }))
    .sort((a, b) => b.avg_tokens - a.avg_tokens);
}

// What is over-represented in spikes vs normal turns. Lift = group's share of spike captures ÷ its
// share of normal captures. Lift > 1 means that group drives spikes more than its baseline rate.
function spikeAnatomy(captures, spikeCaptures) {
  const spikeSet = new Set(spikeCaptures);
  const spike = resultCaptures(spikeCaptures);
  const normal = resultCaptures(captures).filter((event) => !spikeSet.has(event));
  if (spike.length === 0) return { spike_count: 0, normal_count: normal.length, groups: [] };
  const shareByGroup = (rows) => {
    const m = new Map();
    for (const e of rows) m.set(toolGroup(e.last_result.tool), (m.get(toolGroup(e.last_result.tool)) || 0) + 1);
    return m;
  };
  const spikeShare = shareByGroup(spike);
  const normalShare = shareByGroup(normal);
  const groups = [];
  for (const [group, n] of spikeShare) {
    const sFrac = n / spike.length;
    const nFrac = (normalShare.get(group) || 0) / Math.max(1, normal.length);
    const avgChars = spike.filter((e) => toolGroup(e.last_result.tool) === group).reduce((s, e) => s + e.last_result.chars, 0) / n;
    groups.push({
      group,
      spike_share: Number(sFrac.toFixed(3)),
      normal_share: Number(nFrac.toFixed(3)),
      lift: nFrac > 0 ? Number((sFrac / nFrac).toFixed(2)) : null, // null = appears in spikes but never normally
      avg_tokens: approxTokens(avgChars),
    });
  }
  groups.sort((a, b) => (b.lift ?? Infinity) - (a.lift ?? Infinity));
  return { spike_count: spike.length, normal_count: normal.length, groups };
}

// Per package (MCP server, plus a synthetic "native" bucket): calls, avg tokens/call, total, and the
// time span it was seen. Answers "what is this package costing me".
function packageCost(captures) {
  const byPkg = new Map();
  for (const event of resultCaptures(captures)) {
    const pkg = mcpServerOf(event.last_result.tool) || "native";
    const cur = byPkg.get(pkg) ?? { package: pkg, calls: 0, total_chars: 0, first_seen: event.ts, last_seen: event.ts };
    cur.calls += 1;
    cur.total_chars += event.last_result.chars;
    cur.first_seen = minStr(cur.first_seen, event.ts);
    cur.last_seen = maxStr(cur.last_seen, event.ts);
    byPkg.set(pkg, cur);
  }
  return [...byPkg.values()]
    .map((r) => ({ package: r.package, calls: r.calls, avg_tokens: approxTokens(r.total_chars / r.calls), total_tokens: approxTokens(r.total_chars), first_seen: r.first_seen, last_seen: r.last_seen }))
    .sort((a, b) => b.total_tokens - a.total_tokens);
}

// Earlier-vs-later regression: split result captures at the time midpoint and compare avg tokens per
// call per group. A positive delta means that group got more expensive in the later half — the
// signal for "did the thing I changed make context heavier".
function regression(captures) {
  const rows = resultCaptures(captures).slice().sort((a, b) => a.ts.localeCompare(b.ts));
  if (rows.length < 4) return { split_ts: null, groups: [] };
  const mid = Math.floor(rows.length / 2);
  const splitTs = rows[mid].ts;
  const avgByGroup = (slice) => {
    const m = new Map();
    for (const e of slice) {
      const g = toolGroup(e.last_result.tool);
      const cur = m.get(g) ?? { calls: 0, chars: 0 };
      cur.calls += 1;
      cur.chars += e.last_result.chars;
      m.set(g, cur);
    }
    return m;
  };
  const before = avgByGroup(rows.slice(0, mid));
  const after = avgByGroup(rows.slice(mid));
  const groups = [];
  for (const g of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(g), a = after.get(g);
    const bAvg = b ? approxTokens(b.chars / b.calls) : 0;
    const aAvg = a ? approxTokens(a.chars / a.calls) : 0;
    groups.push({ group: g, before_avg_tokens: bAvg, after_avg_tokens: aAvg, delta_tokens: aAvg - bAvg, before_calls: b?.calls ?? 0, after_calls: a?.calls ?? 0 });
  }
  groups.sort((a, b) => Math.abs(b.delta_tokens) - Math.abs(a.delta_tokens));
  return { split_ts: splitTs, groups };
}

// Runaway detection: per session, the longest run of the SAME tool fired consecutively (from the
// ordered PostToolUse captures). A long run is the "this skill went off on endless lookups" signal.
const LOOP_REPEAT_THRESHOLD = 8;
function detectLoops(captures, sessionsById) {
  const bySession = new Map();
  for (const event of captures) {
    if (event.event !== "PostToolUse" || !event.tool?.name) continue;
    const id = event.session_id || "unknown";
    if (!bySession.has(id)) bySession.set(id, []);
    bySession.get(id).push(event);
  }
  const loops = [];
  for (const [id, events] of bySession) {
    events.sort((a, b) => a.ts.localeCompare(b.ts));
    let runTool = null, run = 0, bestTool = null, best = 0, bestStartTs = null, runStartTs = null;
    for (const e of events) {
      const t = e.tool.mcp_tool || e.tool.name;
      if (t === runTool) run += 1;
      else { runTool = t; run = 1; runStartTs = e.ts; }
      if (run > best) { best = run; bestTool = t; bestStartTs = runStartTs; }
    }
    if (best >= LOOP_REPEAT_THRESHOLD) {
      loops.push({
        session_id: id,
        repo: events[0].repo?.label ?? "unknown",
        harness: events[0].harness ?? null,
        tool: bestTool,
        max_repeat: best,
        ts: bestStartTs,
        hint: mcpServerOf(events.find((e) => (e.tool.mcp_tool || e.tool.name) === bestTool)?.tool?.name)
          ? "MCP tool firing in a tight loop — check the agent/skill that calls it"
          : bestTool + " repeated " + best + "× in a row — likely a runaway loop",
        context: sessionContext(id, sessionsById),
      });
    }
  }
  return loops.sort((a, b) => b.max_repeat - a.max_repeat);
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

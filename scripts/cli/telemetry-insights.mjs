// Turns the analyzeTelemetry facts into ranked, plain-English conclusions — the "what this means"
// headline so the user doesn't scan tables to reach an actionable read. Pure function over the
// report object (no I/O); shared by the CLI report and the dashboard so both speak the same
// conclusions. Each rule is independent, fires only when its data supports it, and is deliberately
// conservative so the headline never cries wolf.

const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const pct = (n) => Math.round(n * 100);

// Minimum calls before a per-call cost comparison is trustworthy (avoid concluding from 2 samples).
const MIN_CALLS = 20;
// A group whose total tokens exceed this share of all attributed tokens is the "dominant cost".
const DOMINANT_SHARE = 0.4;
// Spike lift at/above this means a group drives spikes far more than its everyday rate (tail risk).
const TAIL_RISK_LIFT = 10;
// Cost-per-call gap that's worth calling out as "cheaper/heavier".
const COST_GAP = 0.15;

export function deriveInsights(report) {
  if (!report || !report.capture_count) return [];
  const out = [];

  // --- native read/grep vs each MCP package (agnostic to which MCP) ----------------------------
  // The "is the MCP cheaper than the read/grep it replaces" question, generalized: compare the
  // native-read group against EVERY MCP package present in the data (keyed by server name, whatever
  // it is), so this fires for jcodemunch today and any future exploration MCP with no code change.
  const groups = indexBy(report.group_cost, "group");
  const nativeRead = groups["native-read"];
  if (nativeRead && nativeRead.calls >= MIN_CALLS) {
    for (const pkg of report.package_cost || []) {
      if (pkg.package === "native" || pkg.calls < MIN_CALLS) continue;
      const gap = nativeRead.avg_tokens > 0 ? (nativeRead.avg_tokens - pkg.avg_tokens) / nativeRead.avg_tokens : 0;
      if (Math.abs(gap) < COST_GAP) continue;
      const cheaper = gap > 0; // MCP cheaper than native
      out.push({
        severity: "info",
        headline: `${pkg.package} (MCP) is ${pct(Math.abs(gap))}% ${cheaper ? "cheaper" : "more expensive"} per call than native read/grep`,
        detail: `${fmt(pkg.avg_tokens)} vs ${fmt(nativeRead.avg_tokens)} tok/call (${fmt(pkg.calls)} ${pkg.package} · ${fmt(nativeRead.calls)} native calls)`,
        metric: Math.abs(gap),
      });
    }
  }

  // --- spike tail risk: a group that drives spikes far above its baseline rate -----------------
  for (const g of (report.spike_anatomy?.groups || [])) {
    if (g.lift != null && g.lift >= TAIL_RISK_LIFT) {
      out.push({
        severity: "high",
        headline: `${g.group} is ${Math.round(g.lift)}× more likely to drive a token spike than normal — tail risk`,
        detail: `appears in ${pct(g.spike_share)}% of spike turns; rare but blows up context when used`,
        metric: g.lift,
      });
    }
  }

  // --- dominant cost center: the group/package eating most of the tokens -----------------------
  const totalTokens = (report.group_cost || []).reduce((s, g) => s + (g.total_tokens || 0), 0);
  const top = (report.group_cost || []).slice().sort((a, b) => b.total_tokens - a.total_tokens)[0];
  if (top && totalTokens > 0 && top.total_tokens / totalTokens >= DOMINANT_SHARE) {
    out.push({
      severity: "info",
      headline: `${top.group} is your dominant token cost — ${pct(top.total_tokens / totalTokens)}% of all tool tokens`,
      detail: `${fmt(top.total_tokens)} tok across ${fmt(top.calls)} calls (${fmt(top.avg_tokens)}/call)`,
      metric: top.total_tokens / totalTokens,
    });
  }

  // --- runaway loops ---------------------------------------------------------------------------
  if ((report.loops || []).length) {
    const loops = report.loops;
    const byTool = {};
    for (const l of loops) byTool[l.tool] = (byTool[l.tool] || 0) + 1;
    const topTool = Object.entries(byTool).sort((a, b) => b[1] - a[1])[0]?.[0];
    const worst = loops[0]; // already sorted by max_repeat desc in analyze
    out.push({
      severity: "high",
      headline: `${loops.length} runaway loop${loops.length > 1 ? "s" : ""} detected — mostly ${topTool}`,
      detail: `worst: ${worst.tool} ×${worst.max_repeat} in ${worst.repo}${worst.context?.title ? ` ("${clip(worst.context.title, 50)}")` : ""}`,
      metric: worst.max_repeat,
    });
  }

  // --- regression: a group that got more expensive over time -----------------------------------
  const reg = (report.regression?.groups || []).filter((g) => g.delta_tokens > 0 && g.after_calls >= MIN_CALLS / 2);
  const worstReg = reg.sort((a, b) => b.delta_tokens - a.delta_tokens)[0];
  if (worstReg && worstReg.before_avg_tokens > 0 && worstReg.delta_tokens / worstReg.before_avg_tokens >= 0.5) {
    out.push({
      severity: "warn",
      headline: `${worstReg.group} got ${fmt(worstReg.delta_tokens)} tok/call more expensive in the later half`,
      detail: `${fmt(worstReg.before_avg_tokens)} → ${fmt(worstReg.after_avg_tokens)} tok/call — something recent made it heavier`,
      metric: worstReg.delta_tokens,
    });
  }

  // --- heaviest single tool (cost-per-call outlier) --------------------------------------------
  const heaviest = (report.tool_cost || []).filter((t) => t.calls >= MIN_CALLS / 2).slice().sort((a, b) => b.avg_tokens - a.avg_tokens)[0];
  if (heaviest && heaviest.avg_tokens >= 3000) {
    out.push({
      severity: "info",
      headline: `${heaviest.tool} is your heaviest call at ${fmt(heaviest.avg_tokens)} tok each`,
      detail: `${fmt(heaviest.calls)} calls, up to ${fmt(heaviest.max_tokens)} tok in one — scope it tighter`,
      metric: heaviest.avg_tokens,
    });
  }

  const rank = { high: 0, warn: 1, info: 2 };
  return out.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (b.metric - a.metric)).slice(0, 8);
}

// Compact text summary of the deterministic findings + key facts, for the optional LLM deeper-read.
// Only computed facts go out — never raw spool lines, prompts, or tool results.
export function insightsSummary(report) {
  const lines = [];
  lines.push(`captures: ${report.capture_count}, sessions: ${report.sessions?.length || 0}`);
  lines.push("cost per call by group (approx tokens):");
  for (const g of report.group_cost || []) lines.push(`  ${g.group}: ${g.avg_tokens}/call, ${g.calls} calls, ${g.total_tokens} total`);
  if (report.spike_anatomy?.groups?.length) {
    lines.push("spike anatomy (lift vs normal):");
    for (const g of report.spike_anatomy.groups.slice(0, 6)) lines.push(`  ${g.group}: lift ${g.lift ?? "only-in-spikes"}, ${pct(g.spike_share)}% of spikes`);
  }
  if (report.loops?.length) lines.push(`loops: ${report.loops.length} (worst ${report.loops[0].tool} x${report.loops[0].max_repeat} in ${report.loops[0].repo})`);
  lines.push("deterministic findings:");
  for (const f of deriveInsights(report)) lines.push(`  [${f.severity}] ${f.headline} — ${f.detail}`);
  return lines.join("\n");
}

function indexBy(arr, key) {
  const m = {};
  for (const x of arr || []) m[x[key]] = x;
  return m;
}
function clip(s, n) { return s && s.length > n ? s.slice(0, n) + "…" : (s || ""); }

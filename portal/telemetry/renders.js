// Panel table/list renderers: one function per Telemetry page panel (causes, sessions, spikes,
// cost breakdowns, insights, loops, comparison). Each takes the raw server data for its panel and
// fills the panel's DOM directly via tmpl.table()/tmpl.insightRow(). Several attach click handlers
// that open a detail modal — those come in via createModalOpeners() (modals.js), passed once at
// createRenders() time so this file never imports panels.js/api.js directly.

import * as tmpl from "./templates.js";
import { fmt, short, durLabel, clip, esc } from "./state.js";

const emptyPanel = (id, msg) => { document.getElementById(id).innerHTML = "<p style='color:var(--dim)'>" + msg + "</p>"; };

// modals: the object returned by createModalOpeners() in modals.js.
export function createRenders(modals) {
  const { openModal, flaggedEventModal, openSessionModal } = modals;

  // The headline panel: each spike cause as a row, biggest token cost first. Click a row for what to do.
  function renderCauses(rows) {
    if (!rows || !rows.length) { document.getElementById("causes").innerHTML = "<p style='color:var(--dim)'>no spikes yet — nothing blowing up your tokens</p>"; return; }
    const data = rows.slice(0, 8);
    tmpl.table("causes", ["cause", "spikes", "avg Δ", "worst Δ", "repo"], data.map((c) => [
      c.cause,
      { num: c.spikes },
      { num: fmt(c.avg_delta) },
      { num: "+" + fmt(c.worst_delta), cls: "spike" },
      c.worst_repo || "unknown",
    ]), data.map((c) => () => openModal(
      c.cause + " — what to do",
      c.spikes + " spikes · worst +" + fmt(c.worst_delta) + " tok in " + (c.worst_repo || "unknown"),
      [
        ["cause", c.cause],
        ["total spikes", c.spikes],
        ["avg delta", fmt(c.avg_delta) + " tok"],
        ["worst delta", "+" + fmt(c.worst_delta) + " tok"],
        ["worst repo", c.worst_repo || "unknown"],
        ["what to change", c.hint || "inspect the session transcript"],
      ]
    )));
  }

  function renderSessions(rows) {
    const data = rows.slice(0, 12);
    tmpl.table("sessions", ["session", "time", "tokens", "tools", "mcp"], data.map((s) => {
      const repoBranch = s.repo + (s.branch ? "@" + s.branch : "");
      // Lead with what the session was about (its opening prompt), fall back to the activity summary,
      // then to the bare id. Repo/harness become the secondary context.
      const headline = s.title || s.activity || short(s.session_id);
      const sub = repoBranch + (s.harness ? " · " + s.harness : "") + " · " + short(s.session_id);
      const label = esc(clip(headline, 56)) + " <span class='go'>view chat ›</span><br><span style='color:var(--dim);font-size:11px'>" + esc(sub) + "</span>";
      return [{ html: label }, durLabel(s.first_ts, s.last_ts), { num: fmt(s.total_tokens) }, { num: s.tool_calls }, { num: s.mcp_calls }];
    }), data.map((s) => () => openSessionModal(s)));
  }

  function renderSpikes(rows) {
    if (!rows || !rows.length) { document.getElementById("spikes").innerHTML = "<p style='color:var(--dim)'>no spikes</p>"; return; }
    const data = rows.slice(0, 12);
    tmpl.table("spikes", ["time", "where", "worst Δ", "event", "hits"], data.map((s) => [
      s.ts.slice(0, 19),
      s.context?.title ? clip(s.context.title, 32) : short(s.session_id),
      { num: "+" + fmt(s.delta_tokens), cls: "spike" },
      s.tool ? s.event + " (" + s.tool + ")" : s.event,
      s.spike_count > 1 ? { num: "×" + s.spike_count } : "—",
    ]), data.map((s) => () => flaggedEventModal({
      title: "▲ +" + fmt(s.delta_tokens) + " tokens",
      sub: s.event + (s.tool ? " · " + s.tool : "") + (s.spike_count > 1 ? " · " + s.spike_count + " turns above threshold" : ""),
      rows: [
        ["timestamp", s.ts],
        ["worst delta", fmt(s.delta_tokens) + " tok"],
        ["turns above threshold", s.spike_count],
        ["cumulative total", fmt(s.total_tokens)],
        ["event", s.event],
        ["tool", s.tool],
        ["repo", s.repo],
        ["session", s.session_id],
      ],
      sessionId: s.session_id,
      harness: s.harness || s.context?.harness,
      repo: s.repo,
      finding: "spike of +" + fmt(s.delta_tokens) + " tokens at " + s.ts.slice(11, 19),
      context: s.context,
    })));
  }

  function renderContrib(id, rows) {
    tmpl.table(id, ["key", "tokens", "captures"], rows.slice(0, 12).map((r) => [
      r.key, { num: fmt(r.tokens) }, { num: r.captures },
    ]));
  }

  // The headline panel: deterministic conclusions, severity-marked. This is the "what this means"
  // read so the user does not scan tables.
  function renderInsights(rows) {
    const container = document.getElementById("insights");
    container.innerHTML = "";
    if (!rows || !rows.length) { emptyPanel("insights", "not enough data yet for conclusions"); return; }
    for (const f of rows) container.appendChild(tmpl.insightRow(f));
  }

  function renderGroupCost(rows) {
    if (!rows || !rows.length) { emptyPanel("groupcost", "no tool-result data yet"); return; }
    tmpl.table("groupcost", ["group", "avg tokens/call", "calls/session", "calls", "total"], rows.map((r) => [
      r.group, { num: fmt(r.avg_tokens) }, { num: r.calls_per_session ?? "—" }, { num: r.calls }, { num: fmt(r.total_tokens) },
    ]));
  }

  function renderToolCost(rows) {
    if (!rows || !rows.length) { emptyPanel("toolcost", "no tool-result data yet"); return; }
    const data = rows.slice(0, 14);
    tmpl.table("toolcost", ["tool", "avg tokens/call", "max", "calls"], data.map((r) => [
      r.tool, { num: fmt(r.avg_tokens) }, { num: fmt(r.max_tokens) }, { num: r.calls },
    ]), data.map((r) => () => openModal(
      r.tool + " — cost per call",
      "group: " + r.group + " · approx tokens from result size",
      [
        ["group", r.group],
        ["calls", r.calls],
        ["avg tokens/call", fmt(r.avg_tokens)],
        ["max tokens (single call)", fmt(r.max_tokens)],
        ["total tokens", fmt(r.total_tokens)],
      ]
    )));
  }

  function renderAnatomy(a) {
    if (!a || !a.groups.length) { emptyPanel("anatomy", "no spikes with attributed results yet"); return; }
    tmpl.table("anatomy", ["group", "lift vs normal", "% of spikes", "avg tokens"], a.groups.slice(0, 8).map((g) => [
      g.group,
      g.lift == null ? "only in spikes" : { num: g.lift + "×", cls: g.lift >= 1 ? "spike" : "" },
      { num: Math.round(g.spike_share * 100) + "%" },
      { num: fmt(g.avg_tokens) },
    ]));
  }

  function renderPackageCost(rows) {
    if (!rows || !rows.length) { emptyPanel("packagecost", "no package data yet"); return; }
    tmpl.table("packagecost", ["package", "avg tokens/call", "calls", "total"], rows.map((r) => [
      r.package, { num: fmt(r.avg_tokens) }, { num: r.calls }, { num: fmt(r.total_tokens) },
    ]));
  }

  function renderRegression(r) {
    if (!r || !r.groups.length) { document.getElementById("regression").innerHTML = ""; return; }
    tmpl.table("regression", ["group", "before", "after", "Δ tokens/call"], r.groups.slice(0, 8).map((g) => [
      g.group,
      { num: fmt(g.before_avg_tokens) },
      { num: fmt(g.after_avg_tokens) },
      { num: (g.delta_tokens > 0 ? "↑" : g.delta_tokens < 0 ? "↓" : "·") + fmt(Math.abs(g.delta_tokens)), cls: g.delta_tokens > 0 ? "spike" : "" },
    ]));
  }

  function renderLoops(rows) {
    const panel = document.getElementById("loopspanel");
    if (!rows || !rows.length) { panel.style.display = "none"; return; }
    panel.style.display = "";
    const data = rows.slice(0, 10);
    tmpl.table("loops", ["session", "tool", "repeats"], data.map((l) => [
      l.context?.title ? clip(l.context.title, 36) : l.repo + "/" + short(l.session_id),
      l.tool, { num: l.max_repeat, cls: "spike" },
    ]), data.map((l) => () => flaggedEventModal({
      title: "⚠ loop · " + l.tool + " ×" + l.max_repeat,
      sub: l.repo + (l.harness ? " · " + l.harness : ""),
      rows: [
        ["tool", l.tool],
        ["consecutive repeats", l.max_repeat],
        ["repo", l.repo],
        ["session", l.session_id],
        l.ts ? ["loop started", l.ts] : null,
        ["hint", l.hint],
      ],
      sessionId: l.session_id,
      harness: l.harness || l.context?.harness,
      repo: l.repo,
      finding: "a loop: " + l.tool + " fired " + l.max_repeat + "× consecutively",
      context: l.context,
    })));
  }

  function renderComparison(c) {
    tmpl.table("comparison", ["cohort", "n", "avg Δ", "avg tools", "mcp rate"], [
      ["spike", { num: c.spike.count }, { num: fmt(c.spike.avg_delta) }, { num: c.spike.avg_tool_calls }, { num: c.spike.mcp_rate }],
      ["normal", { num: c.normal.count }, { num: fmt(c.normal.avg_delta) }, { num: c.normal.avg_tool_calls }, { num: c.normal.mcp_rate }],
    ]);
  }

  return {
    renderCauses, renderSessions, renderSpikes, renderContrib, renderInsights,
    renderGroupCost, renderToolCost, renderAnatomy, renderPackageCost,
    renderRegression, renderLoops, renderComparison,
  };
}

// Panel table/list renderers: one function per Telemetry page panel (causes, sessions, spikes,
// cost breakdowns, insights, loops, comparison). Each takes the raw server data for its panel and
// fills the panel's DOM directly via tmpl.table()/tmpl.insightRow(). Several attach click handlers
// that open a detail modal — those come in via createModalOpeners() (modals.js), passed once at
// createRenders() time so this file never imports panels.js/api.js directly.

import * as tmpl from "./templates.js";
import { fmt, short, durLabel, clip } from "./state.js";

const dimNote = (msg) => tmpl.msgLine(msg, "msg-dim");
const emptyPanel = (id, msg) => { document.getElementById(id).replaceChildren(dimNote(msg)); };

// modals: the object returned by createModalOpeners() in modals.js.
export function createRenders(modals) {
  const { openModal, flaggedEventModal, openSessionModal } = modals;

  // The headline panel: each spike cause as a row, biggest token cost first. Click a row for what to do.
  function renderCauses(rows) {
    if (!rows || !rows.length) { document.getElementById("causes").replaceChildren(dimNote("no spikes yet — nothing blowing up your tokens")); return; }
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
      return [tmpl.sessionCell(clip(headline, 56), sub), durLabel(s.first_ts, s.last_ts), { num: fmt(s.total_tokens) }, { num: s.tool_calls }, { num: s.mcp_calls }];
    }), data.map((s) => () => openSessionModal(s)));
  }

  function renderSpikes(rows) {
    if (!rows || !rows.length) { document.getElementById("spikes").replaceChildren(dimNote("no spikes")); return; }
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
    container.replaceChildren();
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
    if (!r || !r.groups.length) { document.getElementById("regression").replaceChildren(); return; }
    tmpl.table("regression", ["group", "before", "after", "Δ tokens/call"], r.groups.slice(0, 8).map((g) => [
      g.group,
      { num: fmt(g.before_avg_tokens) },
      { num: fmt(g.after_avg_tokens) },
      { num: (g.delta_tokens > 0 ? "↑" : g.delta_tokens < 0 ? "↓" : "·") + fmt(Math.abs(g.delta_tokens)), cls: g.delta_tokens > 0 ? "spike" : "" },
    ]));
  }

  // Phase 5/6: marker-relative comparison — the PREFERRED comparison path once a change marker is
  // selected in the cohort filter bar (plan: "Retain midpoint regression as a labeled exploratory
  // fallback when no marker is selected" implies this IS the non-fallback path). Renders the full
  // actionable finding contract: observation, evidence, confidence, interpretation, next action.
  function renderMarkerComparison(finding) {
    const panel = document.getElementById("markercomparisonpanel");
    if (!finding) { panel.style.display = "none"; return; }
    panel.style.display = "";
    const container = document.getElementById("markercomparison");
    container.replaceChildren();
    const ev = finding.evidence;
    const rows = [tmpl.msgLine(finding.observation, "hl")];
    // Before/after/delta/confidence as scannable stat tiles (this page's existing .stat-row/
    // .stat-item language from the header meta strip) instead of one comma-packed sentence — the
    // numbers are the thing being compared, so they read as numbers, not prose.
    const deltaSign = ev.effect_size > 0 ? "+" : ev.effect_size < 0 ? "−" : "·";
    rows.push(tmpl.markerComparisonStats({
      ev: { before: { value: fmt(ev.before.value) }, after: { value: fmt(ev.after.value) } },
      sampleSize: finding.sample_size,
      confidence: finding.confidence,
      deltaLabel: deltaSign + fmt(Math.abs(ev.effect_size)) + " (" + (ev.relative_change * 100).toFixed(0) + "%)",
      isRegression: ev.effect_size > 0,
    }));
    if (finding.interpretation) {
      rows.push(tmpl.msgLine("interpretation (inference): " + finding.interpretation.text));
    }
    if (finding.next_action) {
      rows.push(tmpl.msgLine("next action: " + finding.next_action, "msg-accent"));
    }
    if (finding.data_quality_issues?.length) {
      // A bulleted list scans far faster than the same issues semicolon-joined into one paragraph —
      // each issue is its own independent caveat, not a continuation of the last one.
      rows.push(tmpl.qualityIssues(finding.data_quality_issues));
    }
    if (finding.analysis_filter_state) {
      rows.push(tmpl.openAnalysisBtn(finding.analysis_filter_state));
    }
    container.append(...rows);
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

  function renderDataQualityWarnings(rows) {
    const panel = document.getElementById("qualitypanel");
    if (!rows || !rows.length) { panel.style.display = "none"; return; }
    panel.style.display = "";
    const data = rows.slice(0, 10);
    tmpl.table("qualitywarnings", ["harness", "warning", "events", "hint"], data.map((w) => [
      w.harness || "unknown",
      w.type,
      { num: w.events || 0, cls: "spike" },
      w.hint || "inspect telemetry capture",
    ]), data.map((w) => () => openModal(
      "data quality · " + w.type,
      (w.harness || "unknown") + " · " + (w.events || 0) + " events",
      [
        ["harness", w.harness || "unknown"],
        ["warning", w.type],
        ["events", w.events || 0],
        ["token records", w.token_records ?? "—"],
        ["hint", w.hint || "inspect telemetry capture"],
      ],
    )));
  }

  function renderReadWarnings(rows) {
    const panel = document.getElementById("readwarningpanel");
    if (!rows || !rows.length) { panel.style.display = "none"; return; }
    panel.style.display = "";
    const data = rows.slice(0, 10);
    tmpl.table("readwarnings", ["session", "warning", "reads", "approx tokens"], data.map((w) => [
      w.context?.title ? clip(w.context.title, 34) : w.repo + "/" + (w.session_short_id || short(w.session_id)),
      w.type,
      { num: w.read_count || 0 },
      { num: w.approx_tokens ? fmt(w.approx_tokens) : "—", cls: w.approx_tokens ? "spike" : "" },
    ]), data.map((w) => () => flaggedEventModal({
      title: "read warning · " + w.type,
      sub: w.repo + (w.harness ? " · " + w.harness : ""),
      rows: [
        ["warning", w.type],
        ["repo", w.repo],
        ["session", w.session_id],
        ["file extension", w.file_ext || "—"],
        ["file path hash", w.file_path_hash || "—"],
        ["reads", w.read_count || 0],
        ["result chars", w.result_chars ? fmt(w.result_chars) : "—"],
        ["approx tokens", w.approx_tokens ? fmt(w.approx_tokens) : "—"],
        ["hint", w.hint],
      ],
      sessionId: w.session_id,
      harness: w.harness || w.context?.harness,
      repo: w.repo,
      finding: w.type + " in " + w.repo,
      context: w.context,
    })));
  }

  // Phase 7: testing-efficiency panel (plan: "Add a first-class panel under warnings and
  // abnormalities" — "should lead with the most actionable abnormality rather than a comprehensive
  // table"). Reads the metrics-registry values telemetry-analyze.mjs's testingEfficiencySummary()
  // computed, same numbers the CLI report's future testing-efficiency section will show.
  function renderTestingEfficiency(summary) {
    const panel = document.getElementById("testeffpanel");
    if (!summary) { panel.style.display = "none"; return; }
    const share = summary["test.share_of_tool_time"];
    const fullPerSession = summary["test.full_suite_calls_per_session"];
    const redundant = summary["test.full_suite_without_intervening_edit"];
    const unchangedFailure = summary["test.full_suite_unchanged_failure_signature"];
    // Nothing to show yet (no test-classified operations in this cohort) — keep the panel hidden
    // rather than showing an all-null table.
    if (share == null && fullPerSession == null && redundant == null) { panel.style.display = "none"; return; }
    panel.style.display = "";
    const container = document.getElementById("testefficiency");
    // tmpl.table() owns and clears #testefficiency directly, so the headline lives in its OWN
    // sibling node (created once, reused) rather than as a child tmpl.table() would wipe out.
    let headlineEl = document.getElementById("testeffheadline");
    if (!headlineEl) {
      headlineEl = tmpl.msgLine("", "hl");
      headlineEl.id = "testeffheadline";
      container.before(headlineEl);
    }
    // Lead with the most actionable abnormality (redundant reruns), not a full table, per the plan.
    headlineEl.textContent = redundant > 0
      ? `Testing consumed ${share != null ? share + "%" : "an unmeasured share"} of captured tool time. `
        + `${fmt(redundant)} full-suite rerun${redundant === 1 ? "" : "s"} had no intervening source edit — `
        + `run a targeted reproduction first, and reserve the next full suite for a phase boundary.`
      : share != null
        ? `Testing consumed ${share}% of captured tool time.`
        : "";
    const rows = [
      ["full-suite runs / session", fullPerSession != null ? fullPerSession.toFixed(2) : "—"],
      ["full-suite runs / debugging phase", summary["test.full_suite_calls_per_debug_phase"] != null ? summary["test.full_suite_calls_per_debug_phase"].toFixed(2) : "—"],
      ["redundant reruns (no intervening edit)", redundant ?? "—"],
      ["reruns with unchanged failure signature", unchangedFailure ?? "—"],
      ["targeted-to-full ratio", summary["test.targeted_to_full_ratio"] != null ? summary["test.targeted_to_full_ratio"].toFixed(2) : "—"],
      ["finalization full-suite count", summary["test.finalization_full_suite_count"] ?? "—"],
    ];
    tmpl.table("testefficiency", ["metric", "value"], rows);
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
    renderRegression, renderMarkerComparison, renderTestingEfficiency, renderLoops,
    renderDataQualityWarnings, renderReadWarnings, renderComparison,
  };
}

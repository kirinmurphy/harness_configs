// Wiring only: DOM refs, event listeners, and orchestration between api.js (server calls),
// state.js (pure formatting/lookups), chart.js (canvas view), templates.js (markup), and
// panels.js (the detail modal). No markup construction or canvas drawing should live in this
// file — add a template in templates.js or a draw routine in chart.js instead.

import { portalSetUpdatedAt, portalHideLoading, portalCopyText } from "/portal/shared/api.js";
import * as api from "./api.js";
import * as tmpl from "./templates.js";
import { createDetailModal } from "./panels.js";
import { createChart } from "./chart.js";
import { fmt, short, durLabel, clip, sessionById as lookupSessionById } from "./state.js";

let firstLoad = true;
let lastVersion = null;
// Timeline + threshold from the most recent (already window-scoped) server response, kept so a
// resize or pan can redraw the chart without refetching.
let allTimeline = [];
let curThreshold = 0;
// Most recent session rollups, kept so the cumulative chart's session chips can open full detail.
let allSessions = [];
// Global time filter, applied SERVER-SIDE so every panel reflects it. rangeMs = trailing span
// (null = all data). panEnd = epoch ms at the window's right edge (null = follow latest so live
// captures keep arriving). Dragging the chart sets panEnd. harness = null means all.
let view = { rangeMs: null, panEnd: null, harness: null };
// Which AI CLI is available for the deeper-read feature (claude / codex / null).
let deepReadCli = null;
// Last deeper-read text for the copy button.
let lastDeepReadText = null;

const modal = createDetailModal();
const chart = createChart({
  onBarClick: openCaptureModal,
  onSessionClick: openSessionModal,
  getSessionById: sessionById,
});
chart.setPanHandler(() => load(true));

function sessionById(id) {
  return lookupSessionById(id, allSessions);
}

function renderMeta(data) {
  const meta = document.getElementById("meta");
  const spikeCount = (data.spikes || []).length;
  const spikeRate = data.capture_count > 0 ? Math.round((spikeCount / data.capture_count) * 1000) / 10 : 0;
  const scope = (view.rangeMs == null ? "all time" : "filtered") + (view.harness ? " · " + view.harness + " only" : "");
  meta.replaceChildren(
    tmpl.statItem("captures", fmt(data.capture_count)),
    tmpl.statItem("sessions", fmt(data.sessions.length)),
    tmpl.statItem("spike rate", spikeRate + "%" + (spikeCount ? " (" + fmt(spikeCount) + ")" : "")),
    tmpl.statItem("scope", scope),
  );
}

function redrawChart() {
  chart.redraw(allTimeline, curThreshold, undefined, view);
}

// Clear every data panel so stale numbers don't linger while a new window computes. Used on explicit
// filter changes (range / harness), not on the silent background poll.
function wipeSections() {
  for (const id of ["insights", "spikes", "causes", "anatomy", "groupcost", "toolcost", "packagecost", "regression", "loops", "sessions", "tools", "mcp", "comparison"]) {
    const node = document.getElementById(id);
    if (node) node.innerHTML = "";
  }
  allTimeline = [];
  redrawChart();
}

function setLoading(on) {
  const ov = document.getElementById("loadoverlay");
  if (ov) ov.classList.toggle("on", !!on);
}

// Fetch the report scoped to the current global filter and repaint EVERY panel. Pass force=true to
// repaint even when the server's version is unchanged (range/pan/resize). The version embeds the
// windowed event set, so a normal 5s poll only repaints when that window's data actually changed.
async function load(force, opts) {
  const wipe = !!(opts && opts.wipe);
  if (wipe) { wipeSections(); setLoading(true); }
  let qs = view.rangeMs == null ? "" : "?range=" + view.rangeMs + (view.panEnd == null ? "" : "&end=" + view.panEnd);
  if (view.harness) qs += (qs ? "&" : "?") + "harness=" + encodeURIComponent(view.harness);
  let data;
  try {
    data = await api.fetchAnalysis(qs);
  } finally {
    if (wipe) setLoading(false);
    if (firstLoad) { firstLoad = false; portalHideLoading(); }
  }
  if (!force && data.version === lastVersion) return;
  lastVersion = data.version;
  renderMeta(data);
  portalSetUpdatedAt();
  // Update the deeper-read button label based on which CLI is available.
  if (data.deepread_cli !== undefined) {
    deepReadCli = data.deepread_cli;
    document.getElementById("deepread").textContent = "deeper read" + (deepReadCli ? " (" + deepReadCli + ")" : " (unavailable)") + " ›";
  }
  // Render harness filter only when more than one harness exists in the spool.
  if (data.available_harnesses) updateHarnessFilter(data.available_harnesses);
  renderCauses(data.spike_causes);
  document.body.dataset.threshold = data.spike_threshold || 0;
  allTimeline = data.timeline || [];
  curThreshold = data.spike_threshold || 0;
  chart.redraw(allTimeline, curThreshold, data.cumulative_concern || 20_000_000, view);
  renderInsights(data.insights);
  renderGroupCost(data.group_cost);
  renderToolCost(data.tool_cost);
  renderAnatomy(data.spike_anatomy);
  renderPackageCost(data.package_cost);
  renderRegression(data.regression);
  renderLoops(data.loops);
  allSessions = data.sessions || [];
  renderSessions(data.sessions);
  renderSpikes(data.spikes);
  renderContrib("tools", data.top_tools);
  renderContrib("mcp", data.top_mcp);
  renderComparison(data.comparison);
}

function updateHarnessFilter(harnesses) {
  const el = document.getElementById("harnessfilt");
  if (harnesses.length <= 1) { el.classList.remove("visible"); return; }
  el.classList.add("visible");
  // Rebuild buttons only when the harness list changes.
  const cur = [...el.querySelectorAll("button[data-harness]")].map((b) => b.dataset.harness).join(",");
  if (cur === ["all", ...harnesses].join(",")) return;
  const existing = [...el.querySelectorAll("button[data-harness]")];
  for (const b of existing) b.remove();
  const allBtn = document.createElement("button");
  allBtn.dataset.harness = "all"; allBtn.textContent = "all";
  if (!view.harness) allBtn.classList.add("active");
  el.appendChild(allBtn);
  for (const h of harnesses) {
    const btn = document.createElement("button");
    btn.dataset.harness = h; btn.textContent = h;
    if (view.harness === h) btn.classList.add("active");
    el.appendChild(btn);
  }
}

// --- detail modal --------------------------------------------------------------------------------
// Generic key/value popup. rows is an array of [label, value]; null entries are dropped so callers
// can include optional fields inline. opts.actions = [{label, onClick}] renders buttons; the extra
// region is cleared unless a caller fills it (e.g. fetched transcript turns).
function openModal(title, sub, rows, opts) {
  modal.open(title, sub, rows, opts);
}

// Fetch a flagged event's chat context (transcript turns + paste-ready prompt) and render it into the
// modal's extra region. Best-effort: a missing transcript shows a note, never an error.
async function fetchSessionContext(id, harness, finding, repo) {
  const extra = modal.extra();
  extra.innerHTML = "<div class='note'>loading chat context…</div>";
  try {
    const data = await api.fetchSession({ id, harness, finding, repo });
    if (!data.found) {
      extra.innerHTML = "<div class='note'>transcript not found on disk (rotated or different machine). Use the analysis prompt above.</div>";
      return;
    }
    const turns = (data.heavy_turns || []).map((t) =>
      "<div class='turn'><div class='th'><span class='tool'>" + escHtml(t.tool || "tool")
      + (t.is_mcp ? " (mcp)" : "") + "</span><span>" + fmt(t.approx_tokens) + " tok · " + fmt(t.result_chars) + " chars</span></div>"
      + "<div class='prev'>" + escHtml(t.preview || "") + "</div></div>"
    ).join("");
    extra.innerHTML = "<div class='note'>heaviest turns in this chat (result size = context cost):</div>" + turns;
  } catch (err) {
    extra.innerHTML = "<div class='note'>could not load transcript: " + escHtml(String((err && err.message) || err)) + "</div>";
  }
}

// Detail modal for a flagged event (spike or loop): the same key/value rows, PLUS chat-identity
// markers (title/activity) and two actions — copy a paste-ready analysis prompt, and surface the
// chat's heavy turns inline.
function flaggedEventModal({ title, sub, rows, sessionId, harness, finding, repo, context }) {
  const ctxRows = context ? [
    context.title ? ["chat", context.title] : null,
    context.activity ? ["activity", context.activity] : null,
  ] : [];
  openModal(title, sub, [...ctxRows, ...rows], {
    actions: [
      { label: "surface chat context", onClick: () => fetchSessionContext(sessionId, harness, finding, repo) },
      { label: "copy analysis prompt", onClick: async () => {
        // Pull the server-built prompt (it includes the located transcript path), fall back to a
        // basic one if the transcript is gone.
        const data = await api.fetchSession({ id: sessionId, harness, finding, repo });
        await portalCopyText(data.analysis_prompt || "");
        modal.extra().innerHTML = "<div class='note'>analysis prompt copied to clipboard ✓</div>";
      } },
    ],
  });
}

// Full detail for one capture (chart bar). Surfaces every field the tooltip abbreviates plus the
// raw timestamp and cumulative total.
function openCaptureModal(p) {
  const spike = curThreshold > 0 && p.delta >= curThreshold;
  openModal(
    (spike ? "▲ spike · " : "") + "+" + fmt(p.delta) + " tokens",
    p.event + (p.tool ? " · " + p.tool : ""),
    [
      p.prompt ? ["prompt", p.prompt] : null,
      ["timestamp", p.ts],
      ["delta tokens", fmt(p.delta)],
      ["cumulative total", fmt(p.total)],
      ["event", p.event],
      ["tool", p.tool],
      p.mcp_tool ? ["mcp tool", p.mcp_tool] : null,
      p.file_ext ? ["file ext", "." + p.file_ext] : null,
      p.result_chars != null ? ["result size", fmt(p.result_chars) + " chars"] : null,
      p.duration_ms != null ? ["duration", p.duration_ms + " ms"] : null,
      ["spike cause", p.cause],
      ["repo", p.repo],
      ["session", p.session_id],
      ["over threshold", spike ? "yes (≥ " + fmt(curThreshold) + ")" : "no"],
    ]
  );
}

// Full session detail with chat-context actions (surface transcript turns / copy analysis prompt).
// Shared by the sessions table and the cumulative chart's session chips.
function openSessionModal(s) {
  flaggedEventModal({
    title: s.title || (s.repo + (s.branch ? "@" + s.branch : "") + " session"),
    sub: s.harness + " · " + short(s.session_id),
    rows: [
      ["session id", s.session_id],
      ["repo", s.repo],
      ["branch", s.branch],
      ["git sha", s.sha],
      ["harness", s.harness],
      ["started", s.first_ts],
      ["last seen", s.last_ts],
      ["duration", durLabel(s.first_ts, s.last_ts)],
      ["total tokens", fmt(s.total_tokens)],
      ["tool calls", s.tool_calls],
      ["mcp calls", s.mcp_calls],
      ["captures", s.captures],
    ],
    sessionId: s.session_id,
    harness: s.harness,
    repo: s.repo,
    finding: "total " + fmt(s.total_tokens) + " tokens over " + durLabel(s.first_ts, s.last_ts),
    context: { title: s.title, activity: s.activity, repo: s.repo, branch: s.branch, harness: s.harness },
  });
}

// --- render: headline / tables --------------------------------------------------------------------
const emptyPanel = (id, msg) => { document.getElementById(id).innerHTML = "<p style='color:var(--dim)'>" + msg + "</p>"; };

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
    const label = escHtml(clip(headline, 56)) + " <span class='go'>view chat ›</span><br><span style='color:var(--dim);font-size:11px'>" + escHtml(sub) + "</span>";
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

// Optional LLM synthesis on demand. Hits /api/insights-llm (shells to claude/codex -p server-side).
// Slow (seconds); shows a spinner, degrades to a note if no CLI is available.
async function runDeepRead() {
  const out = document.getElementById("deepreadout");
  const copyWrap = document.getElementById("deepreadcopy");
  copyWrap.style.display = "none";
  lastDeepReadText = null;
  const cli = deepReadCli || "claude";
  out.textContent = "asking " + cli + "… (this can take a few seconds)";
  try {
    const data = await api.fetchInsightsLlm();
    if (data.ok) {
      out.textContent = data.text;
      lastDeepReadText = data.text;
      copyWrap.style.display = "";
    } else {
      out.textContent = "deeper read unavailable: " + (data.note || "unknown");
    }
  } catch (err) {
    out.textContent = "deeper read failed: " + ((err && err.message) || err);
  }
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

function escHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Delegated clicks for dynamic content: table rows, the delta show-all toggle, session chips,
// harness filter, view-more legend buttons, and copy response (all rendered fresh on each repaint).
document.addEventListener("click", (e) => {
  if (e.target.closest("#deepread")) { runDeepRead(); return; }
  if (e.target.closest("#copydeepread")) {
    if (lastDeepReadText) {
      portalCopyText(lastDeepReadText).then(() => {
        const btn = document.getElementById("copydeepread");
        const orig = btn.textContent;
        btn.textContent = "copied ✓";
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    }
    return;
  }
  if (e.target.closest("#deltafilter")) { chart.toggleShowAll(); return; }
  if (e.target.closest("#viewmore-cumulative")) { chart.viewMore("cumulative"); return; }
  if (e.target.closest("#viewmore-bygroup")) { chart.viewMore("bygroup"); return; }
  // Harness filter buttons.
  const harnessBtn = e.target.closest("#harnessfilt button[data-harness]");
  if (harnessBtn) {
    view.harness = harnessBtn.dataset.harness === "all" ? null : harnessBtn.dataset.harness;
    for (const b of document.querySelectorAll("#harnessfilt button")) b.classList.toggle("active", b === harnessBtn);
    load(true, { wipe: true });
    return;
  }
  const chip = e.target.closest(".sesschip");
  if (chip) { const s = sessionById(chip.dataset.sid); if (s) openSessionModal(s); return; }
  const tr = e.target.closest("tr.clickable");
  if (!tr) return;
  const panel = tr.closest("[id]");
  const handlers = panel && tmpl.tableDetails[panel.id];
  const ri = Number(tr.dataset.row);
  if (handlers && handlers[ri]) handlers[ri]();
});

const timelineCanvas = document.getElementById("timeline");
timelineCanvas.addEventListener("mousedown", (e) => chart.onTimelineDown(e, view));
// Track move/up on the WINDOW so a drag that wanders off the canvas still pans and releases
// correctly. onTimelineMove/Up no-op unless a press started on the canvas, so other page activity
// is unaffected.
window.addEventListener("mousemove", (e) => chart.onTimelineMove(e, view));
window.addEventListener("mouseup", (e) => chart.onTimelineUp(e));

// Range buttons: set the global filter span (or "all"), reset pan to live-follow, refetch every
// panel scoped to that window.
document.getElementById("ranges").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-range]");
  if (!btn) return;
  for (const b of document.querySelectorAll("#ranges button[data-range]")) b.classList.toggle("active", b === btn);
  view.rangeMs = btn.dataset.range === "all" ? null : Number(btn.dataset.range);
  view.panEnd = null;
  chart.resetLegend();
  load(true, { wipe: true });
});

// Chart view toggle: deltas / cumulative / lifespan. Pan + click-detail apply to deltas only.
document.getElementById("chartmodes").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-mode]");
  if (!btn) return;
  for (const b of document.querySelectorAll("#chartmodes button")) b.classList.toggle("active", b === btn);
  chart.setMode(btn.dataset.mode);
});

// Telemetry on/off state drives the "turn on telemetry" prompt above the chart. Read from /api/config
// (same source the config page uses). When off, the page shell + empty sections still render; the
// prompt offers a one-click enable that hits the SAME endpoint as onboarding / the config toggle.
async function refreshTelemetryState() {
  try {
    const cfg = await api.fetchTelemetryState();
    const on = !!(cfg.telemetry && cfg.telemetry.enabled);
    document.getElementById("telemetryoff").style.display = on ? "none" : "";
  } catch { /* leave prompt hidden on error */ }
}

document.getElementById("enabletelemetry").addEventListener("click", async () => {
  const btn = document.getElementById("enabletelemetry");
  const err = document.getElementById("enableerr");
  btn.disabled = true; err.textContent = "";
  try {
    await api.enableTelemetry();
    document.getElementById("telemetryoff").style.display = "none";
    load(true, { wipe: true });
  } catch (e) {
    err.textContent = e.message; btn.disabled = false;
  }
});

const LOAD_POLL_INTERVAL_MS = 5000;
const TELEMETRY_STATE_POLL_INTERVAL_MS = 10000;

function showError(err) {
  console.error(err);
}

load(true).catch(showError);
refreshTelemetryState();
setInterval(() => load(false).catch(showError), LOAD_POLL_INTERVAL_MS);
setInterval(refreshTelemetryState, TELEMETRY_STATE_POLL_INTERVAL_MS);
window.addEventListener("resize", () => redrawChart());

// The theme toggle + nav are wired by the shared /portal/shared/theme.js. Canvas colors are
// resolved from CSS vars at draw time, so redraw when the shared toggle flips the theme (mirrors
// the resize handler).
document.documentElement.addEventListener("roborepo:themechange", () => {
  try { redrawChart(); } catch (e) {}
});

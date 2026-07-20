// Wiring only: DOM refs, event listeners, and orchestration between api.js (server calls),
// state.js (pure formatting/lookups), chart.js (canvas view), templates.js (markup), panels.js
// (the detail modal), modals.js (detail-modal openers), and renders.js (panel renderers). No
// markup construction, canvas drawing, or panel-render logic should live in this file — add a
// template in templates.js, a draw routine in chart.js, or a render* in renders.js instead.

import { portalSetUpdatedAt, portalHideLoading, portalCopyText } from "/portal/shared/api.js";
import * as api from "./api.js";
import * as tmpl from "./templates.js";
import { createDetailModal } from "./panels.js";
import { createModalOpeners } from "./modals.js";
import { createRenders } from "./renders.js";
import { createChart } from "./chart.js";
import { fmt, sessionById as lookupSessionById } from "./state.js";

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
const modals = createModalOpeners({ modal, getThreshold: () => curThreshold });
const renders = createRenders(modals);
const { openSessionModal } = modals;
const chart = createChart({
  onBarClick: modals.openCaptureModal,
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
    ...(data.codex_provider_rate_limits ? [tmpl.statItem("Codex provider limit", codexRateLimitLabel(data.codex_provider_rate_limits))] : []),
  );
}

function codexRateLimitLabel(rateLimits) {
  const rows = Array.isArray(rateLimits) ? rateLimits : [rateLimits];
  const row = rows.find((limit) => typeof limit?.used_percent === "number") || rows[0];
  if (!row) return "reported";
  const used = typeof row.used_percent === "number" ? row.used_percent + "% used" : "reported";
  return (row.name ? row.name + " · " : "") + used;
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
  renders.renderCauses(data.spike_causes);
  document.body.dataset.threshold = data.spike_threshold || 0;
  allTimeline = data.timeline || [];
  curThreshold = data.spike_threshold || 0;
  chart.redraw(allTimeline, curThreshold, data.cumulative_concern || 20_000_000, view);
  renders.renderInsights(data.insights);
  renders.renderGroupCost(data.group_cost);
  renders.renderToolCost(data.tool_cost);
  renders.renderAnatomy(data.spike_anatomy);
  renders.renderPackageCost(data.package_cost);
  renders.renderRegression(data.regression);
  renders.renderLoops(data.loops);
  renders.renderDataQualityWarnings(data.data_quality_warnings);
  renders.renderReadWarnings(data.read_warnings);
  allSessions = data.sessions || [];
  renders.renderSessions(data.sessions);
  renders.renderSpikes(data.spikes);
  renders.renderContrib("tools", data.top_tools);
  renders.renderContrib("mcp", data.top_mcp);
  renders.renderComparison(data.comparison);
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
  el.append(
    tmpl.harnessBtn("all", !view.harness),
    ...harnesses.map((h) => tmpl.harnessBtn(h, view.harness === h)),
  );
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

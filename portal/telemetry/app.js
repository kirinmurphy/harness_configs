// Wiring only: DOM refs, event listeners, and orchestration between api.js (server calls),
// state.js (pure formatting/lookups), chart.js (canvas view), templates.js (markup), panels.js
// (the detail modal), modals.js (detail-modal openers), and renders.js (panel renderers). No
// markup construction, canvas drawing, or panel-render logic should live in this file — add a
// template in templates.js, a draw routine in chart.js, or a render* in renders.js instead.

import { portalSetUpdatedAt, portalHideLoading, portalCopyText, portalWireBackdropClose } from "/portal/shared/api.js";
import * as api from "./api.js";
import * as tmpl from "./templates.js";
import { createDetailModal } from "./panels.js";
import { createModalOpeners } from "./modals.js";
import { createRenders } from "./renders.js";
import { createChart } from "./chart.js";
import { createAnalysisExplorer } from "./analysis-explorer.js";
import { createDocGuideModal } from "/portal/shared/doc-guide-modal.js";
import {
  fmt, sessionById as lookupSessionById, viewFromSearchParams, syncViewToUrl, activeFilterCountFromView,
} from "./state.js";

let firstLoad = true;
let lastVersion = null;
// Timeline + threshold from the most recent (already window-scoped) server response, kept so a
// resize or pan can redraw the chart without refetching.
let allTimeline = [];
let curThreshold = 0;
// Most recent session rollups, kept so the cumulative chart's session chips can open full detail.
let allSessions = [];
// Most recent window-scoped markers, kept for chart redraws (resize/theme change) without refetching.
let allMarkers = [];
// Global cohort filter, applied SERVER-SIDE so every panel reflects it (plan: "Hybrid filtering" —
// "Global filters define the cohort used by every panel"). rangeMs = trailing span (null = all
// data). panEnd = epoch ms at the window's right edge (null = follow latest so live captures keep
// arriving). Dragging the chart sets panEnd. harness/model/repo = null means all. markerId selects a
// marker-relative comparison shown in the regression panel. Restored from the URL on load and
// synced back on every change so a filtered view can be bookmarked/copied (plan: "Filters must
// serialize into the URL so a filtered analysis can be copied, bookmarked, and restored after
// reload").
let view = viewFromSearchParams(new URLSearchParams(location.search));
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
  onMarkerClick: openMarkerDetailModal,
});
chart.setPanHandler(() => load(true));
const analysisExplorer = createAnalysisExplorer();

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
  for (const id of ["insights", "spikes", "causes", "anatomy", "groupcost", "toolcost", "packagecost", "regression", "markercomparison", "testefficiency", "loops", "sessions", "tools", "mcp", "comparison"]) {
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
  if (view.model) qs += (qs ? "&" : "?") + "model=" + encodeURIComponent(view.model);
  if (view.repo) qs += (qs ? "&" : "?") + "repo=" + encodeURIComponent(view.repo);
  if (view.markerId) qs += (qs ? "&" : "?") + "marker_id=" + encodeURIComponent(view.markerId);
  syncViewToUrl(view);
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
  if (data.available_models) updateSelectOptions("modelfilt", data.available_models, view.model);
  if (data.available_repos) updateSelectOptions("repofilt", data.available_repos, view.repo);
  updateMarkerFilter(data.markers || [], data.experiments || []);
  updateCohortSummary(data.cohort);
  analysisExplorer.refresh({ markers: data.markers || [], metrics: data.available_metrics || [], harnesses: data.available_harnesses || [] });
  renders.renderCauses(data.spike_causes);
  document.body.dataset.threshold = data.spike_threshold || 0;
  allTimeline = data.timeline || [];
  allMarkers = data.markers || [];
  curThreshold = data.spike_threshold || 0;
  chart.redraw(allTimeline, curThreshold, data.cumulative_concern || 20_000_000, view, allMarkers);
  renders.renderInsights(data.insights);
  renders.renderGroupCost(data.group_cost);
  renders.renderToolCost(data.tool_cost);
  renders.renderAnatomy(data.spike_anatomy);
  renders.renderPackageCost(data.package_cost);
  renders.renderRegression(data.regression);
  renders.renderMarkerComparison(data.marker_comparison);
  renders.renderTestingEfficiency(data.testing_efficiency);
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

// Phase 6: model/repo <select> options. Rebuilt only when the option list actually changes so a
// user's current selection (and the dropdown's open state) isn't disturbed on every 5s poll.
function updateSelectOptions(selectId, values, selectedValue) {
  const el = document.getElementById(selectId);
  const cur = [...el.querySelectorAll("option[value]:not([value=''])")].map((o) => o.value).join(",");
  if (cur !== values.join(",")) {
    for (const o of [...el.querySelectorAll("option[value]:not([value=''])")]) o.remove();
    el.append(...values.map((v) => tmpl.selectOption(v, v, v === selectedValue)));
  }
  el.value = selectedValue || "";
}

// Phase 6: marker-comparison <select>, populated from window-scoped markers of type "change"
// (change markers are what marker-relative comparisons compare across — plan: "For a selected
// change marker"). Experiments aren't rendered as separate options; their start marker already
// appears here as a "change"-adjacent marker type (experiment-start), included for symmetry.
function updateMarkerFilter(markers, experiments) {
  const el = document.getElementById("markerfilt");
  const comparable = markers.filter((m) => m.type === "change" || m.type === "experiment-start");
  const cur = [...el.querySelectorAll("option[value]:not([value=''])")].map((o) => o.value).join(",");
  const next = comparable.map((m) => m.marker_id).join(",");
  if (cur !== next) {
    for (const o of [...el.querySelectorAll("option[value]:not([value=''])")]) o.remove();
    el.append(...comparable.map((m) => tmpl.markerOption(m, m.marker_id === view.markerId)));
  }
  el.value = view.markerId || "";
  document.getElementById("openmarkermodal").dataset.experimentCount = experiments.length;
}

function updateCohortSummary(cohort) {
  const el = document.getElementById("cohortsummary");
  const clearBtn = document.getElementById("cohortclear");
  const activeCount = activeFilterCountFromView(view);
  el.textContent = activeCount > 0 ? (cohort?.summary || "") + " (" + activeCount + " active)" : "";
  clearBtn.style.display = activeCount > 0 ? "" : "none";
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
  // "open analysis" affordance on any insight/finding row — reproduces that finding's exact cohort
  // and metric in the Analysis explorer (plan: "'open analysis' reproduces the alert's exact cohort
  // and metric"). filter_state is a JSON-serialized analysis_filter_state from the finding contract.
  const openAnalysisBtn = e.target.closest(".open-analysis");
  if (openAnalysisBtn) {
    try { analysisExplorer.openWithFilterState(JSON.parse(openAnalysisBtn.dataset.filterState || "{}")); } catch {}
    return;
  }
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

// Phase 6: global cohort filter bar (model/repo/marker-comparison + clear). Each change refetches
// every panel scoped to the new cohort, same pattern as the range/harness filters above.
document.getElementById("modelfilt").addEventListener("change", (e) => {
  view.model = e.target.value || null;
  load(true, { wipe: true });
});
document.getElementById("repofilt").addEventListener("change", (e) => {
  view.repo = e.target.value || null;
  load(true, { wipe: true });
});
document.getElementById("markerfilt").addEventListener("change", (e) => {
  view.markerId = e.target.value || null;
  load(true, { wipe: true });
});
document.getElementById("cohortclear").addEventListener("click", () => {
  view.model = null;
  view.repo = null;
  view.markerId = null;
  load(true, { wipe: true });
});

// If the URL restored a range/harness on load, reflect it in the range/harness button active state
// (the buttons themselves only get their initial "all"/no-harness active class from the static
// HTML). updateHarnessFilter() already re-derives the harness buttons' active state from view on
// every load(), so only the static range buttons need a one-time sync here.
if (view.rangeMs != null) {
  for (const b of document.querySelectorAll("#ranges button[data-range]")) {
    b.classList.toggle("active", Number(b.dataset.range) === view.rangeMs);
  }
}

// --- Phase 6: create-marker dialog --------------------------------------------------------------
const markerModal = document.getElementById("marker-modal");
portalWireBackdropClose(markerModal, closeMarkerModal);
document.getElementById("markermodalclose").addEventListener("click", closeMarkerModal);
document.getElementById("markertype").addEventListener("change", (e) => {
  document.getElementById("markerstatuswrap").style.display = e.target.value === "outcome" ? "" : "none";
});

function openCreateMarkerModal(prefill) {
  document.getElementById("markererr").textContent = "";
  document.getElementById("markertitle").value = prefill?.title || "";
  document.getElementById("markertype").value = prefill?.type || "change";
  document.getElementById("markermetric").value = prefill?.metric || "";
  document.getElementById("markerdirection").value = prefill?.expected_direction || "";
  document.getElementById("markerstatuswrap").style.display = (prefill?.type || "change") === "outcome" ? "" : "none";
  if (!markerModal.open) markerModal.showModal();
}

function closeMarkerModal() {
  markerModal.close();
}

document.getElementById("openmarkermodal").addEventListener("click", () => openCreateMarkerModal());

// --- "view docs" popup: renders docs/guides/telemetry.md server-side rather than duplicating its
// content into this page. Header "docs" link opens at the top; each .infoicon next to a panel
// heading opens the same popup pre-scrolled to that heading's slug id (data-doc-anchor), via one
// delegated listener rather than wiring every icon individually. ---------------------------------
const docModal = createDocGuideModal(document.getElementById("docmodal"), api.fetchTelemetryGuide);
document.getElementById("opendocs").addEventListener("click", () => docModal.open());
document.addEventListener("click", (event) => {
  const trigger = event.target.closest(".infoicon[data-doc-anchor]");
  if (!trigger) return;
  docModal.open(trigger.dataset.docAnchor);
});

// Chart-click marker detail: the generic key/value popup (same primitive every other detail view
// uses), not the create form — clicking an existing marker on the timeline shows what it is, not an
// editable form (plan: "click opens marker detail").
function openMarkerDetailModal(marker) {
  modals.openModal(
    marker.title,
    marker.type + " · " + marker.ts.slice(0, 19).replace("T", " "),
    [
      ["type", marker.type],
      ["timestamp", marker.ts],
      ["repo", marker.repo],
      ["branch", marker.branch],
      ["sha", marker.sha],
      marker.packages?.length ? ["packages", marker.packages.join(", ")] : null,
      marker.skills?.length ? ["skills", marker.skills.join(", ")] : null,
      marker.metric ? ["metric", marker.metric] : null,
      marker.expected_direction ? ["expected direction", marker.expected_direction] : null,
      marker.status ? ["status", marker.status] : null,
      ["marker id", marker.marker_id],
    ],
    marker.type === "change" ? {
      actions: [{
        label: "compare across this marker",
        onClick: () => { view.markerId = marker.marker_id; modal.close(); load(true, { wipe: true }); },
      }],
    } : undefined,
  );
}

document.getElementById("markerform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = document.getElementById("markererr");
  errEl.textContent = "";
  const type = document.getElementById("markertype").value;
  const title = document.getElementById("markertitle").value.trim();
  const metric = document.getElementById("markermetric").value.trim();
  const expected_direction = document.getElementById("markerdirection").value;
  const status = document.getElementById("markerstatus").value;
  if (!title) { errEl.textContent = "title is required"; return; }
  try {
    await api.createMarker({
      type,
      title,
      metric: metric || null,
      expected_direction: expected_direction || null,
      status: type === "outcome" ? status : null,
    });
    closeMarkerModal();
    load(true, { wipe: true });
  } catch (err) {
    errEl.textContent = (err && err.message) || String(err);
  }
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

// Analysis explorer (Phase 7): the high-cardinality comparison drawer the plan's "Hybrid filtering"
// design calls for — global filters stay compact (app.js's cohort filter bar), and every deeper
// refinement (arbitrary cohort-vs-cohort or marker-relative comparison on any registry metric) lives
// here instead. Owns its own small piece of DOM (the #analysisexplorer <details> block) and talks to
// the server only through POST /api/telemetry/analysis (api.js's fetchTelemetryAnalysis) — never
// duplicates cohort-matching or metric-formula logic client-side (plan: "Do not let UI components
// independently define formulas").
//
// createAnalysisExplorer() is called once from app.js at startup and given the data it needs
// (available metrics, current markers) via refresh(); app.js's own load() calls refresh() on every
// poll so the explorer's marker/metric dropdowns stay current without a separate fetch.

import * as api from "./api.js";
import * as tmpl from "./templates.js";
import { portalEl as el } from "/portal/shared/api.js";

export function createAnalysisExplorer() {
  const metricSelect = document.getElementById("explorer-metric");
  const modeButtons = document.getElementById("explorer-mode");
  const markerControls = document.getElementById("explorer-marker-controls");
  const cohortControls = document.getElementById("explorer-cohort-controls");
  const markerSelect = document.getElementById("explorer-marker");
  const aHarnessSelect = document.getElementById("explorer-a-harness");
  const bHarnessSelect = document.getElementById("explorer-b-harness");
  let knownHarnesses = [];
  const runBtn = document.getElementById("explorer-run");
  const resultEl = document.getElementById("explorer-result");
  const detailsEl = document.getElementById("analysisexplorer");

  let mode = "marker";
  let knownMetrics = [];
  let currentMarkers = [];

  // Populated once (metric list is static — the registry doesn't change at runtime) the first time
  // refresh() sees a non-empty error's known_metrics list from a failed /api/telemetry/analysis call,
  // OR immediately if app.js passes an explicit metric list. Kept minimal: no separate "list metrics"
  // endpoint exists yet, so the explorer bootstraps its options from the first analysis error
  // response (which always includes known_metrics) or from a caller-supplied seed list.
  function setMetrics(metrics) {
    if (!metrics || !metrics.length) return;
    const cur = [...metricSelect.options].map((o) => o.value).join(",");
    if (cur === metrics.join(",")) return;
    knownMetrics = metrics;
    metricSelect.replaceChildren(...metrics.map((m) => tmpl.selectOption(m, m)));
  }

  function setHarnesses(harnesses) {
    if (!harnesses || !harnesses.length) return;
    const cur = knownHarnesses.join(",");
    if (cur === harnesses.join(",")) return;
    knownHarnesses = harnesses;
    for (const select of [aHarnessSelect, bHarnessSelect]) {
      for (const o of [...select.querySelectorAll("option[value]:not([value=''])")]) o.remove();
      select.append(...harnesses.map((h) => tmpl.selectOption(h, h)));
    }
  }

  // Refreshes the marker dropdown from the current window-scoped markers (same list app.js's cohort
  // filter bar uses) — only "change" markers make sense as a marker-relative comparison anchor.
  function refresh({ markers, metrics, harnesses } = {}) {
    if (metrics) setMetrics(metrics);
    if (harnesses) setHarnesses(harnesses);
    if (markers) {
      currentMarkers = markers.filter((m) => m.type === "change" || m.type === "experiment-start");
      const cur = [...markerSelect.querySelectorAll("option[value]:not([value=''])")].map((o) => o.value).join(",");
      const next = currentMarkers.map((m) => m.marker_id).join(",");
      if (cur !== next) {
        markerSelect.replaceChildren(
          el("option", { value: "" }, "select a marker…"),
          ...currentMarkers.map((m) => tmpl.markerOption(m)),
        );
      }
    }
  }

  function setMode(next) {
    mode = next;
    for (const b of modeButtons.querySelectorAll("button[data-explorer-mode]")) {
      b.classList.toggle("active", b.dataset.explorerMode === mode);
    }
    markerControls.style.display = mode === "marker" ? "" : "none";
    cohortControls.style.display = mode === "cohorts" ? "" : "none";
  }

  modeButtons.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-explorer-mode]");
    if (btn) setMode(btn.dataset.explorerMode);
  });

  async function run() {
    const metric = metricSelect.value;
    if (!metric) { resultEl.replaceChildren(el("p", { style: "color:var(--dim)" }, "choose a metric first")); return; }
    resultEl.replaceChildren(el("p", { style: "color:var(--dim)" }, "computing…"));
    try {
      let response;
      if (mode === "marker") {
        const markerId = markerSelect.value;
        if (!markerId) { resultEl.replaceChildren(el("p", { style: "color:var(--dim)" }, "choose a marker first")); return; }
        response = await api.fetchTelemetryAnalysis({ metric, markerId });
      } else {
        const cohortA = aHarnessSelect.value ? { harnesses: [aHarnessSelect.value] } : {};
        const cohortB = bHarnessSelect.value ? { harnesses: [bHarnessSelect.value] } : {};
        response = await api.fetchTelemetryAnalysis({ metric, cohortA, cohortB });
      }
      renderResult(response.finding);
    } catch (err) {
      resultEl.replaceChildren(el("p", { style: "color:var(--spike)" }, "analysis failed: " + ((err && err.message) || err)));
    }
  }

  // Renders whichever shape POST /api/telemetry/analysis returned: the full marker-relative finding
  // contract (observation/evidence/confidence/interpretation/next_action), or the simpler two-cohort
  // value+sample-size comparison (no marker to split around, so no before/after language applies).
  function renderResult(finding) {
    if (!finding) { resultEl.replaceChildren(el("p", { style: "color:var(--dim)" }, "no result")); return; }
    const rows = [];
    if (finding.observation) {
      // Marker-relative shape: same contract renderMarkerComparison() already knows how to show —
      // reuse the same plain-text layout here so the two panels read consistently.
      rows.push(el("p", { class: "hl" }, finding.observation));
      rows.push(el("p", { style: "color:var(--dim)" },
        "confidence: " + finding.confidence
        + " · before: " + finding.sample_size.before + " sessions"
        + " · after: " + finding.sample_size.after + " sessions"));
      if (finding.interpretation) rows.push(el("p", {}, "interpretation (inference): " + finding.interpretation.text));
      if (finding.next_action) rows.push(el("p", { style: "color:var(--accent)" }, "next action: " + finding.next_action));
      if (finding.data_quality_issues?.length) rows.push(el("p", { style: "color:var(--dim)" }, "data quality: " + finding.data_quality_issues.join("; ")));
    } else {
      // Two-cohort shape: metric value + sample size per cohort, correlation-only.
      rows.push(el("p", { class: "hl" }, `${finding.metric}: cohort A = ${fmtValue(finding.cohort_a.value)} (${finding.cohort_a.sessions} sessions), cohort B = ${fmtValue(finding.cohort_b.value)} (${finding.cohort_b.sessions} sessions)`));
      rows.push(el("p", { style: "color:var(--dim)" }, "correlation only — no causal claim"));
    }
    resultEl.replaceChildren(...rows);
  }

  function fmtValue(v) {
    return v == null ? "unknown" : String(Math.round(v * 100) / 100);
  }

  runBtn.addEventListener("click", run);

  // "Open analysis" entry point (plan: each insight/finding's "open analysis" action must reproduce
  // its exact cohort and metric). Called by app.js/renders.js with a finding's analysis_filter_state.
  function openWithFilterState(filterState) {
    detailsEl.open = true;
    detailsEl.scrollIntoView({ behavior: "smooth", block: "start" });
    if (filterState?.metric && knownMetrics.includes(filterState.metric)) metricSelect.value = filterState.metric;
    if (filterState?.marker_id) {
      setMode("marker");
      markerSelect.value = filterState.marker_id;
    }
  }

  return { refresh, openWithFilterState, setMetrics };
}

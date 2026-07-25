// Markup construction for the Telemetry page: template-clone + slot-fill only, no fetches, no
// orchestration. Mirrors portal/plans/templates.js and portal/config/templates.js.

import { portalTpl as tpl, portalFillSlots as fill } from "/portal/shared/api.js";
import { fmt } from "./state.js";

// One-off status/message line (e.g. "computing…", "no result", an error). variant matches a CSS
// class already defined for this page's message styling ("hl", "dim", "spike", "accent"); omit for
// the plain default.
export function msgLine(text, variant) {
  const node = fill(tpl("tpl-msg-line"), { text });
  if (variant) node.classList.add(variant);
  return node;
}

// A ".note" line in the session-detail modal's extra region (spool facts, loading/error states).
export function noteLine(text, variant) {
  const node = fill(tpl("tpl-note"), { text });
  if (variant) node.classList.add(variant);
  return node;
}

// The before/after/change/confidence stat-tile row in the marker-comparison panel (renders.js's
// renderMarkerComparison). ev/sampleSize/confidence come straight off the finding contract.
export function markerComparisonStats({ ev, sampleSize, confidence, deltaSign, deltaLabel, isRegression }) {
  const node = fill(tpl("tpl-marker-comparison-stats"), {
    "before-value": ev.before.value,
    "before-sub": sampleSize.before + " sessions",
    "after-value": ev.after.value,
    "after-sub": sampleSize.after + " sessions",
    "change-value": deltaLabel,
    "confidence-value": confidence,
  });
  const changeValue = node.querySelector("[data-slot=change-value]");
  changeValue.classList.toggle("msg-spike", isRegression);
  return node;
}

// One "N data quality issue(s)" collapsible list.
export function qualityIssues(issues) {
  const node = fill(tpl("tpl-quality-issues"), {
    summary: issues.length + " data quality " + (issues.length === 1 ? "issue" : "issues"),
  });
  const items = node.querySelector("[data-slot=items]");
  items.append(...issues.map((issue) => fill(tpl("tpl-quality-issue-item"), { text: issue })));
  return node;
}

// "open analysis ›" link button; filterState is stashed on the dataset for app.js's delegated
// click handler to read and hand to the Analysis explorer.
export function openAnalysisBtn(filterState) {
  const node = tpl("tpl-open-analysis-btn");
  node.dataset.filterState = JSON.stringify(filterState);
  return node;
}

// One button in the harness filter row (app.js's updateHarnessFilter). harness is "all" or a
// harness name; both the dataset key and label text.
export function harnessBtn(harness, active) {
  const node = tpl("tpl-harness-btn");
  node.dataset.harness = harness;
  node.textContent = harness;
  node.classList.toggle("active", active);
  return node;
}

// One heavy-turn row in the "surface chat context" detail (fetchSessionContext in app.js). Plain
// textContent throughout, so tool names/previews from the transcript need no manual HTML escaping.
export function turnRow(t) {
  const node = tpl("tpl-turn");
  node.querySelector("[data-slot=tool]").textContent = (t.tool || "tool") + (t.is_mcp ? " (mcp)" : "");
  node.querySelector("[data-slot=stats]").textContent = `${fmt(t.approx_tokens)} tok · ${fmt(t.result_chars)} chars`;
  node.querySelector("[data-slot=preview]").textContent = t.preview || "";
  return node;
}

// The generic detail modal's key/value list (portal/telemetry/panels.js's createDetailModal).
// null entries are dropped so callers can include optional fields inline; an empty/nullish value
// renders as "—". Plain textContent, so no manual escaping is needed for labels/values.
export function detailRows(rows) {
  return rows.filter(Boolean).map(([term, value]) => {
    const row = tpl("tpl-dtdd-row");
    row.querySelector("[data-slot=term]").textContent = term;
    row.querySelector("[data-slot=value]").textContent = value == null || value === "" ? "—" : value;
    return row;
  });
}

// Deterministic reason behind each confidence label, surfaced as the badge's hover tooltip so
// "strong signal" vs "emerging pattern" is explained where the user reads it. Mirrors deriveInsights'
// STRONG_SIGNAL_MIN_CALLS threshold (telemetry-insights.mjs): confidence is derived from sample size
// alone (the finding already passed its rule's evidence bar to appear at all), never LLM judgement.
const CONFIDENCE_TOOLTIP = {
  "strong signal":
    "Strong signal: 40+ contributing calls/sessions back this finding — enough sample to act on it directly.",
  "emerging pattern":
    "Emerging pattern: the finding cleared its detection threshold but on fewer than 40 samples — a real lead worth watching, not yet a firm conclusion.",
};

// Each insight carries the actionable finding contract's layers: headline=observation,
// detail=evidence, confidence (badge, inline at the end of the detail line), next_action. There is
// deliberately NO per-row "open analysis" link: the insight findings' analysis_filter_state is only
// `{ kind }`, which the Analysis explorer's openWithFilterState ignores (it prefills only from
// metric/marker_id), so a per-row link would just scroll to the same explorer for every row with no
// per-issue context. A single "open analysis explorer" link lives in the panel footer instead.
// (Marker-comparison findings in renders.js DO carry metric/marker_id and keep their inline link.)
// All structure lives in the #tpl-insight <template>; this only clones it and fills/toggles slots.
// severity/headline/detail still drive the CLI consumers (printInsights, insightsSummary) unchanged.
export function insightRow(f) {
  const row = tpl("tpl-insight");
  row.classList.add(f.severity);
  row.querySelector("[data-slot=headline]").textContent = f.headline;
  row.querySelector("[data-slot=detail]").textContent = f.detail;

  const badge = row.querySelector("[data-slot=confidence]");
  if (f.confidence) {
    const tip = CONFIDENCE_TOOLTIP[f.confidence] || "";
    badge.textContent = f.confidence;
    // data-tip drives the JS-positioned hover tooltip (tooltip.js); aria-label carries the same
    // text for assistive tech. No native `title` — it would stack a second, slower tooltip.
    badge.dataset.tip = tip;
    badge.setAttribute("aria-label", tip);
    badge.classList.add("conf-" + f.confidence.replace(/\s+/g, "-"));
    badge.hidden = false;
  }

  const nextLine = row.querySelector("[data-slot=next-line]");
  const hasNext = Boolean(f.next_action);
  if (hasNext) row.querySelector("[data-slot=next-action]").textContent = f.next_action;
  nextLine.hidden = !hasNext;

  return row;
}

// Static legend line for the per-turn-deltas chart mode. filterLabel is the current
// "showing all"/"showing notable (…)" text on the toggle button.
export function legendDeltas(filterLabel) {
  const node = tpl("tpl-legend-deltas");
  node.querySelector("[data-slot=filter-label]").textContent = filterLabel;
  return node;
}

export function legendCumulativeHead() {
  return tpl("tpl-legend-cumulative-head");
}

export function legendGroupHead() {
  return tpl("tpl-legend-group-head");
}

// One session row in the cumulative-mode legend. label/title/tokenLabel are plain text (title
// attr + textContent), so no manual escaping is needed for session titles/ids from telemetry.
export function legendSessionItem({ color, sessionId, title, label, tokenLabel }) {
  const node = tpl("tpl-legend-session-item");
  node.querySelector("[data-slot=swatch]").style.background = color;
  const chip = node.querySelector("[data-slot=chip]");
  chip.dataset.sid = sessionId;
  chip.title = title;
  chip.querySelector("[data-slot=chip-text]").textContent = label;
  chip.querySelector("[data-slot=token]").textContent = `(${tokenLabel})`;
  return node;
}

// One tool-group row in the bygroup-mode legend.
export function legendGroupItem({ color, group, tokenLabel }) {
  const node = tpl("tpl-legend-group-item");
  node.querySelector("[data-slot=swatch]").style.background = color;
  node.querySelector("[data-slot=label-text]").textContent = group;
  node.querySelector("[data-slot=token]").textContent = `(${tokenLabel})`;
  return node;
}

// Wraps a set of legend <li> items with an optional "view N more" button. items is an array of
// already-built nodes (legendSessionItem/legendGroupItem). moreBtnId matches the id app.js's
// delegated click listener looks for ("viewmore-cumulative"/"viewmore-bygroup") — kept as an id
// (not a callback) so chart.js doesn't need to depend on app.js's click wiring.
export function legendList(items, moreLabel, moreBtnId) {
  const node = tpl("tpl-legend-list");
  node.querySelector("[data-slot=items]").append(...items);
  const moreBtn = node.querySelector("[data-slot=viewmore]");
  if (moreLabel) {
    moreBtn.id = moreBtnId;
    moreBtn.textContent = moreLabel;
    moreBtn.hidden = false;
  }
  return node;
}

// Chart hover tooltip head line (session/group label). color is optional (defaults to the
// tooltip's own CSS), spike marks the "▲ " per-turn-delta spike variant.
export function tooltipHead(label, { color, spike } = {}) {
  const node = tpl("tpl-tooltip-head");
  if (color) node.style.color = color;
  if (spike) node.classList.add("t-spike");
  node.textContent = (spike ? "▲ " : "") + label;
  return node;
}

// One "term value" line in the chart hover tooltip (term already includes any trailing ":" —
// callers vary between "total:" and bare "click" for the session-detail hint row).
export function tooltipRow(term, value) {
  const node = tpl("tpl-tooltip-row");
  node.querySelector("[data-slot=term]").textContent = term;
  node.querySelector("[data-slot=value]").textContent = value;
  return node;
}

// Sessions-table headline cell: session title + "view chat ›" affordance + a dim sub-line
// (repo/branch/harness/id). Plain textContent throughout, so session titles need no escaping.
export function sessionCell(headline, sub) {
  const node = tpl("tpl-session-cell");
  node.querySelector("[data-slot=headline]").textContent = headline;
  node.querySelector("[data-slot=sub]").textContent = sub;
  return node;
}

// Per-table click handlers, keyed by table id. Set when a render passes a details array; read by
// the delegated click listener in app.js so rebuilt tables don't leak stale closures.
export const tableDetails = {};

// --- Phase 6: global cohort filter select options ------------------------------------------------
// Plain <option> elements built directly (no <template>, since <select> children are trivial and a
// template adds no value here) — kept in templates.js anyway so app.js never constructs markup
// itself, matching this file's "template/markup construction only" charter.
export function selectOption(value, label, selected) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  if (selected) opt.selected = true;
  return opt;
}

// One <option> per marker for the marker-comparison select. Markers are timestamped local records,
// not user HTML — textContent keeps this consistent with the rest of the page's escaping discipline.
export function markerOption(marker, selected) {
  const dateLabel = marker.ts ? marker.ts.slice(0, 16).replace("T", " ") : "";
  return selectOption(marker.marker_id, `${dateLabel} · ${marker.title}`, selected);
}

// details (optional) is one handler per row; rows that have one get a clickable affordance and
// open a detail modal on click.
export function table(id, headers, rows, details) {
  // Align each header to match its column's data, not by position: a column is numeric (right-
  // aligned) when its first data cell is a {num} object. Keeps header and content alignment in sync
  // for mixed tables (e.g. a string "time"/"where"/"event" column sitting among numeric ones).
  const numericCol = headers.map((_, i) => rows.length > 0 && rows[0][i] && typeof rows[0][i] === "object" && "num" in rows[0][i]);
  const tableEl = tpl("tpl-datatable");
  const headRow = tableEl.querySelector("[data-slot=headrow]");
  headers.forEach((h, i) => {
    const th = tpl("tpl-datatable-th");
    th.textContent = h;
    if (numericCol[i]) th.className = "num";
    headRow.appendChild(th);
  });
  const body = tableEl.querySelector("[data-slot=body]");
  rows.forEach((cells, ri) => {
    const tr = tpl("tpl-datatable-row");
    if (details && details[ri]) {
      tr.className = "clickable";
      tr.dataset.row = ri;
    }
    // Cell content lands via textContent by default — callers pass raw user/telemetry strings
    // (session titles, tool names, etc.) needing no manual escaping. A Node cell (e.g.
    // sessionCell()) is appended directly for the rare row that needs richer markup than one
    // text value, keeping structure in a <template> instead of a string.
    cells.forEach((cell) => {
      const td = tpl("tpl-datatable-td");
      if (cell instanceof Node) {
        td.appendChild(cell);
      } else if (cell && typeof cell === "object" && "num" in cell) {
        td.className = "num " + (cell.cls || "");
        td.textContent = cell.num;
      } else {
        td.textContent = cell;
      }
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  const container = document.getElementById(id);
  container.innerHTML = "";
  container.appendChild(tableEl);
  tableDetails[id] = details || null;
}

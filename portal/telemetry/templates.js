// Markup construction for the Telemetry page: template-clone + slot-fill only, no fetches, no
// orchestration. Mirrors portal/plans/templates.js and portal/config/templates.js.

import { portalTpl as tpl } from "/portal/shared/api.js";
import { fmt } from "./state.js";

// One button in the harness filter row (app.js's updateHarnessFilter). harness is "all" or a
// harness name; both the dataset key and label text.
export function harnessBtn(harness, active) {
  const node = tpl("tpl-harness-btn");
  node.dataset.harness = harness;
  node.textContent = harness;
  node.classList.toggle("active", active);
  return node;
}

export function statItem(label, value) {
  const node = tpl("tpl-stat");
  node.querySelector("[data-slot=label]").textContent = label;
  node.querySelector("[data-slot=value]").textContent = value;
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

export function insightRow(f) {
  const row = tpl("tpl-insight");
  row.classList.add(f.severity);
  row.querySelector("[data-slot=headline]").textContent = f.headline;
  row.querySelector("[data-slot=detail]").textContent = f.detail;
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

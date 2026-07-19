// Markup construction for the Telemetry page: template-clone + slot-fill only, no fetches, no
// orchestration. Mirrors portal/plans/templates.js and portal/config/templates.js.

import { portalTpl as tpl } from "/portal/shared/api.js";
import { fmt } from "./state.js";

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
    // Cell content lands via textContent by default, not innerHTML — callers pass raw
    // user/telemetry strings (session titles, tool names, etc.) with no consistent escaping
    // today. A cell shaped {html: "..."} opts into raw markup for the rare row that needs it
    // (e.g. the sessions table's headline + sub-line); the caller is responsible for escaping
    // any interpolated values in that string.
    cells.forEach((cell) => {
      const td = tpl("tpl-datatable-td");
      if (cell && typeof cell === "object" && "num" in cell) {
        td.className = "num " + (cell.cls || "");
        td.textContent = cell.num;
      } else if (cell && typeof cell === "object" && "html" in cell) {
        td.innerHTML = cell.html;
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

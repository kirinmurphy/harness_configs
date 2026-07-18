// Pure data/formatting helpers for the Telemetry page: no DOM reads, no fetches, no module-global
// mutable state. Everything here takes its inputs as parameters so it's trivially testable and
// reusable from both chart.js and app.js without either owning the other's state.

export const fmt = (n) => Number(n || 0).toLocaleString("en-US");

export const short = (id) => (id && id !== "unknown" ? String(id).slice(0, 8) : "unknown");

// Escape user-derived text (prompt previews, paths) before it goes into innerHTML. The spool is
// local and self-authored, but prompts can contain </>/& that would otherwise break rendering.
export const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Compact token label: 1.5M / 120k / 850. Keeps the y-axis legible without the full comma form.
export function tokShort(n) {
  n = Number(n || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "k";
  return String(Math.round(n));
}

export function clockLabel(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// Plot margins leave room for the y-axis token labels (left) and x-axis time labels (bottom).
export const M = { left: 56, right: 12, top: 10, bottom: 22 };

// Distinct colors for per-session lines in the cumulative views.
export const SESSION_COLORS = ["#58a6ff", "#3fb950", "#f0883e", "#bc8cff", "#f85149", "#56d4dd", "#e3b341", "#ff7b72"];
// Tool-group colors for the cumulative-by-group view.
export const GROUP_COLORS = { "native-read": "#58a6ff", "mcp-code": "#3fb950", "mcp-docs": "#56d4dd", "mcp-other": "#bc8cff", bash: "#f0883e", edit: "#e3b341", other: "#8b949e" };

// Group for a timeline point. The server now computes group (with bare-MCP-name resolution) and puts
// it on each point, so prefer that; fall back to a local guess only for older payloads.
export function pointGroup(p) {
  if (p.group) return p.group;
  const t = p.tool;
  if (!t) return "other";
  if (t.indexOf("mcp__jcodemunch") === 0) return "mcp-code";
  if (t.indexOf("mcp__jdocmunch") === 0) return "mcp-docs";
  if (t.indexOf("mcp__") === 0) return "mcp-other";
  if (t === "Read" || t === "Grep" || t === "Glob") return "native-read";
  if (t === "Edit" || t === "Write" || t === "NotebookEdit") return "edit";
  if (t === "Bash") return "bash";
  return "other";
}

// Group the windowed timeline into per-session series, sorted by ts. Used by cumulative & lifespan
// views; both read total/ts/session_id already present on each point — no extra server data.
export function perSessionSeries(points) {
  const by = new Map();
  for (const p of points) {
    const id = p.session_id || "unknown";
    if (!by.has(id)) by.set(id, []);
    by.get(id).push(p);
  }
  const series = [...by.entries()].map(([id, pts]) => {
    pts.sort((a, b) => a.ts.localeCompare(b.ts));
    return { id, pts, total: pts[pts.length - 1].total || 0, first: Date.parse(pts[0].ts), last: Date.parse(pts[pts.length - 1].ts) };
  });
  return series.sort((a, b) => b.total - a.total);
}

// Human-readable session duration from first→last capture: "18m", "2h 5m", "<1m".
export function durLabel(first, last) {
  const ms = Date.parse(last) - Date.parse(first);
  if (!(ms > 0)) return "<1m";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return mins + "m";
  return Math.floor(mins / 60) + "h " + (mins % 60) + "m";
}

// Truncate a label for the table cell; the full text lives in the detail modal.
export function clip(str, n) {
  return str && str.length > n ? str.slice(0, n) + "…" : str || "";
}

// Look up a stored session rollup by id (for the cumulative chart chips, which only carry id).
export function sessionById(id, sessions) {
  return sessions.find((s) => s.session_id === id) || null;
}

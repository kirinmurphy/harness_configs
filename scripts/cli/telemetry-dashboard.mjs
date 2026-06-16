// Self-contained dashboard page: zero dependencies, no network, no CDN. Charts render on a single
// <canvas>, and dense series are bucketed to one column per pixel client-side so 10k+ captures draw
// without DOM bloat. The page polls /api/data so a long-running session keeps the view live.
// Kept as one template literal because it is shipped verbatim to the browser, not maintained as JS.

export function dashboardHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>roborepo telemetry</title>
<style>
  :root { color-scheme: dark; --bg:#0e1116; --panel:#161b22; --line:#2d333b; --ink:#c9d1d9; --dim:#8b949e; --accent:#58a6ff; --spike:#f85149; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--bg); color:var(--ink); }
  header { padding:16px 20px; border-bottom:1px solid var(--line); display:flex; gap:16px; align-items:baseline; }
  header h1 { font-size:15px; margin:0; font-weight:600; }
  header .meta { color:var(--dim); font-size:12px; }
  main { padding:20px; display:grid; gap:20px; max-width:1200px; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
  .panel h2 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim); margin:0 0 12px; }
  canvas { width:100%; height:260px; display:block; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th,td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--line); }
  th { color:var(--dim); font-weight:600; }
  td.num { text-align:right; font-variant-numeric:tabular-nums; }
  .spike { color:var(--spike); }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
  @media (max-width:760px){ .grid2{ grid-template-columns:1fr; } }
  .legend { font-size:11px; color:var(--dim); margin-top:8px; }
  .swatch { display:inline-block; width:10px; height:10px; border-radius:2px; vertical-align:middle; margin-right:4px; }
</style>
</head>
<body>
<header>
  <h1>roborepo telemetry</h1>
  <span class="meta" id="meta">loading…</span>
</header>
<main>
  <section class="panel">
    <h2>what's causing spikes</h2>
    <div id="causes"></div>
    <div class="legend">grouped by the pattern that drove each token spike · each row is a behavior you can change</div>
  </section>
  <section class="panel">
    <h2>token deltas over time</h2>
    <canvas id="timeline"></canvas>
    <div class="legend"><span class="swatch" style="background:var(--accent)"></span>per-capture delta tokens <span class="swatch" style="background:var(--spike);margin-left:12px"></span>spike threshold</div>
  </section>
  <div class="grid2">
    <section class="panel"><h2>top sessions</h2><div id="sessions"></div></section>
    <section class="panel"><h2>token spikes</h2><div id="spikes"></div></section>
  </div>
  <div class="grid2">
    <section class="panel"><h2>token by tool</h2><div id="tools"></div></section>
    <section class="panel"><h2>token by MCP server</h2><div id="mcp"></div></section>
  </div>
  <section class="panel"><h2>spike vs normal</h2><div id="comparison"></div></section>
</main>
<script>
const fmt = (n) => Number(n||0).toLocaleString("en-US");
const short = (id) => id && id !== "unknown" ? String(id).slice(0,8) : "unknown";

let lastVersion = null;

// Poll on an interval but only repaint when the spool actually changed (version differs). Pass
// force=true for events like resize where the data is identical but the canvas must be redrawn.
async function load(force) {
  const data = await (await fetch("/api/data")).json();
  if (!force && data.version === lastVersion) return;
  lastVersion = data.version;
  const w = data.usage_windows || {};
  document.getElementById("meta").textContent =
    data.capture_count + " captures · " + data.sessions.length + " sessions · spike ≥ " + fmt(data.spike_threshold) + " tok"
    + " · ~" + fmt(w.five_hour) + " tok last 5h / ~" + fmt(w.seven_day) + " last 7d (local estimate)";
  renderCauses(data.spike_causes);
  drawTimeline(data.timeline, data.spike_threshold);
  renderSessions(data.sessions);
  renderSpikes(data.spikes);
  renderContrib("tools", data.top_tools);
  renderContrib("mcp", data.top_mcp);
  renderComparison(data.comparison);
}

// Bucket the series to one bar per device pixel column so dense histories stay fast and legible.
function drawTimeline(points, threshold) {
  const canvas = document.getElementById("timeline");
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  if (!points.length) { ctx.fillStyle = "#8b949e"; ctx.fillText("no token data yet", 12, 24); return; }
  const cols = Math.max(1, Math.floor(W));
  const perCol = points.length / cols;
  const buckets = new Array(cols).fill(0);
  for (let i = 0; i < points.length; i++) {
    const c = Math.min(cols - 1, Math.floor(i / perCol));
    buckets[c] = Math.max(buckets[c], points[i].delta); // max per column preserves spikes when downsampling
  }
  const max = Math.max(threshold || 0, ...buckets) || 1;
  const scaleY = (v) => H - (v / max) * (H - 16) - 4;
  ctx.fillStyle = "#58a6ff";
  for (let c = 0; c < cols; c++) {
    const h = H - 4 - scaleY(buckets[c]);
    if (h > 0) ctx.fillRect(c, scaleY(buckets[c]), 1, h);
  }
  if (threshold > 0) {
    ctx.strokeStyle = "#f85149"; ctx.setLineDash([4, 3]); ctx.beginPath();
    ctx.moveTo(0, scaleY(threshold)); ctx.lineTo(W, scaleY(threshold)); ctx.stroke(); ctx.setLineDash([]);
  }
}

// The headline panel: each spike cause as a row, biggest token cost first, with the fix to apply.
function renderCauses(rows) {
  if (!rows || !rows.length) { document.getElementById("causes").innerHTML = "<p style='color:#8b949e'>no spikes yet — nothing blowing up your tokens</p>"; return; }
  table("causes", ["cause", "spikes", "avg Δ", "worst Δ", "where", "what to change"], rows.slice(0, 8).map((c) => [
    c.cause,
    { num: c.spikes },
    { num: fmt(c.avg_delta) },
    { num: "+" + fmt(c.worst_delta), cls: "spike" },
    c.worst_repo || "unknown",
    c.hint || "",
  ]));
}
function renderSessions(rows) {
  table("sessions", ["session", "tokens", "tools", "mcp"], rows.slice(0, 12).map((s) => [
    s.repo + "/" + short(s.session_id), { num: fmt(s.total_tokens) }, { num: s.tool_calls }, { num: s.mcp_calls },
  ]));
}
function renderSpikes(rows) {
  if (!rows.length) { document.getElementById("spikes").innerHTML = "<p style='color:#8b949e'>no spikes</p>"; return; }
  table("spikes", ["time", "where", "Δ tokens", "event"], rows.slice(0, 12).map((s) => [
    s.ts.slice(0, 19), short(s.session_id), { num: "+" + fmt(s.delta_tokens), cls: "spike" }, s.tool ? s.event + " (" + s.tool + ")" : s.event,
  ]));
}
function renderContrib(id, rows) {
  table(id, ["key", "tokens", "captures"], rows.slice(0, 12).map((r) => [
    r.key, { num: fmt(r.tokens) }, { num: r.captures },
  ]));
}
function renderComparison(c) {
  table("comparison", ["cohort", "n", "avg Δ", "avg tools", "mcp rate"], [
    ["spike", { num: c.spike.count }, { num: fmt(c.spike.avg_delta) }, { num: c.spike.avg_tool_calls }, { num: c.spike.mcp_rate }],
    ["normal", { num: c.normal.count }, { num: fmt(c.normal.avg_delta) }, { num: c.normal.avg_tool_calls }, { num: c.normal.mcp_rate }],
  ]);
}

function table(id, headers, rows) {
  const head = "<tr>" + headers.map((h, i) => "<th" + (i ? " class='num'" : "") + ">" + h + "</th>").join("") + "</tr>";
  const body = rows.map((cells) => "<tr>" + cells.map((cell) => {
    if (cell && typeof cell === "object") return "<td class='num " + (cell.cls || "") + "'>" + cell.num + "</td>";
    return "<td>" + cell + "</td>";
  }).join("") + "</tr>").join("");
  document.getElementById(id).innerHTML = "<table>" + head + body + "</table>";
}

load(true);
setInterval(() => load(false), 5000);
window.addEventListener("resize", () => load(true));
</script>
</body>
</html>`;
}

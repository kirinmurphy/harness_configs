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
  .sectionhead { font-size:11px; text-transform:uppercase; letter-spacing:.1em; color:var(--accent); margin:18px 0 0; font-weight:700; padding-top:14px; border-top:1px solid var(--line); }
  .sectionhead:first-of-type { border-top:none; padding-top:0; margin-top:0; }
  .sectionhead .sub { color:var(--dim); text-transform:none; letter-spacing:0; font-weight:400; margin-left:8px; }
  .go { color:var(--accent); font-size:10px; opacity:0; transition:opacity .1s; }
  tr.clickable:hover .go { opacity:1; }
  .linkbtn { background:none; border:none; color:var(--accent); font:inherit; font-size:11px; cursor:pointer; padding:0; text-decoration:underline dotted; }
  .linkbtn:hover { color:var(--ink); }
  .sesschip { display:inline-flex; align-items:center; margin:2px 6px 2px 0; text-decoration:none; border:1px solid var(--line); border-radius:5px; padding:2px 8px; }
  .sesschip:hover { border-color:var(--accent); }
  #insightspanel { border-color:var(--accent); }
  .insight { display:flex; gap:10px; padding:7px 0; border-top:1px solid var(--line); }
  .insight:first-child { border-top:none; }
  .insight .dot { flex:none; width:8px; height:8px; border-radius:50%; margin-top:5px; }
  .insight.high .dot { background:var(--spike); }
  .insight.warn .dot { background:var(--accent); }
  .insight.info .dot { background:var(--dim); }
  .insight .body .hl { color:var(--ink); }
  .insight .body .dt { color:var(--dim); font-size:11px; margin-top:2px; }
  #deepreadout { white-space:pre-wrap; font-size:12px; color:var(--ink); }
  .chartwrap { position:relative; }
  canvas { width:100%; height:280px; display:block; cursor:crosshair; }
  .tooltip { position:absolute; pointer-events:none; z-index:5; background:#0b0e13; border:1px solid var(--line); border-radius:6px; padding:8px 10px; font-size:11px; line-height:1.5; color:var(--ink); box-shadow:0 4px 16px rgba(0,0,0,.5); display:none; max-width:280px; }
  .tooltip .t-head { color:var(--accent); font-weight:600; margin-bottom:4px; }
  .tooltip .t-spike { color:var(--spike); }
  .tooltip .t-row span { color:var(--dim); }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th,td { text-align:left; padding:4px 8px; border-bottom:1px solid var(--line); }
  th { color:var(--dim); font-weight:600; }
  td.num, th.num { text-align:right; }
  td.num { font-variant-numeric:tabular-nums; }
  .spike { color:var(--spike); }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
  @media (max-width:760px){ .grid2{ grid-template-columns:1fr; } }
  .legend { font-size:11px; color:var(--dim); margin-top:8px; }
  .swatch { display:inline-block; width:10px; height:10px; border-radius:2px; vertical-align:middle; margin-right:4px; }
  .filterbar { position:sticky; top:0; z-index:10; background:var(--bg); border-bottom:1px solid var(--line); padding:10px 20px; }
  .flabel { color:var(--dim); font-size:11px; text-transform:uppercase; letter-spacing:.06em; margin-right:4px; }
  .ranges { display:flex; gap:6px; flex-wrap:wrap; align-items:center; max-width:1200px; }
  .ranges button { background:var(--bg); color:var(--dim); border:1px solid var(--line); border-radius:5px; padding:3px 10px; font:inherit; font-size:11px; cursor:pointer; }
  .ranges button:hover { color:var(--ink); border-color:var(--accent); }
  .ranges button.active { color:var(--bg); background:var(--accent); border-color:var(--accent); font-weight:600; }
  .ranges .pan { color:var(--dim); font-size:11px; margin-left:auto; }
  canvas.panning { cursor:grabbing; }
  tr.clickable { cursor:pointer; }
  tr.clickable:hover td { background:#1c2230; }
  .modal-back { position:fixed; inset:0; background:rgba(0,0,0,.6); display:none; align-items:center; justify-content:center; z-index:50; }
  .modal-back.open { display:flex; }
  .modal { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:20px 22px; max-width:560px; width:90%; max-height:80vh; overflow:auto; box-shadow:0 12px 48px rgba(0,0,0,.6); }
  .modal h3 { margin:0 0 4px; font-size:14px; }
  .modal .sub { color:var(--dim); font-size:12px; margin-bottom:14px; }
  .modal dl { display:grid; grid-template-columns:auto 1fr; gap:6px 16px; margin:0; font-size:12px; }
  .modal dt { color:var(--dim); }
  .modal dd { margin:0; font-variant-numeric:tabular-nums; word-break:break-word; }
  .modal .closebtn { float:right; background:none; border:none; color:var(--dim); font-size:18px; cursor:pointer; line-height:1; }
  .modal .closebtn:hover { color:var(--ink); }
  .modalactions { display:flex; gap:8px; margin-top:16px; flex-wrap:wrap; }
  .modalactions button { background:var(--bg); color:var(--accent); border:1px solid var(--accent); border-radius:6px; padding:6px 12px; font:inherit; font-size:12px; cursor:pointer; }
  .modalactions button:hover { background:var(--accent); color:var(--bg); }
  .modalextra { margin-top:14px; }
  .modalextra .turn { border-top:1px solid var(--line); padding:8px 0; font-size:11px; }
  .modalextra .turn .th { display:flex; justify-content:space-between; color:var(--dim); }
  .modalextra .turn .tool { color:var(--accent); }
  .modalextra .turn .prev { color:var(--ink); margin-top:3px; white-space:pre-wrap; word-break:break-word; opacity:.85; }
  .modalextra .note { color:var(--dim); font-size:12px; }
</style>
</head>
<body>
<header>
  <h1>roborepo telemetry</h1>
  <span class="meta" id="meta">loading…</span>
</header>
<div class="filterbar">
  <div class="ranges" id="ranges">
    <span class="flabel">time range</span>
    <button data-range="3600000">1h</button>
    <button data-range="21600000">6h</button>
    <button data-range="86400000">1d</button>
    <button data-range="604800000">1w</button>
    <button data-range="all" class="active">all</button>
    <span class="pan" id="panhint"></span>
  </div>
</div>
<main>
  <section class="panel" id="insightspanel">
    <h2>what this means</h2>
    <div id="insights"></div>
    <div class="modalactions">
      <button class="linkbtn" id="deepread">deeper read (claude) ›</button>
    </div>
    <div class="modalextra" id="deepreadout"></div>
  </section>
  <h2 class="sectionhead">overview <span class="sub">when tokens were spent, and the patterns driving spikes</span></h2>
  <section class="panel">
    <h2>token usage over time</h2>
    <div class="ranges" id="chartmodes">
      <span class="flabel">view</span>
      <button data-mode="deltas" class="active">per-turn deltas</button>
      <button data-mode="cumulative">cumulative per session</button>
      <button data-mode="bygroup">cumulative by tool group</button>
    </div>
    <div class="chartwrap">
      <canvas id="timeline"></canvas>
      <div class="tooltip" id="tooltip"></div>
    </div>
    <div class="legend" id="chartlegend"></div>
  </section>
  <section class="panel">
    <h2>what's causing spikes</h2>
    <div id="causes"></div>
    <div class="legend">grouped by the pattern that drove each token spike · each row is a behavior you can change</div>
  </section>

  <h2 class="sectionhead">sessions &amp; chats <span class="sub">click any row to open the chat context — surface the heavy turns or copy an analysis prompt</span></h2>
  <section class="panel"><h2>top sessions</h2><div id="sessions"></div></section>
  <section class="panel"><h2>token spikes</h2><div id="spikes"></div></section>
  <section class="panel" id="loopspanel" style="display:none">
    <h2>⚠ loops detected</h2>
    <div id="loops"></div>
    <div class="legend">a tool fired many times consecutively in one session — likely a runaway agent/skill loop · click to investigate</div>
  </section>

  <h2 class="sectionhead">cost analysis <span class="sub">what each tool/package puts into context, and what changed over time</span></h2>
  <section class="panel">
    <h2>native vs MCP exploration</h2>
    <div id="groupcost"></div>
    <div class="legend">avg context tokens dropped per call, by tool group · the head-to-head for "is the MCP cheaper than the Read/Grep it replaces" · approx (result size ÷ 4)</div>
  </section>
  <section class="panel">
    <h2>cost per tool call</h2>
    <div id="toolcost"></div>
    <div class="legend">what an average call of each tool puts into your context · click a row for detail</div>
  </section>
  <section class="panel">
    <h2>what's different in spikes</h2>
    <div id="anatomy"></div>
    <div class="legend">lift = how much more a group drives spikes than its everyday share · &gt;1 means spike-heavy</div>
  </section>
  <section class="panel">
    <h2>package cost &amp; regression</h2>
    <div id="packagecost"></div>
    <div id="regression"></div>
    <div class="legend">per package: avg tokens/call · regression compares the earlier vs later half (↑ = got more expensive)</div>
  </section>

  <h2 class="sectionhead">raw breakdowns <span class="sub">supporting totals</span></h2>
  <section class="panel"><h2>token by tool</h2><div id="tools"></div></section>
  <section class="panel"><h2>token by MCP server</h2><div id="mcp"></div></section>
  <section class="panel"><h2>spike vs normal</h2><div id="comparison"></div></section>
</main>
<div class="modal-back" id="modalback">
  <div class="modal" id="modal">
    <button class="closebtn" id="modalclose">×</button>
    <h3 id="modaltitle"></h3>
    <div class="sub" id="modalsub"></div>
    <dl id="modalbody"></dl>
    <div class="modalactions" id="modalactions"></div>
    <div class="modalextra" id="modalextra"></div>
  </div>
</div>
<script>
const fmt = (n) => Number(n||0).toLocaleString("en-US");
const short = (id) => id && id !== "unknown" ? String(id).slice(0,8) : "unknown";
// Escape user-derived text (prompt previews, paths) before it goes into innerHTML. The spool is
// local and self-authored, but prompts can contain </>/& that would otherwise break rendering.
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let lastVersion = null;
// Timeline + threshold from the most recent (already window-scoped) server response, kept so a
// resize or pan can redraw the chart without refetching.
let allTimeline = [];
let curThreshold = 0;
// Most recent session rollups, kept so the cumulative chart's session chips can open full detail.
let allSessions = [];
// Global time filter, applied SERVER-SIDE so every panel reflects it. rangeMs = trailing span
// (null = all data). panEnd = epoch ms at the window's right edge (null = follow latest so live
// captures keep arriving). Dragging the chart sets panEnd.
let view = { rangeMs: null, panEnd: null };

function updatePanHint() {
  const hint = document.getElementById("panhint");
  if (view.rangeMs == null || !allTimeline.length) { hint.textContent = ""; return; }
  hint.textContent = clockLabel(allTimeline[0].ts) + " → " + clockLabel(allTimeline[allTimeline.length - 1].ts)
    + (view.panEnd == null ? " · live" : " · drag to move");
}

function redrawChart() {
  drawTimeline(allTimeline, curThreshold);
  updatePanHint();
}

// Fetch the report scoped to the current global filter and repaint EVERY panel. Pass force=true to
// repaint even when the server's version is unchanged (range/pan/resize). The version embeds the
// windowed event set, so a normal 5s poll only repaints when that window's data actually changed.
async function load(force) {
  const qs = view.rangeMs == null ? "" : "?range=" + view.rangeMs + (view.panEnd == null ? "" : "&end=" + view.panEnd);
  const data = await (await fetch("/api/data" + qs)).json();
  if (!force && data.version === lastVersion) return;
  lastVersion = data.version;
  const w = data.usage_windows || {};
  const scope = view.rangeMs == null ? "" : " · filtered";
  document.getElementById("meta").textContent =
    data.capture_count + " captures · " + data.sessions.length + " sessions · spike ≥ " + fmt(data.spike_threshold) + " tok"
    + " · ~" + fmt(w.five_hour) + " tok last 5h / ~" + fmt(w.seven_day) + " last 7d (local estimate)" + scope;
  renderCauses(data.spike_causes);
  document.body.dataset.threshold = data.spike_threshold || 0;
  allTimeline = data.timeline || [];
  curThreshold = data.spike_threshold || 0;
  redrawChart();
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

// Plot margins leave room for the y-axis token labels (left) and x-axis time labels (bottom).
const M = { left: 56, right: 12, top: 10, bottom: 22 };
// Drawn bar geometry, kept so the mousemove handler can map a cursor x back to the capture it
// represents. Rebuilt on every draw.
let chartBars = [];

// Compact token label: 1.5M / 120k / 850. Keeps the y-axis legible without the full comma form.
function tokShort(n) {
  n = Number(n || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "k";
  return String(Math.round(n));
}
function clockLabel(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

// Current chart view + the index of the hovered bar (for highlight). Set by the mode toggle / hover.
let chartMode = "deltas";
let hoverIdx = -1;
// Per-turn deltas: hide trivially-cheap markers below the median delta unless "show all" is on, so
// the chart highlights the notable turns instead of noise. Toggled by the delta filter button.
let showAllDeltas = false;
// Cumulative concern line: a chat whose cumulative tokens cross this is "getting heavy" — drawn as
// the same dashed red limit as the spike threshold. Tunable.
const CUMULATIVE_CONCERN = 5_000_000;
// Distinct colors for per-session lines in the cumulative views.
const SESSION_COLORS = ["#58a6ff", "#3fb950", "#f0883e", "#bc8cff", "#f85149", "#56d4dd", "#e3b341", "#ff7b72"];
// Tool-group colors for the cumulative-by-group view.
const GROUP_COLORS = { "native-read": "#58a6ff", "mcp-code": "#3fb950", "mcp-docs": "#56d4dd", "mcp-other": "#bc8cff", bash: "#f0883e", edit: "#e3b341", other: "#8b949e" };
// Group for a timeline point. The server now computes group (with bare-MCP-name resolution) and puts
// it on each point, so prefer that; fall back to a local guess only for older payloads.
function pointGroup(p) {
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
function perSessionSeries(points) {
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

// Set up the canvas + return drawing context and plot geometry shared by all three views.
function chartSetup() {
  const canvas = document.getElementById("timeline");
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  ctx.font = "10px ui-monospace,Menlo,monospace";
  ctx.textBaseline = "alphabetic";
  return { canvas, ctx, W, H, plotW: W - M.left - M.right, plotH: H - M.top - M.bottom };
}

// Draw y-axis token gridlines + x-axis time labels for a given value-max and time-span.
function drawAxes(ctx, geo, maxV, t0, span) {
  const { W, H, plotW, plotH } = geo;
  const yOf = (v) => M.top + plotH - (v / maxV) * plotH;
  ctx.strokeStyle = "#2d333b"; ctx.fillStyle = "#8b949e"; ctx.textAlign = "right";
  for (const frac of [0, 0.5, 1]) {
    const y = yOf(maxV * frac);
    ctx.beginPath(); ctx.moveTo(M.left, y); ctx.lineTo(W - M.right, y); ctx.stroke();
    ctx.fillText(tokShort(maxV * frac), M.left - 6, y + 3);
  }
  ctx.textAlign = "center";
  for (const frac of [0, 0.5, 1]) ctx.fillText(clockLabel(t0 + span * frac), M.left + frac * plotW, H - 6);
  return yOf;
}

// Dispatch to the active view. points is the already-windowed timeline series.
function drawTimeline(points, threshold) {
  chartBars = [];
  const legend = document.getElementById("chartlegend");
  const geo = chartSetup();
  if (!points.length) { geo.ctx.fillStyle = "#8b949e"; geo.ctx.fillText("no token data yet", M.left, geo.H / 2); legend.innerHTML = ""; return; }
  if (chartMode === "cumulative") return drawCumulative(points, geo, legend);
  if (chartMode === "bygroup") return drawCumulativeByGroup(points, geo, legend);
  return drawDeltas(points, threshold, geo, legend);
}

// Per-turn delta bars. Bars widen automatically when there are few points (low time ranges) for
// easier hover targets; dense histories fall back to per-pixel bucketing that preserves spikes.
// By default trivially-cheap turns (below the median delta) are hidden so only notable turns show
// and are interactive; "show all" reveals everything.
function drawDeltas(points, threshold, geo, legend) {
  const { ctx, W, plotW, plotH } = geo;
  const t0 = Date.parse(points[0].ts), tN = Date.parse(points[points.length - 1].ts);
  const span = Math.max(1, tN - t0);
  // Baseline = median positive delta; below it is "noise" we hide unless show-all.
  const positives = points.map((p) => p.delta).filter((d) => d > 0).sort((a, b) => a - b);
  const baseline = positives.length ? positives[Math.floor(positives.length / 2)] : 0;
  const shown = showAllDeltas ? points : points.filter((p) => p.delta >= baseline);
  const cols = Math.max(1, Math.floor(plotW));
  const buckets = new Array(cols).fill(null);
  for (const p of shown) {
    const c = Math.min(cols - 1, Math.floor(((Date.parse(p.ts) - t0) / span) * (cols - 1)));
    if (!buckets[c] || p.delta > buckets[c].delta) buckets[c] = p;
  }
  const drawn = buckets.map((p, c) => (p ? { p, c } : null)).filter(Boolean);
  // Bar width: wide when sparse (≤ a column per several pixels), down to 1px when dense.
  const barW = Math.max(1, Math.min(24, Math.floor(plotW / Math.max(1, drawn.length)) - 1));
  const max = Math.max(threshold || 0, ...points.map((p) => p.delta)) || 1;
  const yOf = drawAxes(ctx, geo, max, t0, span);

  drawn.forEach((d, i) => {
    const x = M.left + d.c, y = yOf(d.p.delta), h = M.top + plotH - y;
    const w = barW;
    const hovered = i === hoverIdx;
    ctx.fillStyle = hovered ? "#a9d1ff" : "#58a6ff";
    if (h > 0) ctx.fillRect(x, y, w, h);
    if (hovered) {
      ctx.strokeStyle = "#c9d1d9"; ctx.lineWidth = 1; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
      ctx.strokeStyle = "rgba(201,209,217,.25)"; ctx.beginPath(); ctx.moveTo(x + w / 2, M.top); ctx.lineTo(x + w / 2, M.top + plotH); ctx.stroke();
    }
    chartBars.push({ x: x + w / 2, y, h, w, idx: i, point: d.p });
  });
  if (threshold > 0) {
    const y = yOf(threshold);
    ctx.strokeStyle = "#f85149"; ctx.setLineDash([4, 3]); ctx.beginPath();
    ctx.moveTo(M.left, y); ctx.lineTo(W - M.right, y); ctx.stroke(); ctx.setLineDash([]);
  }
  const hidden = points.length - shown.length;
  legend.innerHTML = "<span class='swatch' style='background:var(--accent)'></span>per-turn delta tokens · <span class='swatch' style='background:var(--spike)'></span>spike threshold · click a bar for chat detail · drag to pan"
    + " · <button class='linkbtn' id='deltafilter'>" + (showAllDeltas ? "showing all" : "showing notable (≥ " + tokShort(baseline) + " tok)" + (hidden > 0 ? " — " + hidden + " hidden" : "")) + " · toggle</button>";
}

// Cumulative session total over time: one line per session showing context size climbing within the
// chat. A dashed red concern line marks where a chat is getting heavy. Session chips in the legend
// are clickable to open that session's detail (chat context).
function drawCumulative(points, geo, legend) {
  const { ctx, W, plotW } = geo;
  const series = perSessionSeries(points);
  const t0 = Math.min(...series.map((s) => s.first)), tN = Math.max(...series.map((s) => s.last));
  const span = Math.max(1, tN - t0);
  const max = Math.max(CUMULATIVE_CONCERN, ...points.map((p) => p.total || 0));
  const yOf = drawAxes(ctx, geo, max, t0, span);
  const xOf = (ts) => M.left + ((Date.parse(ts) - t0) / span) * plotW;
  series.slice(0, SESSION_COLORS.length).forEach((s, i) => {
    ctx.strokeStyle = SESSION_COLORS[i]; ctx.lineWidth = 1.5; ctx.beginPath();
    s.pts.forEach((p, j) => { const x = xOf(p.ts), y = yOf(p.total || 0); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  });
  // Concern line.
  const cy = yOf(CUMULATIVE_CONCERN);
  ctx.strokeStyle = "#f85149"; ctx.setLineDash([4, 3]); ctx.beginPath();
  ctx.moveTo(M.left, cy); ctx.lineTo(W - M.right, cy); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = "#f85149"; ctx.textAlign = "left"; ctx.fillText("concern " + tokShort(CUMULATIVE_CONCERN), M.left + 4, cy - 4);
  legend.innerHTML = "cumulative session tokens (context size) over time · <span class='swatch' style='background:var(--spike)'></span>concern limit · click a session to inspect its chat:<br>"
    + series.slice(0, SESSION_COLORS.length).map((s, i) => {
      const sess = sessionById(s.id);
      const label = sess && sess.title ? clip(sess.title, 32) : short(s.id);
      return "<button class='linkbtn sesschip' data-sid='" + esc(s.id) + "'><span class='swatch' style='background:" + SESSION_COLORS[i] + "'></span>" + esc(label) + " (" + tokShort(s.total) + ")</button>";
    }).join(" ");
}

// Cumulative tokens BY TOOL GROUP within the window: a running total line per functional group
// (native-read vs mcp-code vs bash …), using result-size approx tokens. Shows WHAT is driving the
// context climb — the subset breakdown of the cumulative chat curve.
function drawCumulativeByGroup(points, geo, legend) {
  const { ctx, plotW } = geo;
  const withResult = points.filter((p) => p.result_chars != null && p.tool).sort((a, b) => a.ts.localeCompare(b.ts));
  if (!withResult.length) { ctx.fillStyle = "#8b949e"; ctx.fillText("no tool-result data in this window", M.left, geo.H / 2); legend.innerHTML = ""; return; }
  const t0 = Date.parse(withResult[0].ts), tN = Date.parse(withResult[withResult.length - 1].ts);
  const span = Math.max(1, tN - t0);
  // Build a cumulative running total per group over time.
  const groups = {};
  const running = {};
  for (const p of withResult) {
    const g = pointGroup(p);
    running[g] = (running[g] || 0) + Math.round((p.result_chars || 0) / 4);
    if (!groups[g]) groups[g] = [];
    groups[g].push({ ts: p.ts, total: running[g] });
  }
  const max = Math.max(1, ...Object.values(running));
  const yOf = drawAxes(ctx, geo, max, t0, span);
  const xOf = (ts) => M.left + ((Date.parse(ts) - t0) / span) * plotW;
  const order = Object.keys(groups).sort((a, b) => (running[b] || 0) - (running[a] || 0));
  for (const g of order) {
    ctx.strokeStyle = GROUP_COLORS[g] || "#8b949e"; ctx.lineWidth = 1.5; ctx.beginPath();
    groups[g].forEach((pt, j) => { const x = xOf(pt.ts), y = yOf(pt.total); j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }
  legend.innerHTML = "cumulative tokens by tool group (approx, result size) · what drives the context climb:<br>"
    + order.map((g) => "<span class='swatch' style='background:" + (GROUP_COLORS[g] || "#8b949e") + "'></span>" + esc(g) + " (" + tokShort(running[g]) + ")").join(" · ");
}

// Nearest drawn bar to a client-x, or null if none within the hit tolerance.
function barAt(clientX) {
  if (!chartBars.length) return null;
  const rect = document.getElementById("timeline").getBoundingClientRect();
  const x = clientX - rect.left;
  let best = null, bestDx = Infinity;
  for (const b of chartBars) {
    const dx = Math.abs(b.x - x);
    if (dx < bestDx) { bestDx = dx; best = b; }
  }
  // Hit tolerance scales with bar width (wider bars at low ranges) but stays generous for thin ones.
  const tol = best ? Math.max(6, (best.w || 1) / 2 + 2) : 6;
  return best && bestDx <= tol ? best : null;
}

// Map cursor to the nearest drawn bar: show a context tooltip AND highlight that bar. Nearest-by-x
// so thin bars are still easy to hit. Hidden when the pointer is past the last bar or there is no data.
function onTimelineHover(e) {
  const tip = document.getElementById("tooltip");
  if (panState.dragging || chartMode !== "deltas") { tip.style.display = "none"; return; }
  const canvas = document.getElementById("timeline");
  const rect = canvas.getBoundingClientRect();
  const best = barAt(e.clientX);
  // Repaint only when the highlighted bar changes, so hover stays cheap.
  const newIdx = best ? best.idx : -1;
  if (newIdx !== hoverIdx) { hoverIdx = newIdx; redrawChart(); }
  if (!best) { tip.style.display = "none"; return; }
  const p = best.point;
  const spike = best.point.delta && document.body.dataset.threshold && p.delta >= Number(document.body.dataset.threshold);
  const tool = p.mcp_tool ? p.tool + " (" + p.mcp_tool + ")" : p.tool || p.event || "—";
  const rows = [
    ["when", clockLabel(p.ts) + " · " + p.ts.slice(0, 10)],
    ["event", p.event || "—"],
    ["tool", tool],
    p.file_ext ? ["file", "." + p.file_ext] : null,
    p.result_chars != null ? ["result", fmt(p.result_chars) + " chars"] : null,
    p.duration_ms != null ? ["took", p.duration_ms + " ms"] : null,
    ["cause", p.cause || "—"],
    ["repo", p.repo + (p.session_id ? " / " + short(p.session_id) : "")],
  ].filter(Boolean);
  tip.innerHTML =
    "<div class='t-head" + (spike ? " t-spike" : "") + "'>" + (spike ? "▲ " : "") + "+" + fmt(p.delta) + " tok</div>" +
    rows.map((r) => "<div class='t-row'><span>" + r[0] + ":</span> " + r[1] + "</div>").join("");
  tip.style.display = "block";
  // Position near the cursor, flipping left when close to the right edge so it stays on-screen.
  const tipW = tip.offsetWidth;
  const left = best.x + tipW + 14 > rect.width ? best.x - tipW - 8 : best.x + 8;
  tip.style.left = Math.max(0, left) + "px";
  tip.style.top = Math.max(0, Math.min(best.y, rect.height - tip.offsetHeight - 4)) + "px";
}

// --- detail modal -------------------------------------------------------------------------------
// Generic key/value popup. rows is an array of [label, value]; null entries are dropped so callers
// can include optional fields inline. opts.actions = [{label, onClick}] renders buttons; the extra
// region is cleared unless a caller fills it (e.g. fetched transcript turns).
function openModal(title, sub, rows, opts) {
  document.getElementById("modaltitle").textContent = title;
  document.getElementById("modalsub").textContent = sub || "";
  document.getElementById("modalbody").innerHTML = rows
    .filter(Boolean)
    .map((r) => "<dt>" + esc(r[0]) + "</dt><dd>" + (r[1] == null || r[1] === "" ? "—" : esc(r[1])) + "</dd>")
    .join("");
  const actionsEl = document.getElementById("modalactions");
  const extraEl = document.getElementById("modalextra");
  actionsEl.innerHTML = "";
  extraEl.innerHTML = "";
  for (const a of (opts && opts.actions) || []) {
    const btn = document.createElement("button");
    btn.textContent = a.label;
    btn.addEventListener("click", a.onClick);
    actionsEl.appendChild(btn);
  }
  document.getElementById("modalback").classList.add("open");
}
function closeModal() { document.getElementById("modalback").classList.remove("open"); }

// Fetch a flagged event's chat context (transcript turns + paste-ready prompt) and render it into the
// modal's extra region. Best-effort: a missing transcript shows a note, never an error.
async function fetchSession(id, harness, finding, repo) {
  const extra = document.getElementById("modalextra");
  extra.innerHTML = "<div class='note'>loading chat context…</div>";
  try {
    const qs = "id=" + encodeURIComponent(id) + "&harness=" + encodeURIComponent(harness || "claude")
      + "&finding=" + encodeURIComponent(finding || "") + "&repo=" + encodeURIComponent(repo || "");
    const data = await (await fetch("/api/session?" + qs)).json();
    if (!data.found) {
      extra.innerHTML = "<div class='note'>transcript not found on disk (rotated or different machine). Use the analysis prompt above.</div>";
      return;
    }
    const turns = (data.heavy_turns || []).map((t) =>
      "<div class='turn'><div class='th'><span class='tool'>" + esc(t.tool || "tool")
      + (t.is_mcp ? " (mcp)" : "") + "</span><span>" + fmt(t.approx_tokens) + " tok · " + fmt(t.result_chars) + " chars</span></div>"
      + "<div class='prev'>" + esc(t.preview || "") + "</div></div>"
    ).join("");
    extra.innerHTML = "<div class='note'>heaviest turns in this chat (result size = context cost):</div>" + turns;
  } catch (err) {
    extra.innerHTML = "<div class='note'>could not load transcript: " + esc(String(err && err.message || err)) + "</div>";
  }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked; no-op */ }
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
      { label: "surface chat context", onClick: () => fetchSession(sessionId, harness, finding, repo) },
      { label: "copy analysis prompt", onClick: async () => {
        // Pull the server-built prompt (it includes the located transcript path), fall back to a
        // basic one if the transcript is gone.
        const qs = "id=" + encodeURIComponent(sessionId) + "&harness=" + encodeURIComponent(harness || "claude")
          + "&finding=" + encodeURIComponent(finding || "") + "&repo=" + encodeURIComponent(repo || "");
        const data = await (await fetch("/api/session?" + qs)).json();
        await copyText(data.analysis_prompt || "");
        const note = document.getElementById("modalextra");
        note.innerHTML = "<div class='note'>analysis prompt copied to clipboard ✓</div>";
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

// --- pan (drag the chart to view earlier/later) -------------------------------------------------
// Dragging only makes sense when a finite range is selected (otherwise the whole series is shown).
// Translating cursor pixels → time keeps the drag proportional to the visible span. distMoved
// distinguishes a click (open detail) from a drag (pan) on mouseup.
const panState = { dragging: false, startX: 0, startEnd: 0, distMoved: 0, pressedOnCanvas: false };

// Throttle the refetch during a drag so panning stays responsive without flooding the server.
let panLoadTimer = null;
function panLoad() {
  if (panLoadTimer) return;
  panLoadTimer = setTimeout(() => { panLoadTimer = null; load(true); }, 120);
}

function onTimelineDown(e) {
  // Fires only for presses that begin on the canvas. Flag it so a window-level mouseup can tell a
  // chart click from an unrelated click elsewhere (e.g. a range button) that also bubbles up.
  panState.pressedOnCanvas = true;
  panState.startX = e.clientX;
  panState.distMoved = 0;
  if (view.rangeMs == null) return; // pannable only with a finite range; click-to-detail still works
  // Live edge reference: now if following latest, else the pinned edge. Far-past is clamped by the
  // server (filterByWindow), so the client only needs the near (live) clamp.
  panState.startEnd = view.panEnd == null ? Date.now() : view.panEnd;
  panState.dragging = true;
  document.getElementById("timeline").classList.add("panning");
}
function onTimelineMove(e) {
  if (!panState.dragging) return;
  panState.distMoved = Math.max(panState.distMoved, Math.abs(e.clientX - panState.startX));
  const plotW = document.getElementById("timeline").clientWidth - M.left - M.right;
  // Drag right → move window earlier (show older data), like dragging a filmstrip.
  const dt = ((e.clientX - panState.startX) / Math.max(1, plotW)) * view.rangeMs;
  let end = panState.startEnd - dt;
  // At/after the live edge, snap back to follow-latest; otherwise pin the explicit edge and refetch
  // the window (server scopes every panel to it).
  view.panEnd = end >= Date.now() ? null : end;
  panLoad();
}
function onTimelineUp(e) {
  const pressedOnCanvas = panState.pressedOnCanvas;
  panState.dragging = false;
  panState.pressedOnCanvas = false;
  document.getElementById("timeline").classList.remove("panning");
  // Open detail only when ALL of: the press started on the canvas, it ended on the canvas, and it
  // stayed near-stationary (a click, not a drag). The start- and end-on-canvas checks together stop
  // any click on a button or table — which this window-level mouseup also receives — from opening a
  // bar modal.
  if (pressedOnCanvas && e.target === timelineCanvas && panState.distMoved < 4) {
    const best = barAt(e.clientX);
    if (best) openCaptureModal(best.point);
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
// Human-readable session duration from first→last capture: "18m", "2h 5m", "<1m".
function durLabel(first, last) {
  const ms = Date.parse(last) - Date.parse(first);
  if (!(ms > 0)) return "<1m";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return mins + "m";
  return Math.floor(mins / 60) + "h " + (mins % 60) + "m";
}
// Truncate a label for the table cell; the full text lives in the detail modal.
function clip(str, n) { return str && str.length > n ? str.slice(0, n) + "…" : (str || ""); }

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

// Look up a stored session rollup by id (for the cumulative chart chips, which only carry id).
function sessionById(id) { return allSessions.find((s) => s.session_id === id) || null; }

function renderSessions(rows) {
  const data = rows.slice(0, 12);
  table("sessions", ["session", "time", "tokens", "tools", "mcp"], data.map((s) => {
    const repoBranch = s.repo + (s.branch ? "@" + s.branch : "");
    // Lead with what the session was about (its opening prompt), fall back to the activity summary,
    // then to the bare id. Repo/harness become the secondary context.
    const headline = s.title || s.activity || short(s.session_id);
    const sub = repoBranch + (s.harness ? " · " + s.harness : "") + " · " + short(s.session_id);
    const label = esc(clip(headline, 56)) + " <span class='go'>view chat ›</span><br><span style='color:var(--dim);font-size:11px'>" + esc(sub) + "</span>";
    return [label, durLabel(s.first_ts, s.last_ts), { num: fmt(s.total_tokens) }, { num: s.tool_calls }, { num: s.mcp_calls }];
  }), data.map((s) => () => openSessionModal(s)));
}
function renderSpikes(rows) {
  if (!rows.length) { document.getElementById("spikes").innerHTML = "<p style='color:#8b949e'>no spikes</p>"; return; }
  const data = rows.slice(0, 12);
  table("spikes", ["time", "where", "Δ tokens", "event"], data.map((s) => [
    s.ts.slice(0, 19),
    esc(s.context?.title ? clip(s.context.title, 28) : short(s.session_id)),
    { num: "+" + fmt(s.delta_tokens), cls: "spike" },
    s.tool ? s.event + " (" + s.tool + ")" : s.event,
  ]), data.map((s) => () => flaggedEventModal({
    title: "▲ +" + fmt(s.delta_tokens) + " tokens",
    sub: s.event + (s.tool ? " · " + s.tool : ""),
    rows: [
      ["timestamp", s.ts],
      ["delta tokens", fmt(s.delta_tokens)],
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
  table(id, ["key", "tokens", "captures"], rows.slice(0, 12).map((r) => [
    r.key, { num: fmt(r.tokens) }, { num: r.captures },
  ]));
}

// --- conclusion panels --------------------------------------------------------------------------
const emptyPanel = (id, msg) => { document.getElementById(id).innerHTML = "<p style='color:#8b949e'>" + msg + "</p>"; };

// The headline panel: deterministic conclusions, severity-marked. This is the "what this means"
// read so the user does not scan tables.
function renderInsights(rows) {
  const el = document.getElementById("insights");
  if (!rows || !rows.length) { el.innerHTML = "<p style='color:#8b949e'>not enough data yet for conclusions</p>"; return; }
  el.innerHTML = rows.map((f) =>
    "<div class='insight " + esc(f.severity) + "'><span class='dot'></span><div class='body'>"
    + "<div class='hl'>" + esc(f.headline) + "</div><div class='dt'>" + esc(f.detail) + "</div></div></div>"
  ).join("");
}

// Optional LLM synthesis on demand. Hits /api/insights-llm (shells to claude -p server-side). Slow
// (seconds); shows a spinner, degrades to a note if claude is unavailable.
async function runDeepRead() {
  const out = document.getElementById("deepreadout");
  out.textContent = "asking claude… (this can take a few seconds)";
  try {
    const data = await (await fetch("/api/insights-llm")).json();
    out.textContent = data.ok ? data.text : "deeper read unavailable: " + (data.note || "unknown");
  } catch (err) {
    out.textContent = "deeper read failed: " + (err && err.message || err);
  }
}

function renderGroupCost(rows) {
  if (!rows || !rows.length) { emptyPanel("groupcost", "no tool-result data yet"); return; }
  table("groupcost", ["group", "avg tokens/call", "calls", "total"], rows.map((r) => [
    esc(r.group), { num: fmt(r.avg_tokens) }, { num: r.calls }, { num: fmt(r.total_tokens) },
  ]));
}
function renderToolCost(rows) {
  if (!rows || !rows.length) { emptyPanel("toolcost", "no tool-result data yet"); return; }
  const data = rows.slice(0, 14);
  table("toolcost", ["tool", "avg tokens/call", "max", "calls"], data.map((r) => [
    esc(r.tool), { num: fmt(r.avg_tokens) }, { num: fmt(r.max_tokens) }, { num: r.calls },
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
  table("anatomy", ["group", "lift vs normal", "% of spikes", "avg tokens"], a.groups.slice(0, 8).map((g) => [
    esc(g.group),
    g.lift == null ? "only in spikes" : { num: g.lift + "×", cls: g.lift >= 1 ? "spike" : "" },
    { num: Math.round(g.spike_share * 100) + "%" },
    { num: fmt(g.avg_tokens) },
  ]));
}
function renderPackageCost(rows) {
  if (!rows || !rows.length) { emptyPanel("packagecost", "no package data yet"); return; }
  table("packagecost", ["package", "avg tokens/call", "calls", "total"], rows.map((r) => [
    esc(r.package), { num: fmt(r.avg_tokens) }, { num: r.calls }, { num: fmt(r.total_tokens) },
  ]));
}
function renderRegression(r) {
  if (!r || !r.groups.length) { document.getElementById("regression").innerHTML = ""; return; }
  table("regression", ["group", "before", "after", "Δ tokens/call"], r.groups.slice(0, 8).map((g) => [
    esc(g.group),
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
  table("loops", ["session", "tool", "repeats", "hint"], data.map((l) => [
    esc(l.context?.title ? clip(l.context.title, 28) : l.repo + "/" + short(l.session_id)),
    esc(l.tool), { num: l.max_repeat, cls: "spike" }, esc(l.hint),
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
  table("comparison", ["cohort", "n", "avg Δ", "avg tools", "mcp rate"], [
    ["spike", { num: c.spike.count }, { num: fmt(c.spike.avg_delta) }, { num: c.spike.avg_tool_calls }, { num: c.spike.mcp_rate }],
    ["normal", { num: c.normal.count }, { num: fmt(c.normal.avg_delta) }, { num: c.normal.avg_tool_calls }, { num: c.normal.mcp_rate }],
  ]);
}

// Per-table click handlers, keyed by table id. Set when a render passes a details array; read by
// the delegated click listener so rebuilt tables don't leak stale closures.
const tableDetails = {};

// details (optional) is one handler per row; rows that have one get a clickable affordance and
// open a detail modal on click.
function table(id, headers, rows, details) {
  // Align each header to match its column's data, not by position: a column is numeric (right-
  // aligned) when its first data cell is a {num} object. Keeps header and content alignment in sync
  // for mixed tables (e.g. a string "time"/"where"/"event" column sitting among numeric ones).
  const numericCol = headers.map((_, i) => rows.length > 0 && rows[0][i] && typeof rows[0][i] === "object");
  const head = "<tr>" + headers.map((h, i) => "<th" + (numericCol[i] ? " class='num'" : "") + ">" + h + "</th>").join("") + "</tr>";
  const body = rows.map((cells, ri) => {
    const clickable = details && details[ri] ? " class='clickable' data-row='" + ri + "'" : "";
    return "<tr" + clickable + ">" + cells.map((cell) => {
      if (cell && typeof cell === "object") return "<td class='num " + (cell.cls || "") + "'>" + cell.num + "</td>";
      return "<td>" + cell + "</td>";
    }).join("") + "</tr>";
  }).join("");
  document.getElementById(id).innerHTML = "<table>" + head + body + "</table>";
  tableDetails[id] = details || null;
}

// Delegated clicks for dynamic content: table rows, the delta show-all toggle, and cumulative
// session chips (all rendered fresh on each repaint, so static listeners would go stale).
document.addEventListener("click", (e) => {
  if (e.target.closest("#deepread")) { runDeepRead(); return; }
  if (e.target.closest("#deltafilter")) { showAllDeltas = !showAllDeltas; redrawChart(); return; }
  const chip = e.target.closest(".sesschip");
  if (chip) { const s = sessionById(chip.dataset.sid); if (s) openSessionModal(s); return; }
  const tr = e.target.closest("tr.clickable");
  if (!tr) return;
  const panel = tr.closest("[id]");
  const handlers = panel && tableDetails[panel.id];
  const ri = Number(tr.dataset.row);
  if (handlers && handlers[ri]) handlers[ri]();
});

const timelineCanvas = document.getElementById("timeline");
timelineCanvas.addEventListener("mousemove", onTimelineHover);
timelineCanvas.addEventListener("mouseleave", () => {
  document.getElementById("tooltip").style.display = "none";
  if (hoverIdx !== -1) { hoverIdx = -1; redrawChart(); }
});
timelineCanvas.addEventListener("mousedown", onTimelineDown);
// Track move/up on the WINDOW so a drag that wanders off the canvas still pans and releases
// correctly. onTimelineMove/Up no-op unless a press started on the canvas, so other page activity
// is unaffected.
window.addEventListener("mousemove", onTimelineMove);
window.addEventListener("mouseup", onTimelineUp);

// Range buttons: set the global filter span (or "all"), reset pan to live-follow, refetch every
// panel scoped to that window.
document.getElementById("ranges").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-range]");
  if (!btn) return;
  for (const b of document.querySelectorAll("#ranges button")) b.classList.toggle("active", b === btn);
  view.rangeMs = btn.dataset.range === "all" ? null : Number(btn.dataset.range);
  view.panEnd = null;
  load(true);
});

// Chart view toggle: deltas / cumulative / lifespan. Pan + click-detail apply to deltas only.
document.getElementById("chartmodes").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-mode]");
  if (!btn) return;
  for (const b of document.querySelectorAll("#chartmodes button")) b.classList.toggle("active", b === btn);
  chartMode = btn.dataset.mode;
  hoverIdx = -1;
  redrawChart();
});

// Modal dismissal: × button, backdrop click, Escape.
document.getElementById("modalclose").addEventListener("click", closeModal);
document.getElementById("modalback").addEventListener("click", (e) => { if (e.target.id === "modalback") closeModal(); });
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

load(true);
setInterval(() => load(false), 5000);
window.addEventListener("resize", () => redrawChart());
</script>
</body>
</html>`;
}

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
  .sectionhead { font-size:11px; text-transform:uppercase; letter-spacing:.1em; color:var(--accent); margin:8px 0 -8px; font-weight:700; }
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
  <section class="panel">
    <h2>what's causing spikes</h2>
    <div id="causes"></div>
    <div class="legend">grouped by the pattern that drove each token spike · each row is a behavior you can change</div>
  </section>
  <section class="panel">
    <h2>token deltas over time</h2>
    <div class="chartwrap">
      <canvas id="timeline"></canvas>
      <div class="tooltip" id="tooltip"></div>
    </div>
    <div class="legend"><span class="swatch" style="background:var(--accent)"></span>per-capture delta tokens (y) over time (x) <span class="swatch" style="background:var(--spike);margin-left:12px"></span>spike threshold · hover a bar for details · drag to pan · click a bar for detail</div>
  </section>
  <h2 class="sectionhead">conclusions</h2>
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
  <section class="panel" id="loopspanel" style="display:none">
    <h2>⚠ loops detected</h2>
    <div id="loops"></div>
    <div class="legend">a tool fired many times consecutively in one session — likely a runaway agent/skill loop</div>
  </section>
  <h2 class="sectionhead">raw data</h2>
  <section class="panel"><h2>top sessions</h2><div id="sessions"></div></section>
  <section class="panel"><h2>token spikes</h2><div id="spikes"></div></section>
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
  renderGroupCost(data.group_cost);
  renderToolCost(data.tool_cost);
  renderAnatomy(data.spike_anatomy);
  renderPackageCost(data.package_cost);
  renderRegression(data.regression);
  renderLoops(data.loops);
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

// Time-scaled bar chart with token y-axis and time x-axis. Bars are bucketed to one device-pixel
// column by REAL timestamp (not array index), so gaps in activity show as gaps. Each column keeps
// the capture that produced its max delta, so hover can attribute the bar and downsampling still
// preserves spikes.
function drawTimeline(points, threshold) {
  const canvas = document.getElementById("timeline");
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  chartBars = [];
  ctx.font = "10px ui-monospace,Menlo,monospace";
  ctx.textBaseline = "alphabetic";
  if (!points.length) { ctx.fillStyle = "#8b949e"; ctx.fillText("no token data yet", M.left, H / 2); return; }

  const plotW = W - M.left - M.right, plotH = H - M.top - M.bottom;
  const t0 = Date.parse(points[0].ts), tN = Date.parse(points[points.length - 1].ts);
  const span = Math.max(1, tN - t0);
  const cols = Math.max(1, Math.floor(plotW));
  // Bucket by time → column. Each bucket holds the winning (largest-delta) capture so hover and
  // spike preservation agree.
  const buckets = new Array(cols).fill(null);
  for (const p of points) {
    const c = Math.min(cols - 1, Math.floor(((Date.parse(p.ts) - t0) / span) * (cols - 1)));
    if (!buckets[c] || p.delta > buckets[c].delta) buckets[c] = p;
  }
  const max = Math.max(threshold || 0, ...points.map((p) => p.delta)) || 1;
  const xOf = (c) => M.left + c;
  const yOf = (v) => M.top + plotH - (v / max) * plotH;

  // Y-axis: 0, mid, max gridlines + token labels.
  ctx.strokeStyle = "#2d333b"; ctx.fillStyle = "#8b949e"; ctx.textAlign = "right";
  for (const frac of [0, 0.5, 1]) {
    const v = max * frac, y = yOf(v);
    ctx.beginPath(); ctx.moveTo(M.left, y); ctx.lineTo(W - M.right, y); ctx.stroke();
    ctx.fillText(tokShort(v), M.left - 6, y + 3);
  }
  // X-axis: time labels at start, middle, end.
  ctx.textAlign = "center";
  for (const frac of [0, 0.5, 1]) {
    const x = M.left + frac * plotW;
    ctx.fillText(clockLabel(t0 + span * frac), x, H - 6);
  }

  // Bars.
  ctx.fillStyle = "#58a6ff";
  for (let c = 0; c < cols; c++) {
    const p = buckets[c];
    if (!p) continue;
    const x = xOf(c), y = yOf(p.delta), h = M.top + plotH - y;
    if (h > 0) ctx.fillRect(x, y, 1, h);
    chartBars.push({ x, y, h, point: p });
  }
  // Spike threshold line.
  if (threshold > 0) {
    const y = yOf(threshold);
    ctx.strokeStyle = "#f85149"; ctx.setLineDash([4, 3]); ctx.beginPath();
    ctx.moveTo(M.left, y); ctx.lineTo(W - M.right, y); ctx.stroke(); ctx.setLineDash([]);
  }
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
  return best && bestDx <= 6 ? best : null;
}

// Map cursor to the nearest drawn bar and show a context tooltip. Nearest-by-x so thin 1px bars are
// still easy to hit. Hidden when the pointer is past the last bar or there is no data.
function onTimelineHover(e) {
  const tip = document.getElementById("tooltip");
  if (panState.dragging) { tip.style.display = "none"; return; }
  const canvas = document.getElementById("timeline");
  const rect = canvas.getBoundingClientRect();
  const best = barAt(e.clientX);
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
// can include optional fields inline.
function openModal(title, sub, rows) {
  document.getElementById("modaltitle").textContent = title;
  document.getElementById("modalsub").textContent = sub || "";
  document.getElementById("modalbody").innerHTML = rows
    .filter(Boolean)
    .map((r) => "<dt>" + esc(r[0]) + "</dt><dd>" + (r[1] == null || r[1] === "" ? "—" : esc(r[1])) + "</dd>")
    .join("");
  document.getElementById("modalback").classList.add("open");
}
function closeModal() { document.getElementById("modalback").classList.remove("open"); }

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

function renderSessions(rows) {
  const data = rows.slice(0, 12);
  table("sessions", ["session", "time", "tokens", "tools", "mcp"], data.map((s) => {
    const repoBranch = s.repo + (s.branch ? "@" + s.branch : "");
    // Lead with what the session was about (its opening prompt), fall back to the activity summary,
    // then to the bare id. Repo/harness become the secondary context.
    const headline = s.title || s.activity || short(s.session_id);
    const sub = repoBranch + (s.harness ? " · " + s.harness : "") + " · " + short(s.session_id);
    const label = esc(clip(headline, 56)) + "<br><span style='color:var(--dim);font-size:11px'>" + esc(sub) + "</span>";
    return [label, durLabel(s.first_ts, s.last_ts), { num: fmt(s.total_tokens) }, { num: s.tool_calls }, { num: s.mcp_calls }];
  }), data.map((s) => () => openModal(
    s.title || (s.repo + (s.branch ? "@" + s.branch : "") + " session"),
    s.harness + " · " + s.session_id,
    [
      s.title ? ["opening prompt", s.title] : null,
      s.activity ? ["activity", s.activity] : null,
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
    ]
  )));
}
function renderSpikes(rows) {
  if (!rows.length) { document.getElementById("spikes").innerHTML = "<p style='color:#8b949e'>no spikes</p>"; return; }
  const data = rows.slice(0, 12);
  table("spikes", ["time", "where", "Δ tokens", "event"], data.map((s) => [
    s.ts.slice(0, 19), short(s.session_id), { num: "+" + fmt(s.delta_tokens), cls: "spike" }, s.tool ? s.event + " (" + s.tool + ")" : s.event,
  ]), data.map((s) => () => openModal(
    "▲ +" + fmt(s.delta_tokens) + " tokens",
    s.event + (s.tool ? " · " + s.tool : ""),
    [
      ["timestamp", s.ts],
      ["delta tokens", fmt(s.delta_tokens)],
      ["cumulative total", fmt(s.total_tokens)],
      ["event", s.event],
      ["tool", s.tool],
      ["repo", s.repo],
      ["session", s.session_id],
    ]
  )));
}
function renderContrib(id, rows) {
  table(id, ["key", "tokens", "captures"], rows.slice(0, 12).map((r) => [
    r.key, { num: fmt(r.tokens) }, { num: r.captures },
  ]));
}

// --- conclusion panels --------------------------------------------------------------------------
const emptyPanel = (id, msg) => { document.getElementById(id).innerHTML = "<p style='color:#8b949e'>" + msg + "</p>"; };

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
  table("loops", ["session", "tool", "repeats", "hint"], rows.slice(0, 10).map((l) => [
    esc(l.repo + "/" + short(l.session_id)), esc(l.tool), { num: l.max_repeat, cls: "spike" }, esc(l.hint),
  ]));
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

// Delegated click for every detail-bearing table: walk to the row, look up its handler by id+index.
document.addEventListener("click", (e) => {
  const tr = e.target.closest("tr.clickable");
  if (!tr) return;
  const panel = tr.closest("[id]");
  const handlers = panel && tableDetails[panel.id];
  const ri = Number(tr.dataset.row);
  if (handlers && handlers[ri]) handlers[ri]();
});

const timelineCanvas = document.getElementById("timeline");
timelineCanvas.addEventListener("mousemove", onTimelineHover);
timelineCanvas.addEventListener("mouseleave", () => { document.getElementById("tooltip").style.display = "none"; });
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

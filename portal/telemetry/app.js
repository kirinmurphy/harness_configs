import { portalGetJson, portalPostJson, portalCopyText, portalSetUpdatedAt } from "/portal/shared/api.js";

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
let curCumulativeConcern = 20_000_000;
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
// How many legend items to show per chart mode (starts at 5, "view more" adds 10 each time).
let legendShown = { cumulative: 5, bygroup: 5 };

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
// Clear every data panel so stale numbers don't linger while a new window computes. Used on explicit
// filter changes (range / harness), not on the silent background poll.
function wipeSections() {
  for (const id of ["insights","spikes","causes","anatomy","groupcost","toolcost","packagecost","regression","loops","sessions","tools","mcp","comparison"]) {
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

async function load(force, opts) {
  const wipe = !!(opts && opts.wipe);
  if (wipe) { wipeSections(); setLoading(true); }
  let qs = view.rangeMs == null ? "" : "?range=" + view.rangeMs + (view.panEnd == null ? "" : "&end=" + view.panEnd);
  if (view.harness) qs += (qs ? "&" : "?") + "harness=" + encodeURIComponent(view.harness);
  let data;
  try {
    data = await portalGetJson("/api/data" + qs);
  } finally {
    if (wipe) setLoading(false);
  }
  if (!force && data.version === lastVersion) return;
  lastVersion = data.version;
  const w = data.usage_windows || {};
  const scope = view.rangeMs == null ? "" : " · filtered";
  const harnessScope = view.harness ? " · " + view.harness + " only" : "";
  document.getElementById("meta").textContent =
    data.capture_count + " captures · " + data.sessions.length + " sessions · spike ≥ " + fmt(data.spike_threshold) + " tok"
    + " · ~" + fmt(w.five_hour) + " tok last 5h / ~" + fmt(w.seven_day) + " last 7d (local estimate)" + scope + harnessScope;
  portalSetUpdatedAt();
  // Update the deeper-read button label based on which CLI is available.
  if (data.deepread_cli !== undefined) {
    deepReadCli = data.deepread_cli;
    document.getElementById("deepread").textContent = "deeper read" + (deepReadCli ? " (" + deepReadCli + ")" : " (unavailable)") + " ›";
  }
  // Render harness filter only when more than one harness exists in the spool.
  if (data.available_harnesses) updateHarnessFilter(data.available_harnesses);
  renderCauses(data.spike_causes);
  document.body.dataset.threshold = data.spike_threshold || 0;
  allTimeline = data.timeline || [];
  curThreshold = data.spike_threshold || 0;
  curCumulativeConcern = data.cumulative_concern || 20_000_000;
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

function updateHarnessFilter(harnesses) {
  const el = document.getElementById("harnessfilt");
  if (harnesses.length <= 1) { el.classList.remove("visible"); return; }
  el.classList.add("visible");
  // Rebuild buttons only when the harness list changes.
  const cur = [...el.querySelectorAll("button[data-harness]")].map((b) => b.dataset.harness).join(",");
  if (cur === ["all", ...harnesses].join(",")) return;
  const existing = [...el.querySelectorAll("button[data-harness]")];
  for (const b of existing) b.remove();
  const allBtn = document.createElement("button");
  allBtn.dataset.harness = "all"; allBtn.textContent = "all";
  if (!view.harness) allBtn.classList.add("active");
  el.appendChild(allBtn);
  for (const h of harnesses) {
    const btn = document.createElement("button");
    btn.dataset.harness = h; btn.textContent = h;
    if (view.harness === h) btn.classList.add("active");
    el.appendChild(btn);
  }
}

// Plot margins leave room for the y-axis token labels (left) and x-axis time labels (bottom).
const M = { left: 56, right: 12, top: 10, bottom: 22 };
// Canvas can't read CSS variables directly, so we resolve the theme's chrome colors from the
// :root vars once per draw (refreshed in chartSetup) and read them into the ctx below. This keeps
// the chart following the light/dark toggle. Data-series colors (SESSION_COLORS/GROUP_COLORS)
// stay fixed — those are series identity, not theme.
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
let theme = { line: "#2d333b", dim: "#8b949e", ink: "#e6edf3", accent: "#58a6ff", spike: "#f85149" };
function refreshTheme() {
  theme = {
    line: cssVar("--line"),
    dim: cssVar("--dim"),
    ink: cssVar("--ink"),
    accent: cssVar("--accent"),
    spike: cssVar("--spike"),
  };
}
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
let chartMode = "cumulative";
let hoverIdx = -1;
// Per-turn deltas: hide trivially-cheap markers below the median delta unless "show all" is on, so
// the chart highlights the notable turns instead of noise. Toggled by the delta filter button.
let showAllDeltas = false;
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
  refreshTheme();
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
  ctx.strokeStyle = theme.line; ctx.fillStyle = theme.dim; ctx.textAlign = "right";
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
  if (!points.length) { geo.ctx.fillStyle = theme.dim; geo.ctx.fillText("no token data yet", M.left, geo.H / 2); legend.innerHTML = ""; return; }
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
  // Gap of 1px between bars for visual separation; applied only when bars are wider than 2px.
  const barW = Math.max(1, Math.min(24, Math.floor(plotW / Math.max(1, drawn.length)) - 1));
  const barGap = barW > 2 ? 1 : 0;
  const max = Math.max(threshold || 0, ...points.map((p) => p.delta)) || 1;
  const yOf = drawAxes(ctx, geo, max, t0, span);

  drawn.forEach((d, i) => {
    const x = M.left + d.c, y = yOf(d.p.delta), h = M.top + plotH - y;
    const w = barW - barGap;
    const hovered = i === hoverIdx;
    ctx.fillStyle = theme.accent; ctx.globalAlpha = hovered ? 1 : 0.82;
    if (h > 0) ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    if (hovered) {
      ctx.strokeStyle = theme.ink; ctx.lineWidth = 1; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
      ctx.save(); ctx.globalAlpha = 0.25; ctx.strokeStyle = theme.ink; ctx.beginPath(); ctx.moveTo(x + w / 2, M.top); ctx.lineTo(x + w / 2, M.top + plotH); ctx.stroke(); ctx.restore();
    }
    chartBars.push({ x: x + w / 2, y, h, w, idx: i, point: d.p });
  });
  if (threshold > 0) {
    const y = yOf(threshold);
    ctx.strokeStyle = theme.spike; ctx.setLineDash([4, 3]); ctx.beginPath();
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
  const max = Math.max(curCumulativeConcern, ...points.map((p) => p.total || 0));
  const yOf = drawAxes(ctx, geo, max, t0, span);
  const xOf = (ts) => M.left + ((Date.parse(ts) - t0) / span) * plotW;
  const drawnSeries = series.slice(0, SESSION_COLORS.length);
  drawnSeries.forEach((s, i) => {
    ctx.strokeStyle = SESSION_COLORS[i]; ctx.lineWidth = 1.5; ctx.beginPath();
    s.pts.forEach((p, j) => {
      const x = xOf(p.ts), y = yOf(p.total || 0);
      j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      // Store hit areas for hover/click on line chart points.
      chartBars.push({ x, y, w: 8, h: 8, idx: chartBars.length, point: p, sessId: s.id, color: SESSION_COLORS[i], mode: "cumulative" });
    });
    ctx.stroke();
    // Draw small dots at each data point for visual hit affordance.
    for (const p of s.pts) {
      const x = xOf(p.ts), y = yOf(p.total || 0);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = SESSION_COLORS[i]; ctx.fill();
    }
  });
  // Concern line.
  const cy = yOf(curCumulativeConcern);
  ctx.strokeStyle = theme.spike; ctx.setLineDash([4, 3]); ctx.beginPath();
  ctx.moveTo(M.left, cy); ctx.lineTo(W - M.right, cy); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = theme.spike; ctx.textAlign = "left"; ctx.fillText("concern " + tokShort(curCumulativeConcern), M.left + 4, cy - 4);
  // Hover highlight: larger ring around the hovered point.
  if (hoverIdx >= 0 && chartBars[hoverIdx]) {
    const b = chartBars[hoverIdx];
    ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, Math.PI * 2);
    ctx.strokeStyle = theme.ink; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, Math.PI * 2);
    ctx.strokeStyle = b.color || theme.ink; ctx.lineWidth = 1; ctx.stroke();
  }
  // Paginated legend: top N sessions with "view more" if there are more.
  const shown = legendShown.cumulative;
  const legendItems = drawnSeries.slice(0, shown).map((s, i) => {
    const sess = sessionById(s.id);
    const label = sess && sess.title ? clip(sess.title, 48) : short(s.id);
    return "<li><span class='swatch' style='background:" + SESSION_COLORS[i] + ";flex:none'></span>"
      + "<button class='linkbtn sesschip lbl' data-sid='" + esc(s.id) + "' title='" + esc(sess?.title || s.id) + "'>" + esc(label) + " <span style='color:var(--dim)'>(" + tokShort(s.total) + ")</span></button></li>";
  });
  const moreCount = drawnSeries.length - shown;
  legend.innerHTML = "cumulative session tokens (context size) over time · <span class='swatch' style='background:var(--spike)'></span>concern limit · click a session to inspect its chat:"
    + "<ul class='legend-list'>" + legendItems.join("") + "</ul>"
    + (moreCount > 0 ? "<button class='viewmore' id='viewmore-cumulative'>show " + Math.min(moreCount, 10) + " more (" + moreCount + " remaining)</button>" : "");
}

// Cumulative tokens BY TOOL GROUP within the window: a running total line per functional group
// (native-read vs mcp-code vs bash …), using result-size approx tokens. Shows WHAT is driving the
// context climb — the subset breakdown of the cumulative chat curve.
function drawCumulativeByGroup(points, geo, legend) {
  const { ctx, plotW } = geo;
  const withResult = points.filter((p) => p.result_chars != null && p.tool).sort((a, b) => a.ts.localeCompare(b.ts));
  if (!withResult.length) { ctx.fillStyle = theme.dim; ctx.fillText("no tool-result data in this window", M.left, geo.H / 2); legend.innerHTML = ""; return; }
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
    const color = GROUP_COLORS[g] || theme.dim;
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
    groups[g].forEach((pt, j) => {
      const x = xOf(pt.ts), y = yOf(pt.total);
      j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      chartBars.push({ x, y, w: 8, h: 8, idx: chartBars.length, point: pt, group: g, color, mode: "bygroup" });
    });
    ctx.stroke();
    // Small dots at data points.
    for (const pt of groups[g]) {
      const x = xOf(pt.ts), y = yOf(pt.total);
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
    }
  }
  // Hover highlight for bygroup.
  if (hoverIdx >= 0 && chartBars[hoverIdx]) {
    const b = chartBars[hoverIdx];
    ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
    ctx.strokeStyle = theme.ink; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(b.x, b.y, 5, 0, Math.PI * 2);
    ctx.strokeStyle = b.color || theme.ink; ctx.lineWidth = 1; ctx.stroke();
  }
  const shown = legendShown.bygroup;
  const legendItems = order.slice(0, shown).map((g) => {
    const color = GROUP_COLORS[g] || theme.dim;
    return "<li><span class='swatch' style='background:" + color + ";flex:none'></span><span class='lbl'>" + esc(g) + " <span style='color:var(--dim)'>(" + tokShort(running[g]) + ")</span></span></li>";
  });
  const moreCount = order.length - shown;
  legend.innerHTML = "cumulative tokens by tool group (approx, result size) · what drives the context climb:"
    + "<ul class='legend-list'>" + legendItems.join("") + "</ul>"
    + (moreCount > 0 ? "<button class='viewmore' id='viewmore-bygroup'>show " + Math.min(moreCount, 10) + " more (" + moreCount + " remaining)</button>" : "");
}

// Nearest drawn bar/point to a cursor position, or null if none within hit tolerance.
// For bar charts: nearest by x. For line charts: nearest by combined x+y distance (2D proximity).
function barAt(clientX, clientY) {
  if (!chartBars.length) return null;
  const rect = document.getElementById("timeline").getBoundingClientRect();
  const cx = clientX - rect.left;
  const cy = clientY != null ? clientY - rect.top : null;
  const isLine = chartMode !== "deltas";
  let best = null, bestD = Infinity;
  for (const b of chartBars) {
    const dx = Math.abs(b.x - cx);
    const dy = cy != null ? Math.abs(b.y - cy) : 0;
    const d = isLine ? Math.sqrt(dx * dx + dy * dy) : dx;
    if (d < bestD) { bestD = d; best = b; }
  }
  const tol = isLine ? 18 : (best ? Math.max(6, (best.w || 1) / 2 + 2) : 6);
  return best && bestD <= tol ? best : null;
}

// Map cursor to the nearest drawn bar/point: show a tooltip AND highlight it.
function onTimelineHover(e) {
  const tip = document.getElementById("tooltip");
  if (panState.dragging) { tip.style.display = "none"; return; }
  const canvas = document.getElementById("timeline");
  const rect = canvas.getBoundingClientRect();
  const best = barAt(e.clientX, e.clientY);
  const newIdx = best ? best.idx : -1;
  if (newIdx !== hoverIdx) { hoverIdx = newIdx; redrawChart(); }
  if (!best) { tip.style.display = "none"; return; }
  const p = best.point;
  let tipHTML;
  if (chartMode === "cumulative") {
    const sess = sessionById(best.sessId);
    const label = sess && sess.title ? clip(sess.title, 40) : short(best.sessId);
    tipHTML = "<div class='t-head' style='color:" + (best.color || "var(--accent)") + "'>" + esc(label) + "</div>"
      + "<div class='t-row'><span>total:</span> " + fmt(p.total || 0) + " tok</div>"
      + "<div class='t-row'><span>when:</span> " + clockLabel(p.ts) + " · " + p.ts.slice(0, 10) + "</div>"
      + "<div class='t-row'><span>click</span> to open session detail</div>";
  } else if (chartMode === "bygroup") {
    tipHTML = "<div class='t-head' style='color:" + (best.color || "var(--accent)") + "'>" + esc(best.group || "group") + "</div>"
      + "<div class='t-row'><span>cumulative:</span> " + fmt(p.total || 0) + " tok</div>"
      + "<div class='t-row'><span>when:</span> " + clockLabel(p.ts) + " · " + p.ts.slice(0, 10) + "</div>";
  } else {
    const spike = p.delta && document.body.dataset.threshold && p.delta >= Number(document.body.dataset.threshold);
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
    tipHTML = "<div class='t-head" + (spike ? " t-spike" : "") + "'>" + (spike ? "▲ " : "") + "+" + fmt(p.delta) + " tok</div>"
      + rows.map((r) => "<div class='t-row'><span>" + r[0] + ":</span> " + r[1] + "</div>").join("");
  }
  tip.innerHTML = tipHTML;
  tip.style.display = "block";
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
    const data = await portalGetJson("/api/session?" + qs);
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
  await portalCopyText(text);
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
        const data = await portalGetJson("/api/session?" + qs);
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
    const best = barAt(e.clientX, e.clientY);
    if (best) {
      if (chartMode === "cumulative" && best.sessId) {
        const s = sessionById(best.sessId);
        if (s) openSessionModal(s);
      } else if (chartMode !== "bygroup") {
        openCaptureModal(best.point);
      }
    }
  }
}

// The headline panel: each spike cause as a row, biggest token cost first. Click a row for what to do.
function renderCauses(rows) {
  if (!rows || !rows.length) { document.getElementById("causes").innerHTML = "<p style='color:var(--dim)'>no spikes yet — nothing blowing up your tokens</p>"; return; }
  const data = rows.slice(0, 8);
  table("causes", ["cause", "spikes", "avg Δ", "worst Δ", "repo"], data.map((c) => [
    c.cause,
    { num: c.spikes },
    { num: fmt(c.avg_delta) },
    { num: "+" + fmt(c.worst_delta), cls: "spike" },
    c.worst_repo || "unknown",
  ]), data.map((c) => () => openModal(
    c.cause + " — what to do",
    c.spikes + " spikes · worst +" + fmt(c.worst_delta) + " tok in " + (c.worst_repo || "unknown"),
    [
      ["cause", c.cause],
      ["total spikes", c.spikes],
      ["avg delta", fmt(c.avg_delta) + " tok"],
      ["worst delta", "+" + fmt(c.worst_delta) + " tok"],
      ["worst repo", c.worst_repo || "unknown"],
      ["what to change", c.hint || "inspect the session transcript"],
    ]
  )));
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
  if (!rows || !rows.length) { document.getElementById("spikes").innerHTML = "<p style='color:var(--dim)'>no spikes</p>"; return; }
  const data = rows.slice(0, 12);
  table("spikes", ["time", "where", "worst Δ", "event", "hits"], data.map((s) => [
    s.ts.slice(0, 19),
    esc(s.context?.title ? clip(s.context.title, 32) : short(s.session_id)),
    { num: "+" + fmt(s.delta_tokens), cls: "spike" },
    s.tool ? s.event + " (" + s.tool + ")" : s.event,
    s.spike_count > 1 ? { num: "×" + s.spike_count } : "—",
  ]), data.map((s) => () => flaggedEventModal({
    title: "▲ +" + fmt(s.delta_tokens) + " tokens",
    sub: s.event + (s.tool ? " · " + s.tool : "") + (s.spike_count > 1 ? " · " + s.spike_count + " turns above threshold" : ""),
    rows: [
      ["timestamp", s.ts],
      ["worst delta", fmt(s.delta_tokens) + " tok"],
      ["turns above threshold", s.spike_count],
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
const emptyPanel = (id, msg) => { document.getElementById(id).innerHTML = "<p style='color:var(--dim)'>" + msg + "</p>"; };

// The headline panel: deterministic conclusions, severity-marked. This is the "what this means"
// read so the user does not scan tables.
function renderInsights(rows) {
  const el = document.getElementById("insights");
  if (!rows || !rows.length) { el.innerHTML = "<p style='color:var(--dim)'>not enough data yet for conclusions</p>"; return; }
  el.innerHTML = rows.map((f) =>
    "<div class='insight " + esc(f.severity) + "'><span class='dot'></span><div class='body'>"
    + "<div class='hl'>" + esc(f.headline) + "</div><div class='dt'>" + esc(f.detail) + "</div></div></div>"
  ).join("");
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
    const data = await portalGetJson("/api/insights-llm");
    if (data.ok) {
      out.textContent = data.text;
      lastDeepReadText = data.text;
      copyWrap.style.display = "";
    } else {
      out.textContent = "deeper read unavailable: " + (data.note || "unknown");
    }
  } catch (err) {
    out.textContent = "deeper read failed: " + (err && err.message || err);
  }
}

function renderGroupCost(rows) {
  if (!rows || !rows.length) { emptyPanel("groupcost", "no tool-result data yet"); return; }
  table("groupcost", ["group", "avg tokens/call", "calls/session", "calls", "total"], rows.map((r) => [
    esc(r.group), { num: fmt(r.avg_tokens) }, { num: r.calls_per_session ?? "—" }, { num: r.calls }, { num: fmt(r.total_tokens) },
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
  table("loops", ["session", "tool", "repeats"], data.map((l) => [
    esc(l.context?.title ? clip(l.context.title, 36) : l.repo + "/" + short(l.session_id)),
    esc(l.tool), { num: l.max_repeat, cls: "spike" },
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

// Delegated clicks for dynamic content: table rows, the delta show-all toggle, session chips,
// harness filter, view-more legend buttons, and copy response (all rendered fresh on each repaint).
document.addEventListener("click", (e) => {
  if (e.target.closest("#deepread")) { runDeepRead(); return; }
  if (e.target.closest("#copydeepread")) {
    if (lastDeepReadText) {
      copyText(lastDeepReadText).then(() => {
        const btn = document.getElementById("copydeepread");
        const orig = btn.textContent;
        btn.textContent = "copied ✓";
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    }
    return;
  }
  if (e.target.closest("#deltafilter")) { showAllDeltas = !showAllDeltas; redrawChart(); return; }
  if (e.target.closest("#viewmore-cumulative")) {
    legendShown.cumulative += 10; redrawChart(); return;
  }
  if (e.target.closest("#viewmore-bygroup")) {
    legendShown.bygroup += 10; redrawChart(); return;
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
  for (const b of document.querySelectorAll("#ranges button[data-range]")) b.classList.toggle("active", b === btn);
  view.rangeMs = btn.dataset.range === "all" ? null : Number(btn.dataset.range);
  view.panEnd = null;
  legendShown = { cumulative: 5, bygroup: 5 };
  load(true, { wipe: true });
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

// Telemetry on/off state drives the "turn on telemetry" prompt above the chart. Read from /api/config
// (same source the config page uses). When off, the page shell + empty sections still render; the
// prompt offers a one-click enable that hits the SAME endpoint as onboarding / the config toggle.
async function refreshTelemetryState() {
  try {
    const cfg = await portalGetJson("/api/config");
    const on = !!(cfg.telemetry && cfg.telemetry.enabled);
    document.getElementById("telemetryoff").style.display = on ? "none" : "";
  } catch { /* leave prompt hidden on error */ }
}

document.getElementById("enabletelemetry").addEventListener("click", async () => {
  const btn = document.getElementById("enabletelemetry");
  const err = document.getElementById("enableerr");
  btn.disabled = true; err.textContent = "";
  try {
    await portalPostJson("/api/config/packages", { id: "telemetry", enabled: true });
    document.getElementById("telemetryoff").style.display = "none";
    load(true, { wipe: true });
  } catch (e) {
    err.textContent = e.message; btn.disabled = false;
  }
});

const LOAD_POLL_INTERVAL_MS = 5000;
const TELEMETRY_STATE_POLL_INTERVAL_MS = 10000;

load(true);
refreshTelemetryState();
setInterval(() => load(false), LOAD_POLL_INTERVAL_MS);
setInterval(refreshTelemetryState, TELEMETRY_STATE_POLL_INTERVAL_MS);
window.addEventListener("resize", () => redrawChart());

// The theme toggle + nav are wired by the shared /portal/shared/theme.js. Canvas colors are
// resolved from CSS vars at draw time, so redraw when the shared toggle flips the theme (mirrors
// the resize handler).
document.documentElement.addEventListener("roborepo:themechange", () => {
  try { redrawChart(); } catch (e) {}
});

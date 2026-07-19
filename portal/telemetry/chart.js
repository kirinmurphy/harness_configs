// Imperative canvas layer for the Telemetry page's token-usage chart: drawing, hover/tooltip,
// and drag-to-pan. This is real stateful, imperative view code — it doesn't fit templates.js
// (nothing here clones a <template>) or state.js (it mutates canvas + reads live DOM/theme) or
// app.js-style orchestration (it IS the view, not wiring between layers). See
// docs/plans/portal-telemetry-web-components-plan.md for why this is its own module.
//
// Exposes a small controller, createChart(), so app.js drives it without reaching into its
// internals — mirrors the panel-factory shape of panels.js. Click-to-open-detail is the one seam
// that must stay app.js-owned: chart.js takes callbacks (onBarClick, onSessionClick) rather than
// importing the modal directly, keeping the dependency direction one-way.

import { M, SESSION_COLORS, GROUP_COLORS, tokShort, clockLabel, pointGroup, perSessionSeries, fmt, short, clip } from "./state.js";
import { legendDeltas, legendCumulativeHead, legendGroupHead, legendSessionItem, legendGroupItem, legendList, tooltipHead, tooltipRow } from "./templates.js";

export function createChart({ onBarClick, onSessionClick, getSessionById }) {
  const canvas = document.getElementById("timeline");
  const legend = document.getElementById("chartlegend");
  const tip = document.getElementById("tooltip");
  const hint = document.getElementById("panhint");

  // Canvas can't read CSS variables directly, so we resolve the theme's chrome colors from the
  // :root vars once per draw (refreshed in chartSetup) and read them into the ctx below. This
  // keeps the chart following the light/dark toggle. Data-series colors (SESSION_COLORS/
  // GROUP_COLORS) stay fixed — those are series identity, not theme.
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
  // Current chart view + the index of the hovered bar (for highlight). Set by the mode toggle / hover.
  let chartMode = "cumulative";
  let hoverIdx = -1;
  // Per-turn deltas: hide trivially-cheap markers below the median delta unless "show all" is on, so
  // the chart highlights the notable turns instead of noise. Toggled by the delta filter button.
  let showAllDeltas = false;
  // How many legend items to show per chart mode (starts at 5, "view more" adds 10 each time).
  let legendShown = { cumulative: 5, bygroup: 5 };

  // Most recent windowed timeline + threshold/concern, kept so a resize/pan/theme-change can
  // redraw without refetching. Set via redraw().
  let curPoints = [];
  let curThreshold = 0;
  let curCumulativeConcern = 20_000_000;

  function updatePanHint(view) {
    if (view.rangeMs == null || !curPoints.length) { hint.textContent = ""; return; }
    hint.textContent = clockLabel(curPoints[0].ts) + " → " + clockLabel(curPoints[curPoints.length - 1].ts)
      + (view.panEnd == null ? " · live" : " · drag to move");
  }

  // Set up the canvas + return drawing context and plot geometry shared by all three views.
  function chartSetup() {
    refreshTheme();
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
    const geo = chartSetup();
    if (!points.length) { geo.ctx.fillStyle = theme.dim; geo.ctx.fillText("no token data yet", M.left, geo.H / 2); legend.replaceChildren(); return; }
    if (chartMode === "cumulative") return drawCumulative(points, geo);
    if (chartMode === "bygroup") return drawCumulativeByGroup(points, geo);
    return drawDeltas(points, threshold, geo);
  }

  // Per-turn delta bars. Bars widen automatically when there are few points (low time ranges) for
  // easier hover targets; dense histories fall back to per-pixel bucketing that preserves spikes.
  // By default trivially-cheap turns (below the median delta) are hidden so only notable turns show
  // and are interactive; "show all" reveals everything.
  function drawDeltas(points, threshold, geo) {
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
    const filterLabel = (showAllDeltas ? "showing all" : "showing notable (≥ " + tokShort(baseline) + " tok)" + (hidden > 0 ? " — " + hidden + " hidden" : "")) + " · toggle";
    legend.replaceChildren(legendDeltas(filterLabel));
  }

  // Cumulative session total over time: one line per session showing context size climbing within the
  // chat. A dashed red concern line marks where a chat is getting heavy. Session chips in the legend
  // are clickable to open that session's detail (chat context).
  function drawCumulative(points, geo) {
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
      const sess = getSessionById(s.id);
      const label = sess && sess.title ? clip(sess.title, 48) : short(s.id);
      return legendSessionItem({
        color: SESSION_COLORS[i],
        sessionId: s.id,
        title: sess?.title || s.id,
        label,
        tokenLabel: tokShort(s.total),
      });
    });
    const moreCount = drawnSeries.length - shown;
    const moreLabel = moreCount > 0 ? "show " + Math.min(moreCount, 10) + " more (" + moreCount + " remaining)" : null;
    legend.replaceChildren(legendCumulativeHead(), legendList(legendItems, moreLabel, "viewmore-cumulative"));
  }

  // Cumulative tokens BY TOOL GROUP within the window: a running total line per functional group
  // (native-read vs mcp-code vs bash …), using result-size approx tokens. Shows WHAT is driving the
  // context climb — the subset breakdown of the cumulative chat curve.
  function drawCumulativeByGroup(points, geo) {
    const { ctx, plotW } = geo;
    const withResult = points.filter((p) => p.result_chars != null && p.tool).sort((a, b) => a.ts.localeCompare(b.ts));
    if (!withResult.length) { ctx.fillStyle = theme.dim; ctx.fillText("no tool-result data in this window", M.left, geo.H / 2); legend.replaceChildren(); return; }
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
      return legendGroupItem({ color, group: g, tokenLabel: tokShort(running[g]) });
    });
    const moreCount = order.length - shown;
    const moreLabel = moreCount > 0 ? "show " + Math.min(moreCount, 10) + " more (" + moreCount + " remaining)" : null;
    legend.replaceChildren(legendGroupHead(), legendList(legendItems, moreLabel, "viewmore-bygroup"));
  }

  // Nearest drawn bar/point to a cursor position, or null if none within hit tolerance.
  // For bar charts: nearest by x. For line charts: nearest by combined x+y distance (2D proximity).
  function barAt(clientX, clientY) {
    if (!chartBars.length) return null;
    const rect = canvas.getBoundingClientRect();
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

  function redraw(points, threshold, cumulativeConcern, view) {
    curPoints = points;
    curThreshold = threshold;
    if (cumulativeConcern != null) curCumulativeConcern = cumulativeConcern;
    drawTimeline(curPoints, curThreshold);
    if (view) updatePanHint(view);
  }

  // Map cursor to the nearest drawn bar/point: show a tooltip AND highlight it.
  function onTimelineHover(e) {
    if (panState.dragging) { tip.style.display = "none"; return; }
    const rect = canvas.getBoundingClientRect();
    const best = barAt(e.clientX, e.clientY);
    const newIdx = best ? best.idx : -1;
    if (newIdx !== hoverIdx) { hoverIdx = newIdx; drawTimeline(curPoints, curThreshold); }
    if (!best) { tip.style.display = "none"; return; }
    const p = best.point;
    let tipNodes;
    if (chartMode === "cumulative") {
      const sess = getSessionById(best.sessId);
      const label = sess && sess.title ? clip(sess.title, 40) : short(best.sessId);
      tipNodes = [
        tooltipHead(label, { color: best.color || "var(--accent)" }),
        tooltipRow("total:", fmt(p.total || 0) + " tok"),
        tooltipRow("when:", clockLabel(p.ts) + " · " + p.ts.slice(0, 10)),
        tooltipRow("click", "to open session detail"),
      ];
    } else if (chartMode === "bygroup") {
      tipNodes = [
        tooltipHead(best.group || "group", { color: best.color || "var(--accent)" }),
        tooltipRow("cumulative:", fmt(p.total || 0) + " tok"),
        tooltipRow("when:", clockLabel(p.ts) + " · " + p.ts.slice(0, 10)),
      ];
    } else {
      const spike = p.delta && document.body.dataset.threshold && p.delta >= Number(document.body.dataset.threshold);
      const tool = p.mcp_tool ? p.tool + " (" + p.mcp_tool + ")" : p.tool || p.event || "—";
      const rows = [
        ["when:", clockLabel(p.ts) + " · " + p.ts.slice(0, 10)],
        ["event:", p.event || "—"],
        ["tool:", tool],
        p.file_ext ? ["file:", "." + p.file_ext] : null,
        p.result_chars != null ? ["result:", fmt(p.result_chars) + " chars"] : null,
        p.duration_ms != null ? ["took:", p.duration_ms + " ms"] : null,
        ["cause:", p.cause || "—"],
        ["repo:", p.repo + (p.session_id ? " / " + short(p.session_id) : "")],
      ].filter(Boolean);
      tipNodes = [
        tooltipHead("+" + fmt(p.delta) + " tok", { spike }),
        ...rows.map(([term, value]) => tooltipRow(term, value)),
      ];
    }
    tip.replaceChildren(...tipNodes);
    tip.style.display = "block";
    const tipW = tip.offsetWidth;
    const left = best.x + tipW + 14 > rect.width ? best.x - tipW - 8 : best.x + 8;
    tip.style.left = Math.max(0, left) + "px";
    tip.style.top = Math.max(0, Math.min(best.y, rect.height - tip.offsetHeight - 4)) + "px";
  }

  // --- pan (drag the chart to view earlier/later) -------------------------------------------------
  // Dragging only makes sense when a finite range is selected (otherwise the whole series is shown).
  // Translating cursor pixels → time keeps the drag proportional to the visible span. distMoved
  // distinguishes a click (open detail) from a drag (pan) on mouseup.
  const panState = { dragging: false, startX: 0, startEnd: 0, distMoved: 0, pressedOnCanvas: false };
  let onPan = null;

  // Throttle the refetch during a drag so panning stays responsive without flooding the server.
  let panLoadTimer = null;
  function panLoad() {
    if (panLoadTimer) return;
    panLoadTimer = setTimeout(() => { panLoadTimer = null; onPan?.(); }, 120);
  }

  function onTimelineDown(e, view) {
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
    canvas.classList.add("panning");
  }
  function onTimelineMove(e, view) {
    if (!panState.dragging) return;
    panState.distMoved = Math.max(panState.distMoved, Math.abs(e.clientX - panState.startX));
    const plotW = canvas.clientWidth - M.left - M.right;
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
    canvas.classList.remove("panning");
    // Open detail only when ALL of: the press started on the canvas, it ended on the canvas, and it
    // stayed near-stationary (a click, not a drag). The start- and end-on-canvas checks together stop
    // any click on a button or table — which this window-level mouseup also receives — from opening a
    // bar modal.
    if (pressedOnCanvas && e.target === canvas && panState.distMoved < 4) {
      const best = barAt(e.clientX, e.clientY);
      if (best) {
        if (chartMode === "cumulative" && best.sessId) {
          const s = getSessionById(best.sessId);
          if (s) onSessionClick(s);
        } else if (chartMode !== "bygroup") {
          onBarClick(best.point);
        }
      }
    }
  }

  canvas.addEventListener("mousemove", (e) => onTimelineHover(e));
  canvas.addEventListener("mouseleave", () => {
    tip.style.display = "none";
    if (hoverIdx !== -1) { hoverIdx = -1; drawTimeline(curPoints, curThreshold); }
  });

  function setMode(mode) {
    chartMode = mode;
    hoverIdx = -1;
    drawTimeline(curPoints, curThreshold);
  }

  function toggleShowAll() {
    showAllDeltas = !showAllDeltas;
    drawTimeline(curPoints, curThreshold);
  }

  function viewMore(mode) {
    legendShown[mode] += 10;
    drawTimeline(curPoints, curThreshold);
  }

  function resetLegend() {
    legendShown = { cumulative: 5, bygroup: 5 };
  }

  return {
    redraw,
    setMode,
    toggleShowAll,
    viewMore,
    resetLegend,
    onTimelineDown,
    onTimelineMove,
    onTimelineUp,
    setPanHandler: (fn) => { onPan = fn; },
  };
}

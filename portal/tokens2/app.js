// Tokens2 — the evolved tokens dashboard. Fetches the same /api/data report the existing
// /tokens page uses, but renders it in a layered, layperson-readable layout: verdict → findings
// → chart → investigation sections → distilled report → full data. All prose is deterministic:
// finding headlines/details come from report.insights (deriveInsights templates), evidence
// paragraphs interpolate report fields, and section framing is static UI copy.

import { portalGetJson, portalPostJson, portalHideLoading, portalHideLoadingNow, portalSetUpdatedAt } from "/portal/shared/api.js";
import { pageState } from "/portal/telemetry/state.js";
import { activePresentedHarnesses, formatHarnessList } from "/portal/shared/harness-cohort.js";
import { harnessWarningElement } from "/portal/shared/harness-warning.js";

// ── State ──
let firstLoad = true;
let lastVersion = null;
let hasData = false;
let setupReady = false;
let pollTimer = null;

// ── Formatting helpers (local — no dependency on telemetry/state.js's fmt for tokens) ──
const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const tokShort = (n) => {
  n = Number(n || 0);
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "k";
  return String(Math.round(n));
};
const pct = (n) => Math.round(n * 100);
const esc = (s) => String(s == null ? "" : s).replace(
  /[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ── Init ──
init();

async function init() {
  // Setup-state poll: reads /api/config (same as the existing telemetry page's
  // refreshTelemetryState) to determine which cascade rung we're on. Reuses pageState()
  // from portal/telemetry/state.js. The config API returns a flat `telemetry` object
  // (cfg.telemetry.enabled), not nested under packages.
  //
  // Mock data: when the page is NOT in the "full" state (no harness installed, or no
  // real telemetry data), we still fetch /api/data and render the report below the
  // banner — the demo spool (demo.jsonl) feeds the same analyzeTelemetry pipeline.
  // A mock-data disclaimer banner appears at the top of the report when this is the
  // case. Once a real harness is installed and captures real telemetry, the banner
  // disappears and the report shows real data through the same pipeline.
  let cfg;
  try {
    cfg = await portalGetJson("/api/config");
  } catch {
    if (firstLoad) { firstLoad = false; portalHideLoadingNow(); }
    return;
  }
  const telemetryOn = !!(cfg.telemetry && cfg.telemetry.enabled);
  const harnessCount = activePresentedHarnesses(cfg).length;
  // Package capability lookups (docLookupHint) read this snapshot — installed/available state
  // comes from the same /api/config the setup cascade already uses. No second fetch.
  window.__tokens2Config = cfg;
  await applySetupState({ telemetryOn, activeHarnessCount: harnessCount, snap: cfg });

  // Always attempt to load the report — even when the setup state is not "full".
  // In the mock state (no real harness), we fetch from /api/tokens2/mock which
  // reads the bundled mock-spool.jsonl through the same analyzeTelemetry pipeline.
  // In the full state, we fetch from /api/data (the real spool).
  const isFullState = setupReady;
  await load(!isFullState);
  if (setupReady) {
    pollTimer = setInterval(() => load(), 5000);
  }
}

// ── Four-state cascade (mirrors the existing telemetry page) ──
// The /api/data endpoint reads the spool directly; the cascade gates whether the page shows
// the setup banner vs the report. When telemetry is off in the hermetic test env, /api/data
// still returns demo data — so we check capture_count as the real gate, falling back to
// data if the spool has content even when the config says telemetry is off.
async function applySetupState({ telemetryOn, activeHarnessCount, snap }) {
  setupReady = telemetryOn && activeHarnessCount > 0;
  if (!setupReady && firstLoad) { firstLoad = false; portalHideLoadingNow(); }

  const offPanel = document.getElementById("tokens2off");
  const bannerHost = document.getElementById("tokens2banner");
  const content = document.getElementById("tokens2content");
  const state = pageState({ telemetryOn, activeHarnessCount, hasData });

  // The banner (telemetry-off or harness-warning) shows in every non-full state.
  // The content (report) is ALWAYS shown — in non-full states it renders the demo
  // spool's data below the banner, with a mock-data disclaimer. This lets the page
  // demonstrate the full report even before a real harness is installed.
  // The "install a supported harness" banner is the SHARED component
  // (portal/shared/harness-warning.js — the same portal-notice the Agents page renders);
  // it shows below the state panel whenever the machine has no active harness.
  const sharedBanner = harnessWarningElement(snap);
  if (state === "telemetry-off") {
    offPanel.style.display = "";
    const title = offPanel.querySelector("[data-slot=title]");
    const body = offPanel.querySelector("[data-slot=body]");
    if (activeHarnessCount === 0) {
      title.textContent = "telemetry setup required";
      body.textContent = "Turn telemetry on before token usage can be captured. Harness setup is separate — see the Agents page.";
    } else {
      title.textContent = "telemetry is off";
      body.textContent = "Token usage is not being captured. Turn telemetry on to start collecting data across your harnesses.";
    }
  } else if (state === "no-harness") {
    offPanel.style.display = "none";
  } else if (state === "no-data") {
    offPanel.style.display = "";
    const title = offPanel.querySelector("[data-slot=title]");
    const body = offPanel.querySelector("[data-slot=body]");
    title.textContent = "no telemetry data yet";
    body.textContent = "Telemetry is on and a harness is active, but nothing has been captured yet. Run a session in your harness — this page fills in as usage data lands.";
  } else {
    offPanel.style.display = "none";
  }

  // Banner host: the shared harness-warning notice in every state where it applies.
  bannerHost.style.display = sharedBanner ? "" : "none";
  bannerHost.replaceChildren(...(sharedBanner ? [sharedBanner] : []));

  // Content is always visible — the report renders below the banner.
  content.hidden = false;

  // Wire the enable-telemetry button (same pattern as the existing page).
  const enableBtn = document.getElementById("tokens2enable");
  if (enableBtn) {
    enableBtn.hidden = telemetryOn;
    enableBtn.onclick = async () => {
      enableBtn.disabled = true;
      const errEl = document.getElementById("tokens2enableerr");
      if (errEl) errEl.textContent = "";
      try {
        await portalPostJson("/api/config/packages", { id: "telemetry", enabled: true });
        await init();
      } catch (err) {
        if (errEl) errEl.textContent = "failed to enable: " + ((err && err.message) || err);
        enableBtn.disabled = false;
      }
    };
  }
}

// ── Load: fetch the report and render every layer ──
// force=true renders even when setupReady is false (the mock-data path): fetches
// from /api/tokens2/mock instead of /api/data, and shows the mock-data disclaimer.
async function load(force) {
  if (!setupReady && !force) {
    if (firstLoad) { firstLoad = false; portalHideLoading(); }
    return;
  }
  const endpoint = force ? "/api/tokens2/mock" : "/api/data";
  let data;
  try {
    data = await portalGetJson(endpoint);
  } catch {
    if (firstLoad) { firstLoad = false; portalHideLoadingNow(); }
    return;
  }
  if (firstLoad) { firstLoad = false; portalHideLoading(); }
  if (!force && data.version === lastVersion) return;
  lastVersion = data.version;
  hasData = (data.capture_count ?? 0) > 0;
  portalSetUpdatedAt();

  // Mock-data disclaimer: shown when the page is NOT in the "full" state (no real
  // harness installed or no real telemetry data). The report renders below the
  // banner using mock spool data through the same pipeline.
  const showMockDisclaimer = !setupReady;
  const mockBanner = document.getElementById("mock-disclaimer");
  if (mockBanner) mockBanner.style.display = showMockDisclaimer ? "" : "none";

  renderVerdict(data);
  renderFindings(data.insights || []);
  renderAgentPrompt(data);
  renderInvestigationSections(data);
  renderFullData(data);
}

// ── Layer 1: Waste-stat dashboard (own section above Action items) ──
function renderVerdict(data) {
  const grid = document.getElementById("waste-grid");

  // Top-level waste metric: % of usage that is identifiable waste, color-graded
  // (<5% green, 5-10% yellow, 10-15% orange, >15% red). One card per range —
  // "this week" (trailing 7 days) and "all time" (the full report period).
  const wasteParts = [];
  const testTokens = data.testing_efficiency?.["test.tokens_during_testing"];
  const redundant = data.testing_efficiency?.["test.full_suite_without_intervening_edit"];
  if (testTokens > 0) {
    wasteParts.push({ label: "over-testing", tokens: testTokens, note: redundant > 0 ? "incl. full-suite reruns without an edit" : "" });
  }
  const loopWaste = (data.loops || []).reduce((s, l) => s + (l.wasted_tokens || 0), 0);
  if (loopWaste > 0) wasteParts.push({ label: "runaway loops", tokens: loopWaste, note: "" });
  const readWaste = (data.read_warnings || []).reduce((s, w) => s + (w.approx_tokens || 0), 0);
  if (readWaste > 0) wasteParts.push({ label: "redundant reads", tokens: readWaste, note: "" });
  // Spike excess: the portion of spike turns above the spike threshold — the part of a
  // spike that exceeded what a normal turn costs (defensible "excess", not the whole spike).
  const threshold = data.spike_threshold || 0;
  const spikeExcess = (data.spike_causes || [])
    .reduce((s, c) => s + Math.max(c.total_delta - c.spikes * threshold, 0), 0);
  if (spikeExcess > 0) wasteParts.push({ label: "spike excess", tokens: spikeExcess, note: "turn size above the spike threshold" });

  grid.replaceChildren();
  if (!wasteParts.length) {
    const empty = document.createElement("div");
    empty.className = "waste-card";
    empty.innerHTML = `<span class="dl-text">No identifiable waste in this window — every category the pipeline tracks (spikes, loops, redundant reads, redundant test runs) came back clean.</span>`;
    grid.appendChild(empty);
    return;
  }

  const allTotal = (data.timeline || []).reduce((s, p) => s + (p.delta || 0), 0);
  const weekTotal = data.usage_windows?.seven_day;
  const allWaste = wasteParts.reduce((s, p) => s + p.tokens, 0);
  const weekWaste = wasteInWindow(wasteParts, data, 7);

  if (weekTotal) grid.appendChild(wasteCard("This week", weekWaste, weekTotal, wasteParts, 16));
  grid.appendChild(wasteCard("All time", allWaste, allTotal, wasteParts, 10));
}

// Sticky-header offset for scroll targets, measured ONCE at load (per user: no scroll/resize
// re-measure) plus a 1rem breathing gap.
let stickyHeaderOffset = 0;
function measureStickyHeader() {
  const header = document.querySelector(".portal-header");
  stickyHeaderOffset = header ? header.getBoundingClientRect().height + 16 : 16;
}

// Scroll to and auto-expand an Investigate section. Collapsing (or a click on an already-open
// section's summary) must NOT scroll — only the "jump to evidence" path does.
function scrollToSection(section) {
  section.open = true;
  const y = section.getBoundingClientRect().top + window.scrollY - stickyHeaderOffset;
  window.scrollTo({ top: y, behavior: "smooth" });
}

// Click/keyboard delegation for waste-source links → jump to the matching Investigate section.
// One listener, wired once — sections re-render per poll, so the handler looks the section up at
// click time instead of closing over elements.
function wireWasteSourceLinks() {
  const jump = (el) => {
    const section = document.querySelector(`#invest-sections details[data-sec-key="${el.dataset.secKey}"]`);
    if (section) scrollToSection(section);
  };
  document.addEventListener("click", (e) => {
    const el = e.target.closest?.(".waste-source-link");
    if (!el) return;
    e.preventDefault();
    jump(el);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const el = e.target.closest?.(".waste-source-link");
    if (!el) return;
    e.preventDefault();
    jump(el);
  });
  // The "+N more" control behaves like a dropdown styled as a tooltip: click toggles a persistent
  // popover; clicking an item or outside dismisses it. (Plain data-tip-html would hover-dismiss,
  // which is wrong for a click-open menu.) One instance open at a time.
  document.addEventListener("click", (e) => {
    const moreBtn = e.target.closest?.(".waste-more");
    const item = e.target.closest?.(".waste-source-link");
    document.querySelectorAll(".waste-more.open").forEach((btn) => {
      if (btn !== moreBtn) { btn.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); }
    });
    if (moreBtn) {
      e.preventDefault();
      const open = moreBtn.classList.toggle("open");
      moreBtn.setAttribute("aria-expanded", open ? "true" : "false");
      return;
    }
    if (item) {
      // Item click: jump (handled above) AND close whichever dropdown is open.
      document.querySelectorAll(".waste-more.open").forEach((btn) => {
        btn.classList.remove("open");
        btn.setAttribute("aria-expanded", "false");
      });
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { document.querySelectorAll(".waste-more.open").forEach((btn) => { btn.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); }); } });
  measureStickyHeader();
}

// Waste tokens attributable to the trailing N days, computed per-category from event
// timestamps (not apportioned by volume share — that mathematically cancels out and makes
// both cards identical). Spike excess and read warnings are timestamped; testing is
// report-global, so it's apportioned by the window's share of timeline volume.
function wasteInWindow(parts, data, days) {
  const timeline = data.timeline || [];
  if (!timeline.length) return parts.reduce((s, p) => s + p.tokens, 0);
  const latest = timeline.reduce((m, p) => (p.ts > m ? p.ts : m), timeline[0].ts);
  const cutoff = new Date(Date.parse(latest) - days * 86400000).toISOString();
  const totalWaste = parts.reduce((s, p) => s + p.tokens, 0);
  const inWindow = (ts) => ts >= cutoff;

  // Spike excess: per timeline point, the amount above the spike threshold.
  const thr = data.spike_threshold || 0;
  const spikeExcessWeek = thr > 0
    ? timeline.filter((p) => p.delta >= thr && inWindow(p.ts)).reduce((s, p) => s + (p.delta - thr), 0)
    : 0;

  // Read warnings: timestamped rows.
  const readWasteWeek = (data.read_warnings || []).filter((w) => inWindow(w.ts)).reduce((s, w) => s + (w.approx_tokens || 0), 0);

  // Loop waste: timestamped loop rows.
  const loopWasteWeek = (data.loops || []).filter((l) => inWindow(l.ts)).reduce((s, l) => s + (l.wasted_tokens || 0), 0);

  // Testing: global metric — apportion by the window's share of timeline volume.
  const weekShare = timeline.filter((p) => inWindow(p.ts)).reduce((s, p) => s + (p.delta || 0), 0)
    / timeline.reduce((s, p) => s + (p.delta || 0), 0);
  const testPart = parts.find((p) => p.label === "over-testing");
  const testWeek = testPart ? testPart.tokens * weekShare : 0;

  let weekWaste = spikeExcessWeek + readWasteWeek + loopWasteWeek + testWeek;
  // Timeline spikes can diverge from spike_causes rollup — clamp to the all-time waste.
  return Math.min(Math.max(Math.round(weekWaste), 0), totalWaste);
}

// Waste grade: color starts only where the user's danger line says it matters — below the first
// band the value renders in the DEFAULT color (a small deficit is still a deficit, not "good").
// Bands scale to the card's danger line (all-time 10%, this-week 16%): yellow at 1/3, orange 2/3,
// red at the line — the same 5/10/15 proportion as the original 15%-red scale.
function wasteGrade(pct, danger) {
  if (pct >= danger) return "grade-red";
  if (pct >= (danger * 2) / 3) return "grade-orange";
  if (pct >= danger / 3) return "grade-yellow";
  return "";
}

// One waste card: analytics-header style — range label, huge graded %, subtle tokens line, then
// the top-3 waste sources (each a link to its Investigate section) plus a "+N more" tooltip
// (shared tooltip component) listing every violator with its percent.
function wasteCard(label, waste, total, parts, danger) {
  const div = document.createElement("div");
  div.className = "waste-card";
  const share = total > 0 ? (waste / total) * 100 : 0;
  const grade = wasteGrade(share, danger);
  const sum = parts.reduce((s, p) => s + p.tokens, 0);
  const scale = waste / (sum || 1);
  // Violators by share of the range's total usage, descending.
  const violators = parts
    .map((p) => ({ label: p.label, tokens: p.tokens * scale, pct: total > 0 ? ((p.tokens * scale) / total) * 100 : 0 }))
    .filter((v) => v.pct >= 0.05)
    .sort((a, b) => b.pct - a.pct);
  // Investigate-section each source links to (scroll + auto-expand).
  const secKeyByLabel = { "over-testing": "testing", "redundant reads": "reads", "runaway loops": "loops", "spike excess": "spikes" };
  const sourceHtml = (v) => {
    const g = wasteGrade(v.pct, danger);
    const key = secKeyByLabel[v.label] ? ` data-sec-key="${secKeyByLabel[v.label]}"` : "";
    return `<span class="waste-source${key ? " waste-source-link" : ""}"${key} tabindex="0"><span class="waste-pct-inline ${g}">${v.pct < 1 ? "<1" : Math.round(v.pct)}%</span> ${esc(v.label)}</span>`;
  };
  const shown = violators.slice(0, 3);
  const rest = violators.slice(3);
  // "+N more": click-persistent dropdown (visually a tooltip) listing ALL violators as clickable
  // jump links. Open/close handled by the delegated listeners in wireWasteSourceLinks.
  const violatorHtml = (v) => {
    const g = wasteGrade(v.pct, danger);
    const key = secKeyByLabel[v.label] ? ` data-sec-key="${secKeyByLabel[v.label]}"` : "";
    return `<span class="waste-source waste-source-link"${key} tabindex="0"><span class="waste-pct-inline ${g}">${v.pct < 1 ? "<1" : Math.round(v.pct)}%</span> ${esc(v.label)}</span>`;
  };
  const moreHtml = rest.length
    ? `<span class="waste-more-wrap">
         <button type="button" class="waste-more" aria-expanded="false" aria-haspopup="true">+${rest.length} more</button>
         <span class="waste-pop" role="menu">${violators.map((v) => `<span class="waste-pop-row">${violatorHtml(v)}</span>`).join("")}</span>
       </span>`
    : "";

  div.innerHTML = `<span class="waste-range">${esc(label)}</span>
    <span class="waste-big ${grade}"><span class="waste-pct">${Math.round(share * 10) / 10}%</span><span class="waste-sub">${tokShort(waste)} of ${tokShort(total)} tokens</span></span>
    <span class="waste-sources">${shown.map(sourceHtml).join(`<span class="waste-sep">, </span>`)}${moreHtml}</span>`;
  return div;
}

// ── Layer 2: Action items (findings from deriveInsights) ──
function renderFindings(insights) {
  const container = document.getElementById("findings");
  container.replaceChildren();
  if (!insights || !insights.length) {
    container.appendChild(emptyMsg("not enough data yet for conclusions"));
    return;
  }
  for (const f of insights.slice(0, 8)) {
    container.appendChild(findingCard(f));
  }
}

function findingCard(f) {
  const sevClass = f.severity === "high" ? "sev-high" : f.severity === "warn" ? "sev-warn" : "sev-info";
  const confClass = f.confidence === "strong signal" ? "strong" : "";
  const card = document.createElement("div");
  card.className = "finding";
  card.innerHTML = `<div class="finding-top">
      <div class="severity ${sevClass}"></div>
      <div class="finding-body">
        <h3 class="finding-title">${esc(f.headline)}
          ${f.confidence ? `<span class="confidence ${confClass}">${esc(f.confidence)}</span>` : ""}
        </h3>
        <p class="finding-evidence">${esc(f.detail || "")}</p>
      </div>
    </div>
    <div class="finding-action">
      ${f.next_action ? `<span class="next">→ ${esc(f.next_action)}</span>` : ""}
    </div>`;
  return card;
}

// ── Layer 4: Investigation sections ──
function renderInvestigationSections(data) {
  const container = document.getElementById("invest-sections");
  container.replaceChildren();

  // 4a: Spike causes — badge is a count, enough to prompt opening.
  if (data.spike_causes?.length) {
    container.appendChild(investSection({
      key: "spikes",
      title: "What made tokens jump",
      framing: "each spike tagged with the behavior that drove it — and what to change",
      badge: `${data.spike_causes.length} spike${data.spike_causes.length > 1 ? "s" : ""}`,
      badgeClass: "alert",
      bodyEl: spikeCausesBody(data.spike_causes),
    }));
  }

  // 4b: Spike anatomy
  if (data.spike_anatomy?.groups?.length) {
    container.appendChild(investSection({
      key: "spike-prone",
      title: "Which tools are spike-prone",
      framing: "lift = how much more a tool group drives spikes vs its normal share. Above 1 = spike-heavy",
      badge: `${data.spike_anatomy.groups.length} group${data.spike_anatomy.groups.length > 1 ? "s" : ""}`,
      badgeClass: "warn",
      bodyEl: spikeAnatomyBody(data.spike_anatomy),
    }));
  }

  // 4c: Loops
  if (data.loops?.length) {
    container.appendChild(investSection({
      key: "loops",
      title: "Tools that got stuck",
      framing: "same tool fired many times consecutively in one session — likely a runaway retry loop",
      badge: `${data.loops.length} loop${data.loops.length > 1 ? "s" : ""}`,
      badgeClass: "alert",
      bodyEl: loopsBody(data.loops, data),
    }));
  }

  // 4d: Read warnings — grouped by TYPE (one collapsible item per warning type), each type's
  // instances listed inside it. The per-row list didn't scale: same-type rows repeated the same
  // label + hint, so N warnings read as N-1 duplicates.
  if (data.read_warnings?.length) {
    container.appendChild(investSection({
      key: "reads",
      title: "Context bloat from reads",
      framing: "large or repeated document reads that inflated context unnecessarily",
      badge: `${data.read_warnings.length} warning${data.read_warnings.length > 1 ? "s" : ""}`,
      badgeClass: "warn",
      bodyEl: readWarningsBody(data.read_warnings, data),
    }));
  }

  // 4e: Cost by tool group — evidence panel with one warn condition: a group taking ≥40% of ALL
  // tool tokens is dominant (same threshold the Action-items dominant-cost finding uses). Below
  // that, "biggest group" is not actionable on its own — the badge stays a neutral count.
  if (data.group_cost?.length) {
    const byShare = [...data.group_cost].sort((a, b) => (b.share_of_tokens || 0) - (a.share_of_tokens || 0));
    const top = byShare[0];
    const topShare = Math.round((top.share_of_tokens || 0) * 100);
    const dominant = topShare >= 40;
    container.appendChild(investSection({
      key: "group-cost",
      title: "Which tool groups cost the most?",
      framing: "share of all tool tokens, by functional group — warns when one group takes ≥40%, because that's where scoping saves the most",
      badge: dominant ? `${top.group} (${topShare}%)` : `${data.group_cost.length} group${data.group_cost.length > 1 ? "s" : ""}, none dominant`,
      badgeClass: dominant ? "warn" : "",
      bodyEl: costComparisonBody(data.group_cost, data.tool_cost),
    }));
  }

  // 4f: Regression — % share framing. First-half vs last-half share of tool tokens: a group can
  // only gain share by growing relative to everything else, so a share gain IS "got more
  // expensive relative to your overall trends". Raw token moves stay as secondary detail.
  if (data.regression?.groups?.length) {
    const byShareGain = [...data.regression.groups].sort(
      (a, b) => ((b.after_share ?? 0) - (b.before_share ?? 0)) - ((a.after_share ?? 0) - (a.before_share ?? 0)),
    );
    const top = byShareGain[0];
    const hasRegression = (top.after_share ?? 0) - (top.before_share ?? 0) > 0;
    const bShare = pct(top.before_share ?? 0);
    const aShare = pct(top.after_share ?? 0);
    container.appendChild(investSection({
      key: "regression",
      title: "Did anything get more expensive?",
      framing: "first half vs last half of your data, as each group's share of tool tokens — a share gain means it grew relative to everything else",
      badge: hasRegression ? `${top.group} → ${bShare}% → ${aShare}%` : "none found",
      badgeClass: hasRegression ? "warn" : "",
      bodyEl: regressionBody(data.regression),
    }));
  }

  // 4g: Testing efficiency — badge is the direct yes/no the question asks; the number lives in
  // the body. Threshold: ≥10% token share = yes (waste line's yellow band).
  if (data.testing_efficiency) {
    const te = data.testing_efficiency;
    const tokenShare = te["test.token_share"];
    if (tokenShare != null) {
      const overTesting = tokenShare >= 10;
      container.appendChild(investSection({
        key: "testing",
        title: "Are you over-testing?",
        framing: "how much of your captured token traffic goes to test runs, full-suite reruns, and targeted-to-full balance",
        badge: overTesting ? `yes — ${tokenShare}%` : `no — ${tokenShare}%`,
        badgeClass: overTesting ? "warn" : "",
        bodyEl: testingEfficiencyBody(te),
      }));
    }
  }

  // 4h: Marker comparison — badge is the measured change.
  if (data.marker_comparison) {
    const ev = data.marker_comparison.evidence || {};
    const rel = ev.relative_change;
    container.appendChild(investSection({
      key: "marker",
      title: "Before vs after your change",
      framing: "pick a marker you set (a skill change, a model swap) and compare token cost across it",
      badge: rel != null ? `${rel > 0 ? "+" : ""}${pct(rel)}% tokens/session` : "no change measured",
      badgeClass: rel != null && rel > 0 ? "warn" : "",
      bodyEl: markerComparisonBody(data.marker_comparison),
    }));
  }
}

function investSection({ key, title, framing, badge, badgeClass, bodyEl }) {
  const details = document.createElement("details");
  details.className = "invest-section";
  if (key) details.dataset.secKey = key;
  details.innerHTML = `<summary>
    <span class="chev">▸</span>
    <span class="invest-head">
      <span class="invest-title">${esc(title)}</span>
      <span class="invest-framing">${esc(framing)}</span>
    </span>
    <span class="invest-badge ${badgeClass}">${esc(badge)}</span>
  </summary>
  <div class="invest-body"></div>`;
  const body = details.querySelector(".invest-body");
  body.appendChild(bodyEl);
  return details;
}

function spikeCausesBody(rows) {
  const frag = document.createDocumentFragment();
  for (const c of rows.slice(0, 8)) {
    frag.appendChild(itemRow({
      dotColor: "var(--danger)",
      head: `${causeLabel(c.cause)} (${c.spikes} spike${c.spikes > 1 ? "s" : ""})`,
      detail: `Worst: <span class="num">+${tokShort(c.worst_delta)}</span> delta in <code>${esc(c.worst_repo || "unknown")}</code>. Average delta: <span class="num">${tokShort(c.avg_delta)}</span> per spike.`,
      hint: c.hint,
    }));
  }
  return frag;
}

function spikeAnatomyBody(a) {
  const frag = document.createDocumentFragment();
  for (const g of a.groups.slice(0, 8)) {
    const liftColor = g.lift >= 5 ? "var(--danger)" : g.lift >= 1 ? "var(--warn)" : "var(--ok)";
    frag.appendChild(itemRow({
      dotColor: liftColor,
      head: `${esc(g.group)} — lift ${g.lift == null ? "only in spikes" : g.lift + "×"}`,
      detail: `Appears in <span class="num">${pct(g.spike_share)}%</span> of spike turns but only <span class="num">${pct(g.normal_share)}%</span> of normal turns. Average <span class="num">${tokShort(g.avg_tokens)}</span> tokens/call in spikes.`,
      hint: g.lift >= 1 ? `Scope ${esc(g.group)} calls more narrowly (smaller query, fewer refs) before they land in context.` : "Below baseline — not a spike driver.",
    }));
  }
  return frag;
}

function loopsBody(rows, data) {
  const frag = document.createDocumentFragment();
  for (const l of rows.slice(0, 10)) {
    frag.appendChild(itemRow({
      dotColor: "var(--danger)",
      head: `${esc(l.tool)} repeated ${l.max_repeat}× — ${esc(l.repo)}`,
      detail: `Session: ${sessionLink(l.session_id, data, l.context?.title ? `"${l.context.title}"` : null)}`,
      hint: l.hint,
    }));
  }
  return frag;
}

// Read warnings grouped by TYPE: one item-row per warning type, instances as an internal list
// inside it, hint shown once. Cap the internal list at 5 instances with a "+N more" tail.
function readWarningsBody(rows, data) {
  const frag = document.createDocumentFragment();
  const byType = new Map();
  for (const w of rows) {
    if (!byType.has(w.type)) byType.set(w.type, []);
    byType.get(w.type).push(w);
  }
  // Types sorted by combined token weight, heaviest first.
  const types = [...byType.entries()]
    .map(([type, list]) => ({ type, list, tokens: list.reduce((s, w) => s + (w.approx_tokens || 0), 0) }))
    .sort((a, b) => b.tokens - a.tokens);
  for (const { type, list } of types) {
    const totalTokens = list.reduce((s, w) => s + (w.approx_tokens || 0), 0);
    const totalReads = list.reduce((s, w) => s + (w.read_count || 1), 0);
    const instances = list.slice(0, 5);
    const overflow = list.length - instances.length;
    const instanceLines = instances.map((w) =>
      `<div class="read-instance">${esc(w.repo || "unknown")} · <span class="num">${tokShort(w.approx_tokens)}</span> approx tokens · ${w.read_count || 1} read${(w.read_count || 1) > 1 ? "s" : ""} · Session: ${sessionLink(w.session_id, data)}</div>`,
    ).join("");
    frag.appendChild(itemRow({
      dotColor: type === "large_document_read" ? "var(--warn)" : "var(--danger)",
      head: `${readWarningLabel(type)} <span class="read-type-meta">— ${tokShort(totalTokens)} approx tokens · ${totalReads} total reads · ${list.length} instance${list.length > 1 ? "s" : ""}</span>`,
      detail: `<div class="read-instances">${instanceLines}${overflow > 0 ? `<div class="read-instance read-more">+${overflow} more</div>` : ""}</div>`,
      hint: docLookupHint(list[0], type),
    }));
  }
  return frag;
}

// Capability-aware doc-lookup hint — package-agnostic by construction. The three states:
//   1) a doc-lookup package is INSTALLED (live config) or already used in this session's data
//      → name it, framed as "already available, use it" (no install suggestion);
//   2) one is AVAILABLE in the catalog but not installed → mention it by name + install link;
//   3) none known → agnostic advice, no package reference.
// Package identity comes from /api/config's package list (id/label + self-declared capabilities),
// never from a hardcoded name here. Falls back to the state-3 copy when config isn't loaded.
function docLookupHint(warning, type) {
  const cfg = window.__tokens2Config;
  const pkgs = (cfg?.packages || []).filter((p) => (p.capabilities || []).includes("doc-lookup"));
  if (!pkgs.length) return readWarningLabel(type) === "Large document read"
    ? "prefer a section-level lookup over loading the whole document"
    : "reuse the earlier result or look up only the needed section";
  const sessionUsed = warning.context?.mcp_servers_used || [];
  const installed = pkgs.find((p) => p.status === "enabled" || p.status === "configured" || sessionUsed.includes(p.id));
  if (installed) {
    return `a doc index is already installed (${installed.label}) — pull only the section you need instead of the full file`;
  }
  const available = pkgs[0];
  return `a doc index would serve just the section you need — ${available.label} is available but not installed`;
}

function costComparisonBody(groupCost, toolCost) {
  // Horizontal bar chart: y = tool group, x = SHARE of all tool tokens. Share is the primary
  // framing (universally understood, same unit as the waste cards); avg tokens/call stays in the
  // metadata rows. Heaviest/cheapest per-call highlighted by data, not hardcoded group names.
  const sorted = [...groupCost].sort((a, b) => (b.total_tokens || 0) - (a.total_tokens || 0)).slice(0, 8);
  const perCallRanked = [...groupCost].sort((a, b) => b.avg_tokens - a.avg_tokens);
  const heaviest = perCallRanked[0]?.group;
  const cheapest = perCallRanked[perCallRanked.length - 1]?.group;

  const rowH = 44, padL = 150, padR = 70, gap = 10;
  const W = 984;
  const H = sorted.length * rowH + 10;
  const maxVal = Math.max(...sorted.map((g) => g.share_of_tokens || 0), 0.0001);
  const chartW = W - padL - padR;

  let rows = "";
  for (let i = 0; i < sorted.length; i++) {
    const g = sorted[i];
    const y = i * rowH;
    const w = Math.max(((g.share_of_tokens || 0) / maxVal) * chartW, 2);
    const isHeavy = g.group === heaviest && sorted.length > 1;
    const isCheap = g.group === cheapest && sorted.length > 1;
    const fill = isHeavy ? "var(--warn)" : isCheap ? "var(--ok)" : "var(--accent)";
    const shareLabel = Math.round((g.share_of_tokens || 0) * 100) + "%";
    rows += `<text x="${padL - 10}" y="${y + rowH / 2 - 2}" fill="var(--ink)" font-size="12" font-weight="600" font-family="var(--sans)" text-anchor="end">${esc(g.group)}</text>
      <rect x="${padL}" y="${y + 4}" width="${w.toFixed(0)}" height="${rowH - 16}" fill="${fill}" rx="3"/>
      <text x="${(padL + w + 8).toFixed(0)}" y="${y + rowH / 2 - 2}" fill="var(--dim)" font-size="11" font-family="var(--sans)">${shareLabel}</text>`;
  }
  // X-axis ticks in %.
  const tickCount = 4;
  let ticks = "";
  for (let i = 0; i <= tickCount; i++) {
    const v = (maxVal / tickCount) * i;
    const x = padL + (v / maxVal) * chartW;
    ticks += `<line x1="${x.toFixed(0)}" y1="0" x2="${x.toFixed(0)}" y2="${H - 6}" stroke="var(--line)" stroke-width="0.5" opacity="0.3"/>
      <text x="${x.toFixed(0)}" y="${H + 2}" fill="var(--dim)" font-size="10" font-family="var(--sans)" text-anchor="middle">${Math.round(v * 100)}%</text>`;
  }

  const frag = document.createDocumentFragment();
  const chart = document.createElement("div");
  chart.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${H + 16}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Average tokens per call by tool group">
    <g transform="translate(0,0)">${rows}</g>
    ${ticks}
  </svg>`;

  // Metadata rows under the chart: dedicated tag column first, then group + details,
  // so the tags never offset the column alignment.
  const meta = document.createElement("div");
  meta.className = "cost-meta";
  for (const g of sorted) {
    const row = document.createElement("div");
    row.className = "cost-meta-row";
    const isHeavy = g.group === heaviest && sorted.length > 1;
    const isCheap = g.group === cheapest && sorted.length > 1;
    row.innerHTML = `<span class="cost-meta-tag">${isHeavy ? '<span class="tag heaviest">heaviest</span>' : isCheap ? '<span class="tag cheapest">cheapest</span>' : ""}</span>
      <span class="cost-meta-group">${esc(g.group)}</span>
      <span class="cost-meta-detail">${fmt(g.calls)} calls · ${tokShort(g.total_tokens)} total · ${g.calls_per_session || "—"} calls/session</span>`;
    meta.appendChild(row);
  }
  frag.appendChild(chart);
  frag.appendChild(meta);
  return frag;
}

function regressionBody(r) {
  const frag = document.createDocumentFragment();
  // Primary column = share of tool tokens (first half → last half); per-call tokens demoted to
  // the detail column. Rows sorted by share gain, biggest gainer first. A header row labels every
  // column — the before/after pair is meaningless without knowing what unit it's in.
  const sorted = [...r.groups].sort(
    (a, b) => ((b.after_share ?? 0) - (b.before_share ?? 0)) - ((a.after_share ?? 0) - (a.before_share ?? 0)),
  );
  const table = document.createElement("div");
  table.className = "reg-table";
  table.innerHTML = `<div class="reg-row reg-head" role="row">
      <span class="reg-group">tool group</span>
      <span class="reg-col">first half</span>
      <span class="reg-arrow"></span>
      <span class="reg-col">last half</span>
      <span class="reg-col">this week</span>
      <span class="reg-detail">avg tok/call</span>
    </div>`;
  for (const g of sorted.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = "reg-row";
    const gain = (g.after_share ?? 0) - (g.before_share ?? 0);
    const deltaClass = gain > 0 ? "up" : gain < 0 ? "down" : "";
    row.innerHTML = `<span class="reg-group">${esc(g.group)}</span>
      <span class="reg-col">${pct(g.before_share ?? 0)}%</span>
      <span class="reg-arrow">→</span>
      <span class="reg-col reg-after ${deltaClass}">${pct(g.after_share ?? 0)}%</span>
      <span class="reg-col">${pct(g.week_share ?? 0)}%</span>
      <span class="reg-detail">${tokShort(g.before_avg_tokens)} → ${tokShort(g.after_avg_tokens)}</span>`;
    table.appendChild(row);
  }
  frag.appendChild(table);
  if (r.exploratory) {
    const note = document.createElement("p");
    note.className = "item-detail";
    note.style.margin = "8px 0 0";
    note.innerHTML = `<strong>Exploratory:</strong> midpoint split, not tied to a specific change. Mark the change you suspect and use the marker-relative comparison for a precise before/after.`;
    frag.appendChild(note);
  }
  return frag;
}

function testingEfficiencyBody(te) {
  const frag = document.createDocumentFragment();
  const tokenShare = te["test.token_share"];
  const fullPerActiveSession = te["test.full_suite_calls_per_testing_session"];
  const redundant = te["test.full_suite_without_intervening_edit"];
  const redundantRounded = Math.round(redundant);
  frag.appendChild(itemRow({
    dotColor: redundant >= 1 ? "var(--warn)" : "var(--accent)",
    head: `Full suite run ${fullPerActiveSession != null ? fullPerActiveSession.toFixed(1) : "—"}× per session with any testing`,
    detail: `<span class="num">${tokenShare != null ? tokenShare : "—"}%</span> of all captured tokens went to testing${redundantRounded >= 1 ? ` · <span class="num">${redundantRounded}</span> full-suite rerun${redundantRounded === 1 ? "" : "s"} without an intervening edit` : ""}.`,
    hint: "Run targeted tests (single file or --filter) between edits — save the full suite for the end.",
  }));
  return frag;
}

function markerComparisonBody(mc) {
  const frag = document.createDocumentFragment();
  if (!mc) { frag.appendChild(emptyMsg("No marker selected — mark a change to enable this view.")); return frag; }
  const grid = document.createElement("div");
  grid.className = "stat-grid";
  const ev = mc.evidence || mc;
  const before = ev.before || { value: 0 };
  const after = ev.after || { value: 0 };
  const change = ev.relative_change != null ? pct(ev.relative_change) : "—";
  const conf = mc.confidence || "—";
  grid.innerHTML = `
    <div class="stat-card"><span class="stat-label">Before</span><span class="stat-val">${tokShort(before.value)}</span><span class="stat-frame">avg tokens/session</span></div>
    <div class="stat-card"><span class="stat-label">After</span><span class="stat-val">${tokShort(after.value)}</span><span class="stat-frame">avg tokens/session</span></div>
    <div class="stat-card"><span class="stat-label">Change</span><span class="stat-val" style="color:var(${(ev.effect_size || 0) > 0 ? "--danger" : "--ok"})">${change > 0 ? "+" : ""}${change}%</span><span class="stat-frame">${mc.marker_title ? esc(mc.marker_title) : ""}</span></div>
    <div class="stat-card"><span class="stat-label">Confidence</span><span class="stat-val" style="font-size:var(--text-md)">${esc(conf)}</span><span class="stat-frame">${mc.sample_size || 0} sessions</span></div>`;
  frag.appendChild(grid);
  return frag;
}

function itemRow({ dotColor, head, detail, hint }) {
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `<div class="item-dot" style="background:${dotColor}"></div>
    <div class="item-body">
      <p class="item-head">${head}</p>
      ${detail ? `<p class="item-detail">${detail}</p>` : ""}
      ${hint ? `<p class="item-hint">${esc(hint)}</p>` : ""}
    </div>`;
  return row;
}

// ── Layer 5: Agent-ready prompt (the distilled report, reformatted as a copy-paste prompt) ──
function renderAgentPrompt(data) {
  const textEl = document.getElementById("agent-prompt-text");

  const lines = [];
  // Harness list is dynamic — machine-installed harnesses from /api/config (same machineHarnesses
  // cohort the setup cascade uses), not a static string. Falls back to the data's own harnesses.
  const installedNames = activePresentedHarnesses(window.__tokens2Config || {})
    .map((h) => h.displayName || h.id);
  const dataNames = [...new Set((data.harnesses || []).filter(Boolean))];
  const names = installedNames.length ? installedNames : dataNames;
  const harnessList = names.length ? formatHarnessList(names) : "my AI coding agent";
  lines.push(`I've been tracking token usage across my AI coding agent sessions (${harnessList}).`);
  lines.push("Below is my deterministic token telemetry report for the current period — every number comes from");
  lines.push("my actual tool-call captures, not estimates. I want to cut down token waste and cost without");
  lines.push("slowing down my workflow. Please:");
  lines.push("");
  lines.push("1. Identify the top 2-3 concrete changes I should make (e.g. scoping MCP queries tighter,");
  lines.push("   reading fewer/smaller files, stopping runaway tool loops, running targeted tests instead of");
  lines.push("   full suites). For each, quantify the expected token savings from the data below.");
  lines.push("2. Call out anything that looks anomalous or like a regression I may not have noticed.");
  lines.push("3. Suggest a measurement or marker I could set up to verify each change actually helped.");
  lines.push("");
  lines.push("=== TOKEN TELEMETRY REPORT ===");
  lines.push("");
  lines.push(`Period: ${(data.sessions || []).length} sessions, ${(data.capture_count || 0)} tool-call captures.`);
  const spikeCount = (data.spikes || []).length;
  if (spikeCount) lines.push(`Usage spikes: ${spikeCount} turns exceeded the ${tokShort(data.spike_threshold)} per-turn spike threshold (2σ above the mean).`);
  const sevenDay = data.usage_windows?.seven_day;
  if (sevenDay) lines.push(`Total usage: ${tokShort(sevenDay)} tokens over the trailing 7-day window.`);

  if (data.spike_causes?.length) {
    lines.push("");
    lines.push("What drove the spikes (with the recommended fix for each):");
    for (const c of data.spike_causes.slice(0, 5)) {
      lines.push(`  - ${causeLabel(c.cause)}: ${c.spikes} spike${c.spikes > 1 ? "s" : ""}, worst +${tokShort(c.worst_delta)} tokens in ${c.worst_repo || "unknown"} (avg ${tokShort(c.avg_delta)}/spike)`);
      if (c.hint) lines.push(`      Fix: ${c.hint}`);
    }
  }
  if (data.spike_anatomy?.groups?.length) {
    lines.push("");
    lines.push("Spike-prone tool groups (lift = how much more a group appears in spike turns vs normal turns):");
    for (const g of data.spike_anatomy.groups.slice(0, 6)) {
      lines.push(`  - ${g.group}: lift ${g.lift == null ? "only in spikes" : g.lift + "×"}, in ${pct(g.spike_share)}% of spike turns vs ${pct(g.normal_share)}% of normal turns (${tokShort(g.avg_tokens)} tokens/call in spikes)`);
      if (g.lift >= 1) lines.push(`      Fix: scope ${g.group} calls more narrowly (smaller query, fewer refs) before they land in context.`);
    }
  }
  if (data.loops?.length) {
    lines.push("");
    lines.push("Runaway tool loops (same tool fired many times consecutively in one session):");
    for (const l of data.loops.slice(0, 5)) {
      lines.push(`  - ${l.tool} fired ${l.max_repeat}× consecutively in ${l.repo}${l.context?.title ? ` (session: "${l.context.title}")` : ""}`);
      if (l.hint) lines.push(`      Fix: ${l.hint}`);
    }
  }
  if (data.read_warnings?.length) {
    lines.push("");
    lines.push("Context bloat from document reads (grouped by type):");
    const byType = new Map();
    for (const w of data.read_warnings) {
      if (!byType.has(w.type)) byType.set(w.type, []);
      byType.get(w.type).push(w);
    }
    for (const [type, list] of byType) {
      const tokens = list.reduce((s, w) => s + (w.approx_tokens || 0), 0);
      lines.push(`  - ${readWarningLabel(type)}: ${tokShort(tokens)} approx tokens across ${list.length} instance${list.length > 1 ? "s" : ""}`);
      for (const w of list.slice(0, 3)) {
        lines.push(`      · ${w.repo || "unknown"}: ${tokShort(w.approx_tokens)} tokens, ${w.read_count || 1} read${(w.read_count || 1) > 1 ? "s" : ""}`);
      }
      const hint = list[0]?.hint;
      if (hint) lines.push(`      Fix: ${hint}`);
    }
  }
  if (data.group_cost?.length) {
    lines.push("");
    lines.push("Tool-group cost as share of all tool tokens:");
    for (const g of data.group_cost.slice(0, 8)) {
      lines.push(`  - ${g.group}: ${Math.round((g.share_of_tokens || 0) * 100)}% of tool tokens (${tokShort(g.avg_tokens)}/call over ${g.calls} calls, ${tokShort(g.total_tokens)} total)`);
    }
  }
  if (data.testing_efficiency) {
    const te = data.testing_efficiency;
    const tokenShare = te["test.token_share"];
    const redundant = te["test.full_suite_without_intervening_edit"];
    if (tokenShare != null) {
      lines.push("");
      lines.push(`Testing: ${tokenShare}% of all captured tokens went to test runs.`);
      if (redundant != null && redundant > 0) {
        lines.push(`  - ${redundant.toFixed(1)} full-suite reruns per session happened without an intervening edit (likely redundant).`);
      }
    }
  }
  if (data.marker_comparison) {
    const ev = data.marker_comparison.evidence || {};
    const before = ev.before?.value, after = ev.after?.value;
    if (before != null && after != null) {
      lines.push("");
      lines.push(`Before vs after "${data.marker_comparison.cohort?.marker?.title || "the marked change"}": average tokens/session went ${tokShort(before)} → ${tokShort(after)} (${data.marker_comparison.confidence}).`);
    }
  }
  if (data.insights?.length) {
    lines.push("");
    lines.push("Deterministic findings from the analysis pipeline:");
    for (const f of data.insights) {
      lines.push(`  - [${f.severity}] ${f.headline}`);
      if (f.detail) lines.push(`      ${f.detail}`);
      if (f.next_action) lines.push(`      Suggested next step: ${f.next_action}`);
    }
  }

  const promptText = lines.join("\n");
  textEl.textContent = promptText;

  // Reusable shared copy button (<portal-copy-button>, same as plans/localhoster) — set the
  // copy source lazily; the element handles the copied-state UI itself.
  const copyBtn = document.getElementById("agent-prompt-copy");
  if (copyBtn) copyBtn.copySource = promptText;
}

// ── Layer 6: Full data (demoted) ──
function renderFullData(data) {
  const container = document.getElementById("fulldata-content");
  container.replaceChildren();

  // Data quality notice.
  if (data.data_quality_warnings?.length) {
    const notice = document.createElement("div");
    notice.className = "dq-notice";
    notice.innerHTML = `<span class="dq-icon">⚠</span><span>Data quality: ${data.data_quality_warnings.length} warning${data.data_quality_warnings.length > 1 ? "s" : ""} — some events may have incomplete token data. <a href="#" style="color:var(--accent);text-decoration:underline dotted">view details ›</a></span>`;
    container.appendChild(notice);
  }

  // Top sessions.
  if (data.sessions?.length) {
    container.appendChild(rawTable("Top sessions by tokens", ["session", "repo", "tokens", "captures"],
      data.sessions.slice(0, 10).map((s) => [
        { html: sessionLink(s.session_id, data, s.title || s.session_id?.slice(0, 8)) },
        esc(s.repo || "unknown"),
        { num: tokShort(s.total_tokens) },
        { num: s.captures || 0 },
      ]),
    ));
  }
  // Top tools.
  if (data.top_tools?.length) {
    container.appendChild(rawTable("Top tools by tokens", ["tool", "calls", "tokens"],
      data.top_tools.slice(0, 10).map((t) => [
        esc(t.key), { num: t.captures }, { num: tokShort(t.tokens) },
      ]),
    ));
  }

  // Top repos.
  if (data.top_repos?.length) {
    container.appendChild(rawTable("Top repos by tokens", ["repo", "captures", "tokens"],
      data.top_repos.slice(0, 10).map((r) => [
        esc(r.key), { num: r.captures }, { num: tokShort(r.tokens) },
      ]),
    ));
  }
}

function rawTable(title, headers, rows) {
  const div = document.createElement("div");
  div.className = "raw-table";
  const thead = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const tbody = rows.map((r) => `<tr>${r.map((c) => {
    // Trusted HTML (e.g. session chips with their tooltips) passes through as {html};
    // plain strings get escaped like everything else.
    if (typeof c === "object" && c !== null) {
      if (c.html != null) return `<td>${c.html}</td>`;
      if (c.num != null) return `<td class="num">${esc(String(c.num))}</td>`;
    }
    return `<td>${esc(String(c))}</td>`;
  }).join("")}</tr>`).join("");
  div.innerHTML = `<h3>${esc(title)}</h3><div class="raw-table-scroll"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
  return div;
}

// ── Session links: dynamic chip per session reference ──
// When the session exists in the report (data.sessions), render a chip with a rich tooltip of
// human-friendly session context (what it was about, what it did, where, when). When it doesn't,
// fall back to the plain static label. One code path — no per-session markup.
function sessionLink(sessionId, data, fallbackLabel) {
  const id = sessionId || "";
  const s = (data.sessions || []).find((x) => x.session_id === id);
  const label = fallbackLabel || id.slice(0, 8);
  if (!s) return `<span class="session-chip session-unknown"><code>${esc(label)}</code></span>`;
  const tipId = `sess-tip-${id.replace(/[^a-z0-9-]/gi, "-")}`;
  const when = new Date(s.first_ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const title = s.title ? esc(s.title) : "No opening prompt captured";
  return `<span class="session-chip info-wrap" data-tip-html="#${tipId}" tabindex="0"><code>${esc(label)}</code><template id="${tipId}">
    <span class="session-tip-content">
      <strong class="session-tip-title">${title}</strong>
      <span><strong>What it did</strong> ${esc(s.activity || "—")}</span>
      <span><strong>Where</strong> ${esc(s.repo || "unknown")}${s.branch ? ` · ${esc(s.branch)}` : ""} <span class="session-tip-dim">(${esc(s.harness || "unknown harness")})</span></span>
      <span><strong>When</strong> ${esc(when)}</span>
      <span><strong>Size</strong> ${tokShort(s.total_tokens)} tokens · ${s.captures} tool calls</span>
    </span>
  </template></span>`;
}

// One-time delegated listeners: waste-source links, "+N more" dropdown, sticky-header measure.
// Declared functions hoist, but the `let stickyHeaderOffset` they touch does not — so the call
// sits here, after every declaration, at module end.
wireWasteSourceLinks();

// ── Helpers ──
function emptyMsg(msg) {
  const div = document.createElement("div");
  div.className = "empty-msg";
  div.textContent = msg;
  return div;
}

function causeLabel(cause) {
  const labels = {
    "mcp-bundle": "MCP bundle too large",
    "context-accumulation": "Context accumulation across many turns",
    "large-file-read": "Large file read",
    "unbounded-bash-output": "Unbounded Bash output",
    "big-prompt": "Large prompt",
    "large-tool-output": "Large tool output",
  };
  return labels[cause] || cause;
}

function readWarningLabel(type) {
  const labels = {
    "large_document_read": "Large document read",
    "repeated_document_read": "Repeated document read",
    "stale_doc_lookup": "Stale doc lookup",
    "mixed_code_lookup": "Mixed code lookup",
  };
  return labels[type] || type;
}

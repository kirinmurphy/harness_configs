// Pure data/logic for the Config page — no DOM here. app.js owns wiring DOM events to this
// module's functions; templates.js owns turning its output into markup.

import { formatTokens } from "/portal/shared/token-chip.js";
export { formatTokens };

export const TOGGLE_ENDPOINT = {
  package: "/api/config/packages",
  skill: "/api/config/skills",
};

export const SECTION_TEMPLATE_ID = {
  "Token Optimization": "tpl-section-token-optimization",
  Commands: "tpl-section-commands",
  "Code Conventions": "tpl-section-code-conventions",
  "Chat-Time Output": "tpl-section-chat-time-output",
};

export const BUCKETS = ["deny", "ask", "allow"];

// Root-config drift chip shown beside settings.json / config.toml. Driven by snap.rootConfig, which
// the server computes once (buildRootConfigView in config.mjs) so terminal and web agree. "in-sync"
// and "not-installed" are the quiet default — no chip — so the chip only appears when there is
// something the user might want to act on (drift, a staged update, or an untracked file).
export const DRIFT_CHIP = {
  drifted: { label: "drifted", cls: "drift-warn", title: "Changed since roborepo's last write. Run `roborepo update` to reconcile." },
  "staged-pending": { label: "update staged", cls: "drift-info", title: "A new baseline is staged beside this file, waiting for you to reconcile it." },
  unwritten: { label: "untracked", cls: "drift-muted", title: "No recorded roborepo write yet (pre-dates drift tracking, or not installed via roborepo)." },
};

export function resolveDriftChip(rootConfig, harness) {
  const driftByHarness = new Map((rootConfig || []).map((r) => [r.harness, r]));
  const row = driftByHarness.get(harness);
  return row && DRIFT_CHIP[row.state];
}

export function snapshotChanged(prevSignature, snap) {
  const sig = JSON.stringify(snap);
  return sig !== prevSignature ? sig : null;
}

// ------------------------------------------------------------------ context cost (estimates)

function levelFor(tokens, thresholds) {
  if (!thresholds || !Number.isFinite(tokens)) return null;
  if (tokens < thresholds.mediumAt) return "low";
  if (tokens > thresholds.highAbove) return "high";
  return "medium";
}

// Chip spec for one harness's startup total in the "Tokens used in config" bar: colored by the
// startup scale, tooltip carries the contributing-amount table.
export function harnessChipSpec(contextCost, harnessId) {
  const harness = contextCost?.harnesses?.[harnessId];
  if (!harness) return null;
  const b = harness.breakdown || {};
  const discovery = harness.startupTokens - (b.rulesTokens || 0);
  return {
    tokens: harness.startupTokens,
    level: harness.level,
    detail: "Included automatically in every new chat.",
    breakdown: [
      { label: "System rules", tokens: b.coreBaselineTokens || 0 },
      { label: "Package rule snippets", tokens: b.packageRulesTokens || 0 },
      { label: "Skill discovery descriptions", tokens: discovery },
    ],
    legend: contextCost.thresholds,
  };
}

// Chip spec for one harness's rendered rules file (CLAUDE.md / AGENTS.md), on the same startup
// color scale as the summary chips.
export function rulesChipSpec(contextCost, harnessId) {
  const harness = contextCost?.harnesses?.[harnessId];
  if (!harness) return null;
  const rulesTokens = harness.breakdown?.rulesTokens ?? harness.startupTokens;
  return {
    tokens: rulesTokens,
    level: levelFor(rulesTokens, contextCost.thresholds),
    detail: "Rendered rules, loaded at chat start.",
    legend: contextCost.thresholds,
  };
}

// Labeled chip specs for the source-inspect modal's dedicated cost row: what does the thing
// being viewed cost? Always returns an array of { label, spec } so the row can render
// "Startup: [chip]  When loaded: [chip]" — the moment-of-cost distinction lives in the label,
// never inside the chip's own text. live-rules → one "Startup" chip for that harness's rendered
// rules; skills/commands → separate Startup (discovery) and When loaded/When run entries; rules
// fragments → one Startup entry.
export function inspectChipSpecs(inspect, itemCost, snap) {
  const contextCost = snap?.contextCost;
  if (!inspect || !contextCost) return [];
  if (inspect.kind === "live-rules") {
    const spec = rulesChipSpec(contextCost, inspect.harness || "claude");
    return spec ? [{ label: "Startup", spec }] : [];
  }
  if (!itemCost) return [];
  if (inspect.kind === "skill" || inspect.kind === "command-skill") {
    const entries = [];
    if (itemCost.startupTokens > 0) {
      entries.push({
        label: "Startup",
        spec: {
          tokens: itemCost.startupTokens,
          level: levelFor(itemCost.startupTokens, contextCost.thresholds),
          detail: "Discovery metadata, loaded at chat start while enabled.",
          legend: contextCost.thresholds,
        },
      });
    }
    if (itemCost.onDemandTokens > 0) {
      const isCommand = inspect.kind === "command-skill";
      entries.push({
        label: isCommand ? "When run" : "When loaded",
        spec: {
          tokens: itemCost.onDemandTokens,
          level: itemCost.onDemandLevel || null,
          detail: isCommand ? "Loaded when the command runs." : "Loaded when the skill is invoked.",
          legend: contextCost.onDemandThresholds,
        },
      });
    }
    return entries;
  }
  if (inspect.kind === "rules") {
    if (!(itemCost.startupTokens > 0)) return [];
    return [{
      label: "Startup",
      spec: {
        tokens: itemCost.startupTokens,
        level: levelFor(itemCost.startupTokens, contextCost.thresholds),
        detail: "Included at chat start while enabled.",
        legend: contextCost.thresholds,
      },
    }];
  }
  return [];
}

// Chip specs for one behaviorView item row. Warning-only: a chip appears ONLY for medium/high
// cost (never low/green) — the row list is meant to flag notable cost, not restate every
// package's size. Returns { spec, label } pairs consumed by <token-chip> directly.
export function contextCostChipSpecs(item, contextCost) {
  const cost = item.contextCost;
  if (!cost || !contextCost) return [];
  const chips = [];
  const isCommand = item.inspect?.kind === "command-skill";
  const differNote = cost.harnessesDiffer ? " Claude and Codex costs differ; the larger is shown." : "";

  if (cost.onDemandTokens > 0 && cost.onDemandLevel && cost.onDemandLevel !== "low") {
    chips.push({
      label: isCommand ? "When run" : "When loaded",
      spec: {
        tokens: cost.onDemandTokens,
        level: cost.onDemandLevel,
        detail: (isCommand ? "Loaded when the command runs." : "Loaded when the skill is invoked.") + differNote,
        legend: contextCost.onDemandThresholds,
      },
    });
  } else if (cost.startupTokens > 0 && cost.startupLevel && cost.startupLevel !== "low") {
    chips.push({
      label: "Startup",
      spec: {
        tokens: cost.startupTokens,
        level: cost.startupLevel,
        detail: "Included at chat start while enabled." + differNote,
        legend: contextCost.thresholds,
      },
    });
  }
  return chips;
}

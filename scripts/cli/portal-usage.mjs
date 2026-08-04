// Execution layer for the /api/usage route: read each harness's latest snapshot, assess it with the
// SAME domain functions the status line uses (no duplicated thresholds), and shape a JSON-safe,
// leak-free view. Kept separate from portal-routes-usage.mjs so the route stays a thin HTTP shim.
import { readLatestSnapshot } from "../../globals/packages/usage-statusline/scripts/usage-snapshot-store.mjs";
import { assessUsage } from "../../globals/packages/usage-statusline/scripts/usage-domain.mjs";
import { harnessIdsWithCapability } from "./rules-render.mjs";

// Usage snapshots come from the usage-statusline package's status-line integration, which is
// delivered as a harness-config resource — so a harness has usage to show exactly when it supports
// package-config. Derived from the provider manifests rather than listed literally, so a new
// provider appears here when it declares the capability, and one that cannot host the status line
// (Gemini CLI today) is absent by contract rather than by an omission someone has to remember.
//
// Deliberately NOT telemetry-rate-limits: that capability describes parsing rate-limit headers out
// of transcripts (Codex only), which is a different subsystem from the status-line snapshot store
// this route reads. Claude writes usage snapshots without declaring it.
const HARNESSES = harnessIdsWithCapability("package-config");

// A window's public shape: used + severity always; pacing fields only when elapsed was computable.
function windowView(assessed) {
  if (!assessed.available) return null;
  const view = { usedPercent: assessed.usedPercent, usedSeverity: assessed.usedSeverity };
  if (assessed.elapsedPercent === undefined) return view;
  view.elapsedPercent = assessed.elapsedPercent;
  view.balance = assessed.balance.state === "unavailable"
    ? { state: "unavailable" }
    : { state: assessed.balance.state, magnitude: assessed.balance.magnitude };
  view.debtSeverity = assessed.balance.debtSeverity || "normal";
  return view;
}

// Assemble one harness entry. Only normalized/assessed values escape — never raw payloads, home
// paths, auth data, or the snapshot's `source` diagnostics block.
function harnessView(harness, { now }) {
  const result = readLatestSnapshot(harness, { now });
  if (!result.available) return { available: false, reason: result.reason };
  const assessed = assessUsage(result.snapshot, { now });
  const usage = {};
  if (assessed.context.available) {
    usage.context = { usedPercent: assessed.context.usedPercent, severity: assessed.context.usedSeverity };
  }
  const weekly = windowView(assessed.windows.weekly);
  if (weekly) usage.weekly = weekly;
  const fiveHour = windowView(assessed.windows.fiveHour);
  if (fiveHour) usage.fiveHour = fiveHour;
  return { available: true, freshness: result.freshness, usage };
}

export function buildUsageResponse({ now = Date.now() } = {}) {
  const harnesses = Object.fromEntries(HARNESSES.map((h) => [h, harnessView(h, { now })]));
  return { schema: 1, generatedAt: new Date(now).toISOString(), harnesses };
}

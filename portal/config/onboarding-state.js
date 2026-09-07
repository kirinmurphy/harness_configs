import {
  activePresentedHarnesses,
} from "../shared/harness-cohort.js";

// Backward-compatible shim: the banner's single source of truth now lives in
// /portal/shared/harness-warning.js (shared with the Tokens page). Re-exported here so existing
// importers (config/templates.js, config-onboarding-state-check.mjs) keep working.
export { harnessWarningSpec as configHarnessWarning } from "../shared/harness-warning.js";

export function hasOptionalPackageSelected(snap) {
  return (snap?.packages || []).some(
    (pkg) => pkg.enabled === true && pkg.defaultEnabled !== true,
  );
}

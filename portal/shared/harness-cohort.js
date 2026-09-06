// Which harnesses a surface should present, and how to name a set of them.
//
// Lives in portal/shared/ with no DOM or browser-absolute imports so both the portal page and a
// Node test can load it. The portal's own template modules import "/portal/shared/api.js" by
// absolute URL and are therefore unimportable outside a browser; keeping this policy separate is
// what makes the zero/one/N contract directly testable instead of only observable by eye.
//
// Two cohorts exist in the config snapshot and they mean different things:
//   harnesses        - every registered provider roborepo supports, installed here or not.
//                      Correct for per-provider file metadata and supported-provider copy.
//   machineHarnesses - what persisted discovery found on THIS machine, each with its enabled flag.
//                      Correct for any primary user-facing presentation.
// Rendering the first where the second belongs tells a user with nothing installed that they have
// three agent harnesses, which is the defect this module exists to prevent.

export function presentedHarnesses(snap) {
  const catalog = snap?.harnesses || [];
  // An older snapshot without the field falls back to the catalog: showing the previous (wrong but
  // populated) view beats rendering an empty grid on a machine that does have harnesses.
  if (!Array.isArray(snap?.machineHarnesses)) return catalog;

  const byId = new Map(catalog.map((harness) => [harness.id, harness]));
  return snap.machineHarnesses
    .map((machine) => {
      const entry = byId.get(machine.id);
      return entry ? { ...entry, ...machine } : null;
    })
    .filter(Boolean);
}

export function activePresentedHarnesses(snap) {
  return presentedHarnesses(snap).filter((harness) => {
    if (harness.enabled === false) return false;
    // Discovery-confidence gate: an entry is only INSTALLED when discovery reached "confirmed"
    // (validated executable AND recognized config/home — scripts/harnesses/discovery.mjs). A
    // bare executable on PATH is "probable": the binary may belong to an unrelated tool, and
    // config/home evidence alone is "possible" (stray dirs outlive their tool). Counting either
    // as installed made the tokens pages skip their demo state on machines with no real setup.
    // Entries without a confidence field (legacy snapshots, the catalog fallback) stay included —
    // gating only applies where discovery actually ran.
    if (!harness.confidence) return true;
    return harness.confidence === "confirmed";
  });
}

// "Claude Code", "Claude Code and Codex", "Claude Code, Codex, and Gemini CLI".
export function formatHarnessList(names) {
  if (names.length === 0) return "";
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

export function supportedHarnessNames(snap) {
  return formatHarnessList((snap?.harnesses || []).map((harness) => harness.displayName));
}

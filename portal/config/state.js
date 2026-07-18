// Pure data/logic for the Config page — no DOM here. app.js owns wiring DOM events to this
// module's functions; templates.js owns turning its output into markup.

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

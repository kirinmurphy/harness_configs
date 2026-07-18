import { buildRootConfigView, ROOT_CONFIG_STATE_LABEL } from "./root-config-view.mjs";

// Read-only report of baseline vs. active root config vs. drift state, per harness. No writes —
// see docs/plans/completed/root-config-layered-inheritance.md for the update/repair behavior that acts on
// this same drift signal.
export function configRootInspect() {
  for (const row of buildRootConfigView()) {
    console.log(`\n${row.harness}`);
    console.log(`  baseline: ${row.baseline}${row.baselineExists ? "" : "  (missing)"}`);
    console.log(`  active:   ${row.active}${row.activeExists ? "" : "  (missing)"}`);
    console.log(`  status:   ${ROOT_CONFIG_STATE_LABEL[row.state] ?? row.state}`);
    if (row.state === "drifted") {
      console.log(`  last-known hash:  ${row.lastHash}`);
      console.log(`  current hash:     ${row.currentHash}`);
      console.log(`  run \`roborepo update\` to resolve — see docs/reference/internal/config-collision-handling.md`);
      // Codex owns a native profile mechanism for permanent personal config; point drifted Codex
      // users at it instead of re-drifting the managed baseline every update. Claude has no
      // equivalent, so this hint is Codex-only. See config-collision-handling.md "Codex Native Profiles".
      if (row.harness === "codex") {
        console.log(`  for a permanent personal slice, use a Codex profile (~/.codex/<name>.config.toml, --profile <name>)`);
      }
    }
    if (row.stagedUpdate) {
      console.log(`  staged update:    ${row.stagedUpdate}`);
    }
  }
  console.log("");
}

// Renders the behaviorView (from buildBehaviorView) as the `roborepo config status` terminal report.
export function printConfigStatus(view) {
  const check = (v) => (v ? "[x]" : "[ ]");

  for (const section of view) {
    const header = section.description
      ? `\n${section.category}  (${section.description})`
      : `\n${section.category}`;
    console.log(header);
    for (const item of section.items) {
      if (item.kind === "behavior") {
        const override = item.overridden ? `  (custom, default: ${item.defaultBucket})` : "";
        const codexNote = item.codexOnly ? "  [Codex only]" : item.noCodexAsk ? "  [no per-command ask on Codex]" : "";
        console.log(`  ${item.bucket.padEnd(6)} ${item.label}${override}${codexNote}`);
        if (item.description) console.log(`         ${item.description}`);
      } else if (item.kind === "arbitrary-list") {
        console.log(`  ${item.label}`);
        if (item.description) console.log(`    ${item.description}`);
        const show = (item.items || []).slice(0, 5);
        for (const c of show) {
          const override = c.overridden ? "  (custom)" : "";
          console.log(`    ${c.bucket.padEnd(6)} ${c.label}${override}`);
        }
        if ((item.items || []).length > 5) console.log(`    … (${item.items.length - 5} more — see: roborepo web)`);
      } else if (item.kind === "info") {
        console.log(`  ${item.label}`);
        if (item.description) console.log(`    ${item.description}`);
      } else if (item.kind === "expandable") {
        console.log(`  ${item.label}`);
        if (item.detail?.length) {
          const show = item.detail.slice(0, 5);
          for (const d of show) console.log(`    · ${d}`);
          if (item.detail.length > 5) console.log(`    … (${item.detail.length - 5} more)`);
        }
      } else {
        const badges = item.badges?.length ? "  " + item.badges.map((b) => `[${b}]`).join(" ") : "";
        console.log(`  ${check(item.active)} ${item.label}${badges}`);
        if (item.description) console.log(`      ${item.description}`);
        if (!item.active && item.hint) console.log(`      → ${item.hint}`);
      }
    }
    if (section.footnote) console.log(`\n  * ${section.footnote}`);
  }

  console.log("");
}

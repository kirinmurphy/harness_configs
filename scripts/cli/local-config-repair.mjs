import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rootConfigActive, rootConfigBaseline } from "./paths.mjs";
import { mergeRootConfig } from "./root-config-merge.mjs";
import { recordWrite } from "./root-config-state.mjs";

const HARNESS_LABEL = {
  claude: "Claude settings",
  codex: "Codex config",
};

const MARKER_LINES = new Set([
  "# BEGIN GENERATED AGENT PERMISSIONS",
  "# Source: manifests/inventory/agent-permissions.json",
  "# END GENERATED AGENT PERMISSIONS",
]);

function usage() {
  console.error("usage: roborepo repair local-config [--dry-run|--apply|--check|--hint]");
}

export function localConfigRepairCommand(args = []) {
  const mode = parseMode(args);
  const plans = buildLocalConfigRepairPlans();

  if (mode === "check") {
    if (plans.length) {
      printHint(plans, { prefix: "fail" });
      process.exit(1);
    }
    console.log("ok: local config repair not needed");
    return;
  }

  if (mode === "hint") {
    if (plans.length) printHint(plans, { prefix: "hint" });
    return;
  }

  if (!plans.length) {
    console.log("ok: local config repair not needed");
    return;
  }

  printPlan(plans, mode);
  if (mode === "apply") applyPlans(plans);
}

function parseMode(args) {
  let mode = "dry-run";
  for (const arg of args) {
    switch (arg) {
      case "--dry-run": mode = "dry-run"; break;
      case "--apply": mode = "apply"; break;
      case "--check": mode = "check"; break;
      case "--hint": mode = "hint"; break;
      case "-h":
      case "--help":
        usage();
        process.exit(0);
      default:
        usage();
        process.exit(2);
    }
  }
  return mode;
}

export function buildLocalConfigRepairPlans() {
  return Object.keys(rootConfigActive).map(buildHarnessPlan).filter(Boolean);
}

function buildHarnessPlan(harness) {
  const activePath = rootConfigActive[harness];
  const baselinePath = rootConfigBaseline[harness];
  if (!fs.existsSync(activePath) || !fs.existsSync(baselinePath)) return null;

  const activeText = fs.readFileSync(activePath, "utf8");
  const baselineText = fs.readFileSync(baselinePath, "utf8");
  const backups = backupCandidates(harness, activePath);
  const activeNormalized = normalizeGeneratedMarkers(activeText);
  const issues = [];
  if (activeNormalized !== activeText) issues.push("remove duplicated generated marker lines");

  for (const backup of backups.slice(0, 1)) {
    const backupText = fs.readFileSync(backup.path, "utf8");
    const backupMerged = mergeRootConfig(harness, baselineText, backupText);
    const repaired = normalizeGeneratedMarkers(mergeRootConfig(harness, backupMerged, activeText));
    if (repaired === activeText) continue;
    const backupIssues = issues.slice();
    if (repaired !== activeNormalized) {
      backupIssues.push(`recover local-only settings from ${backup.path}`);
    }
    return repairPlan(harness, activePath, repaired, backupIssues);
  }

  if (activeNormalized !== activeText) {
    return repairPlan(harness, activePath, activeNormalized, issues);
  }
  return null;
}

function repairPlan(harness, activePath, repaired, issues) {
  return { harness, label: HARNESS_LABEL[harness] || harness, activePath, repaired, issues };
}

function backupCandidates(harness, activePath) {
  const dir = path.dirname(activePath);
  const ext = path.extname(activePath);
  const stem = path.basename(activePath, ext);
  const prefix = `${stem}_original_`;
  const suffix = ext;
  const candidates = [];

  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(prefix) || !name.endsWith(suffix)) continue;
      const file = path.join(dir, name);
      candidates.push({ path: file, mtimeMs: fs.statSync(file).mtimeMs });
    }
  } catch {}

  const preInstall = path.join(os.homedir(), ".roborepo", "backups", "pre-install", harness, path.basename(activePath));
  if (fs.existsSync(preInstall)) {
    candidates.push({ path: preInstall, mtimeMs: fs.statSync(preInstall).mtimeMs });
  }

  return candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function normalizeGeneratedMarkers(text) {
  const seen = new Set();
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (MARKER_LINES.has(line.trim())) {
      if (seen.has(line.trim())) continue;
      seen.add(line.trim());
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
}

function printHint(plans, { prefix }) {
  const harnesses = plans.map((plan) => plan.harness).join(", ");
  console.log(`${prefix}: local config repair candidates found (${harnesses}).`);
  console.log("      Run: roborepo repair local-config --dry-run");
}

function printPlan(plans, mode) {
  console.log(mode === "apply" ? "Applying local config repair:" : "Local config repair dry-run:");
  for (const plan of plans) {
    console.log(`  ${plan.label}: ${plan.activePath}`);
    for (const issue of plan.issues) console.log(`    - ${issue}`);
    if (mode !== "apply") console.log("    would write repaired local config");
  }
}

function applyPlans(plans) {
  const ts = process.env.ROBOREPO_INSTALL_TIMESTAMP || timestamp();
  for (const plan of plans) {
    const backupPath = repairBackupPath(plan.activePath, ts);
    fs.copyFileSync(plan.activePath, backupPath);
    fs.writeFileSync(plan.activePath, plan.repaired);
    recordWrite(plan.harness, plan.activePath);
    console.log(`backup: ${plan.activePath} -> ${backupPath}`);
    console.log(`repair: ${plan.activePath}`);
  }
}

function repairBackupPath(activePath, ts) {
  const ext = path.extname(activePath);
  const stem = path.basename(activePath, ext);
  const dir = path.dirname(activePath);
  let candidate = path.join(dir, `${stem}_repair_${ts}${ext}`);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}_repair_${ts}.${i}${ext}`);
    i += 1;
  }
  return candidate;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) localConfigRepairCommand(process.argv.slice(2));

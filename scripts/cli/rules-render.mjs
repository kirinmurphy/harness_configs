import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./paths.mjs";
import { enabledPackagesPath } from "./state-paths.mjs";

const PACKAGES_PATH = path.join(repoRoot, "manifests", "inventory", "packages.json");

// Rule fragment source directories per harness, in render order.
const RULE_DIRS = {
  claude: ["globals/rules/shared", "globals/rules/claude"],
  codex: ["globals/rules/shared", "globals/rules/codex"],
};

const HOME_RULES = {
  claude: path.join(os.homedir(), ".claude", "CLAUDE.md"),
  codex: path.join(os.homedir(), ".codex", "AGENTS.md"),
};

// Marker that distinguishes roborepo render output from user-authored content.
const RENDER_HEADER = "# Generated Harness Rules";

// --------------------------------------------------------------------------- registry

// Returns { exists: boolean, packages: string[] }. `exists` distinguishes "no registry yet"
// (pre-Phase-3, fall back to text scan in config.mjs) from "registry exists but empty".
export function readEnabledPackagesRegistry() {
  try {
    const data = JSON.parse(fs.readFileSync(enabledPackagesPath, "utf8"));
    return { exists: true, packages: Array.isArray(data.packages) ? data.packages : [] };
  } catch {
    return { exists: false, packages: [] };
  }
}

function writeRegistry(ids) {
  fs.mkdirSync(path.dirname(enabledPackagesPath), { recursive: true });
  fs.writeFileSync(enabledPackagesPath, JSON.stringify(
    { packages: [...new Set(ids)], updatedAt: new Date().toISOString() },
    null, 2,
  ) + "\n");
}

// Add or remove a package ID from the enabled-packages registry, then return the updated list.
export function setPackageEnabled(id, enabled) {
  const { packages } = readEnabledPackagesRegistry();
  const next = enabled
    ? [...new Set([...packages, id])]
    : packages.filter((x) => x !== id);
  writeRegistry(next);
  return next;
}

// --------------------------------------------------------------------------- render

function squashBlankLines(text) {
  return text.replace(/\n{3,}/g, "\n\n");
}

// True when the file is a roborepo render output (not user-authored content). Used by install/
// uninstall to tell roborepo-owned files from genuine user files.
export function isRenderedRulesOutput(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) return false;
    const head = fs.readFileSync(filePath, "utf8").slice(0, RENDER_HEADER.length);
    return head === RENDER_HEADER;
  } catch {
    return false;
  }
}

function renderContent(harness, enabledIds) {
  const catalog = JSON.parse(fs.readFileSync(PACKAGES_PATH, "utf8")).packages;
  const parts = [];

  // Header matches render-rules.sh so the format is recognizable.
  parts.push(RENDER_HEADER);
  parts.push("");
  parts.push("Generated from `globals/rules/shared/` and harness-specific `globals/rules/<harness>/` fragments.");
  parts.push("Enabled packages are appended. Run `roborepo update` to refresh.");
  parts.push("");

  for (const dir of RULE_DIRS[harness]) {
    const absDir = path.join(repoRoot, dir);
    if (!fs.existsSync(absDir)) continue;
    for (const file of fs.readdirSync(absDir).filter((f) => f.endsWith(".md")).sort()) {
      const content = fs.readFileSync(path.join(absDir, file), "utf8");
      parts.push("");
      parts.push(squashBlankLines(content).trimEnd());
      parts.push("");
    }
  }

  for (const pkg of catalog) {
    if (!enabledIds.includes(pkg.id)) continue;
    for (const comp of pkg.components) {
      if (comp.type !== "rules") continue;
      if (comp.harness !== "both" && comp.harness !== harness) continue;
      const content = fs.readFileSync(path.join(repoRoot, comp.source), "utf8");
      parts.push("");
      parts.push(squashBlankLines(content).trimEnd());
      parts.push("");
    }
  }

  return squashBlankLines(parts.join("\n")).trimEnd() + "\n";
}

// Pre-install backup path for a harness rules file. Mirrors the path save_pre_install_backup in
// install-lib.sh uses, so bash and Node uninstall restore from the same location.
function preInstallBackupPath(harness, fileName) {
  return path.join(os.homedir(), ".roborepo", "backups", "pre-install", harness, fileName);
}

function copyTree(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const stat = fs.lstatSync(source);
  if (stat.isDirectory()) {
    fs.cpSync(source, target, { recursive: true, preserveTimestamps: true });
  } else {
    fs.copyFileSync(source, target);
  }
}

// Write rendered home rules for one or all harnesses:
//   - Unlinks any legacy symlink into the repo first.
//   - Backs up a genuine user-authored file (no render header) to pre-install location if needed.
//   - Writes the rendered content (base + enabled packages from registry).
// Skips harnesses whose home dir does not exist (harness not installed on this machine).
export function renderHomeRules({ dryRun = false, harness: targetHarness } = {}) {
  const registry = readEnabledPackagesRegistry();
  if (!registry.exists && !dryRun) writeRegistry([]);
  const enabledIds = registry.packages;
  const harnesses = targetHarness ? [targetHarness] : Object.keys(HOME_RULES);

  for (const harness of harnesses) {
    const homeFile = HOME_RULES[harness];
    const homeDir = path.dirname(homeFile);
    if (!fs.existsSync(homeDir)) continue;

    // Unlink a legacy symlink into the repo.
    let linkTarget = null;
    try { linkTarget = fs.lstatSync(homeFile).isSymbolicLink() ? fs.readlinkSync(homeFile) : null; } catch {}
    if (linkTarget) {
      const resolved = path.resolve(path.dirname(homeFile), linkTarget);
      if (resolved === repoRoot || resolved.startsWith(`${repoRoot}${path.sep}`)) {
        if (dryRun) {
          console.log(`[dry-run] would cleanup legacy symlink: ${homeFile}`);
        } else {
          fs.unlinkSync(homeFile);
          console.log(`cleanup: ${homeFile}`);
        }
      }
    }

    // Back up a genuine pre-roborepo user file (not a render output, not already backed up).
    const fileExists = fs.existsSync(homeFile) && !fs.lstatSync(homeFile).isSymbolicLink();
    if (fileExists && !isRenderedRulesOutput(homeFile)) {
      const backupPath = preInstallBackupPath(harness, path.basename(homeFile));
      if (!fs.existsSync(backupPath)) {
        if (dryRun) {
          console.log(`[dry-run] would pre-install backup: ${homeFile} -> ${backupPath}`);
        } else {
          copyTree(homeFile, backupPath);
          console.log(`pre-install backup: ${homeFile} -> ${backupPath}`);
        }
      }
    }

    if (dryRun) {
      console.log(`[dry-run] would render: ${homeFile}`);
      continue;
    }

    const content = renderContent(harness, enabledIds);
    fs.mkdirSync(homeDir, { recursive: true });
    fs.writeFileSync(homeFile, content);
    console.log(`render: ${homeFile}`);
  }
}

// Check whether present home rules files match the current render (base + enabled registry).
// Returns true if all present harnesses are current. Prints ok/fail lines to stdout/stderr.
export function checkHomeRules({ quiet = false } = {}) {
  const { packages: enabledIds } = readEnabledPackagesRegistry();
  let ok = true;
  for (const [harness, homeFile] of Object.entries(HOME_RULES)) {
    if (!fs.existsSync(path.dirname(homeFile))) continue;
    if (!fs.existsSync(homeFile)) {
      console.error(`fail: ${homeFile} missing`);
      ok = false;
      continue;
    }
    const expected = renderContent(harness, enabledIds);
    const actual = fs.readFileSync(homeFile, "utf8");
    if (actual === expected) {
      if (!quiet) console.log(`ok: ${homeFile}`);
    } else {
      console.error(`fail: ${homeFile} out of date (run roborepo update to refresh)`);
      ok = false;
    }
  }
  return ok;
}

export function renderedRulesMatches(harness, filePath) {
  try {
    const { packages: enabledIds } = readEnabledPackagesRegistry();
    return fs.readFileSync(filePath, "utf8") === renderContent(harness, enabledIds);
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------- CLI entry

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const checkMode = args.includes("--check") || args.includes("check");
  const harness = args.find((a) => a === "claude" || a === "codex");
  if (checkMode) {
    process.exit(checkHomeRules({ quiet: args.includes("--quiet") }) ? 0 : 1);
  } else if (args.includes("--matches")) {
    const file = args[args.indexOf("--matches") + 1];
    if (!harness || !file) {
      console.error("usage: rules-render.mjs <claude|codex> --matches <file>");
      process.exit(2);
    }
    process.exit(renderedRulesMatches(harness, file) ? 0 : 1);
  } else {
    renderHomeRules({ dryRun, harness });
  }
}

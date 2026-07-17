import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { packageMode, repoRoot, harnessHome } from "./paths.mjs";
import { enabledPackagesPath } from "./state-paths.mjs";
import { buildLocalConfigRepairPlans } from "./local-config-repair.mjs";

const HARNESS_HOME = harnessHome;

const MANAGED_MARKER = ".roborepo-managed";

export function runUpdateWithReport(commandConfig, args) {
  const { installArgs, verbose } = parseReportArgs(args);
  const before = snapshotInstallState();
  const result = runInstall(commandConfig, installArgs);
  if (result.status === 0) {
    printUpdateReport(before, snapshotInstallState(), { verbose });
  }
  process.exit(result.status ?? 1);
}

function parseReportArgs(args) {
  const installArgs = [];
  let verbose = process.env.ROBOREPO_UPDATE_VERBOSE === "1";
  for (const arg of args) {
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    installArgs.push(arg);
  }
  return { installArgs, verbose };
}

function runInstall(commandConfig, args) {
  if (!commandConfig?.path || commandConfig.runtime !== "bash") {
    console.error("invalid update command config");
    process.exit(1);
  }

  const script = path.join(repoRoot, commandConfig.path);
  if (!fs.existsSync(script)) {
    console.error(`missing script: ${script}`);
    process.exit(1);
  }

  const result = spawnSync("bash", [script, ...args], {
    stdio: "inherit",
    env: { ...process.env, ...(packageMode ? { ROBOREPO_PACKAGE_MODE: "1" } : {}) },
  });
  if (result.error) {
    console.error(`failed to run ${commandConfig.path}: ${result.error.message}`);
    process.exit(1);
  }
  return result;
}

function snapshotInstallState() {
  const rows = readManifestRows();
  return {
    copied: snapshotManifestRows(rows, "managed_copy"),
    rootConfig: snapshotManifestRows(rows, "root_config"),
    renderedRules: snapshotManifestRows(rows, "rendered_rules"),
    hooks: snapshotNamedRows(rows, new Set(["hooks", "hooks.json"])),
    permissions: snapshotNamedRows(rows, new Set(["rules"])),
    packageRegistry: fileDigest(enabledPackagesPath),
    skills: snapshotManagedSkills(),
  };
}

function readManifestRows() {
  const manifest = path.join(repoRoot, "manifests", "platform", "manifest.tsv");
  const lines = fs.readFileSync(manifest, "utf8").split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [harness, kind, srcRel, homeSub] = line.split("\t");
    if (!HARNESS_HOME[harness] || !kind || !homeSub) continue;
    rows.push({
      harness,
      kind,
      srcRel,
      homeSub,
      homeAbs: path.join(HARNESS_HOME[harness], homeSub),
    });
  }
  return rows;
}

function snapshotManifestRows(rows, kind) {
  return rows
    .filter((row) => row.kind === kind)
    .map((row) => ({
      key: `${row.harness}:${row.homeSub}`,
      label: labelForRow(row),
      digest: pathDigest(row.homeAbs),
    }));
}

function snapshotNamedRows(rows, names) {
  return rows
    .filter((row) => names.has(row.homeSub))
    .map((row) => ({
      key: `${row.harness}:${row.homeSub}`,
      label: labelForRow(row),
      digest: pathDigest(row.homeAbs),
    }));
}

function labelForRow(row) {
  if (row.kind === "rendered_rules") return `rules ${row.harness}`;
  if (row.kind === "root_config") return `root config ${row.harness}`;
  if (row.homeSub === "hooks" || row.homeSub === "hooks.json") return `hooks ${row.harness}`;
  if (row.homeSub === "rules") return `permissions ${row.harness}`;
  return `${row.homeSub.replaceAll("/", " ")} ${row.harness}`;
}

function snapshotManagedSkills() {
  const entries = [];
  for (const [harness, home] of Object.entries(HARNESS_HOME)) {
    const skillsDir = path.join(home, "skills");
    if (!fs.existsSync(skillsDir)) continue;
    for (const name of fs.readdirSync(skillsDir).sort()) {
      const skillDir = path.join(skillsDir, name);
      if (!fs.existsSync(path.join(skillDir, MANAGED_MARKER))) continue;
      entries.push({
        key: `${harness}:${name}`,
        label: `skill ${name} ${harness}`,
        digest: pathDigest(skillDir),
      });
    }
  }
  return entries;
}

function fileDigest(file) {
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) return `link:${fs.readlinkSync(file)}`;
    if (!stat.isFile()) return pathDigest(file);
    return hashParts(["file", fs.readFileSync(file)]);
  } catch {
    return "missing";
  }
}

function pathDigest(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return `link:${fs.readlinkSync(target)}`;
    if (stat.isFile()) return fileDigest(target);
    if (!stat.isDirectory()) return `other:${stat.size}:${stat.mtimeMs}`;
    const parts = ["dir"];
    walkDir(target, target, parts);
    return hashParts(parts);
  } catch {
    return "missing";
  }
}

function walkDir(root, dir, parts) {
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    const rel = path.relative(root, abs);
    const stat = fs.lstatSync(abs);
    if (stat.isSymbolicLink()) {
      parts.push(`link:${rel}:${fs.readlinkSync(abs)}`);
    } else if (stat.isDirectory()) {
      parts.push(`dir:${rel}`);
      walkDir(root, abs, parts);
    } else if (stat.isFile()) {
      parts.push(`file:${rel}`);
      parts.push(fs.readFileSync(abs));
    }
  }
}

function hashParts(parts) {
  const hash = crypto.createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function printUpdateReport(before, after, { verbose = false } = {}) {
  console.log("");
  console.log("Update change report:");
  const groups = [
    compareEntries(before.renderedRules, after.renderedRules),
    compareEntries(before.rootConfig, after.rootConfig),
    compareEntries(before.copied, after.copied),
    compareEntries(before.skills, after.skills),
    compareScalar(before.packageRegistry, after.packageRegistry, "package registry"),
    compareEntries(before.hooks, after.hooks),
    compareEntries(before.permissions, after.permissions),
  ];
  printReportGroups(groups, { verbose });
  printLocalConfigRepairHint();
}

function compareScalar(before, after, label) {
  return before === after
    ? { changed: [], unchanged: [label] }
    : { changed: [label], unchanged: [] };
}

function compareEntries(beforeEntries, afterEntries) {
  const before = new Map(beforeEntries.map((entry) => [entry.key, entry]));
  const after = new Map(afterEntries.map((entry) => [entry.key, entry]));
  const changed = [];
  const unchanged = [];
  for (const [key, entry] of after) {
    const previous = before.get(key);
    if (!previous || previous.digest !== entry.digest) changed.push(entry.label);
    else unchanged.push(entry.label);
  }
  for (const [key, entry] of before) {
    if (!after.has(key)) changed.push(entry.label);
  }
  return { changed, unchanged };
}

function printReportGroups(groups, { verbose }) {
  const changed = unique(groups.flatMap((group) => group.changed));
  const unchanged = unique(groups.flatMap((group) => group.unchanged));
  console.log(`  changed: ${changed.length ? changed.join(", ") : "none"}`);
  if (verbose && unchanged.length) {
    console.log(`  unchanged: ${unchanged.join(", ")}`);
  } else if (!verbose && unchanged.length) {
    console.log(`  unchanged: ${unchanged.length} item(s) hidden (run: roborepo update --verbose)`);
  }
}

function unique(values) {
  return [...new Set(values)].sort();
}

function printLocalConfigRepairHint() {
  const plans = buildLocalConfigRepairPlans();
  if (!plans.length) return;
  const harnesses = plans.map((plan) => plan.harness).join(", ");
  console.log("");
  console.log(`Local config repair candidates found (${harnesses}).`);
  console.log("Run: roborepo repair local-config --dry-run");
}

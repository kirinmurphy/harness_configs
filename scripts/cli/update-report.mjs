import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./paths.mjs";
import { enabledPackagesPath } from "./state-paths.mjs";

const HARNESS_HOME = {
  claude: path.join(os.homedir(), ".claude"),
  codex: path.join(os.homedir(), ".codex"),
};

const MANAGED_MARKER = ".roborepo-managed";

export function runUpdateWithReport(commandConfig, args) {
  const before = snapshotInstallState();
  const result = runInstall(commandConfig, args);
  if (result.status === 0) {
    printUpdateReport(before, snapshotInstallState());
  }
  process.exit(result.status ?? 1);
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

  const result = spawnSync("bash", [script, ...args], { stdio: "inherit" });
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
    permissions: snapshotNamedRows(rows, new Set(["settings.json", "config.toml", "rules"])),
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
  if (row.homeSub === "settings.json" || row.homeSub === "config.toml") return `permissions ${row.harness}`;
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

function printUpdateReport(before, after) {
  console.log("");
  console.log("Update change report:");
  printGroup("rules", compareEntries(before.renderedRules, after.renderedRules));
  printGroup("root config", compareEntries(before.rootConfig, after.rootConfig));
  printGroup("copied files", compareEntries(before.copied, after.copied));
  printGroup("skills", compareEntries(before.skills, after.skills));
  printGroup("package registry", compareScalar(before.packageRegistry, after.packageRegistry, "package registry"));
  printGroup("hooks", compareEntries(before.hooks, after.hooks));
  printGroup("permissions", compareEntries(before.permissions, after.permissions));
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

function printGroup(label, result) {
  const changed = unique(result.changed);
  const unchanged = unique(result.unchanged);
  void label;
  if (changed.length) console.log(`  changed: ${changed.join(", ")}`);
  if (!changed.length && unchanged.length) console.log(`  unchanged: ${unchanged.join(", ")}`);
}

function unique(values) {
  return [...new Set(values)].sort();
}

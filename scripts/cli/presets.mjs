import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repoRoot } from "./paths.mjs";
import { installStatePath, presetsStatePath } from "./state-paths.mjs";

const PRESET_MANIFEST = path.join(repoRoot, "manifests", "platform", "presets.json");
const INSTALL_MANIFEST = path.join(repoRoot, "manifests", "platform", "manifest.tsv");
const MANIFEST_HOME = {
  claude: path.join(os.homedir(), ".claude"),
  codex: path.join(os.homedir(), ".codex"),
};

// Onboarding wizard disabled: install auto-applies all default bundles, so nothing is gated on an
// onboarding step. The forced-gate body is recorded in docs/plans/onboarding-reinstatement.md.
// Kept as a pass-through (still called from main.mjs) so the gate can be reinstated in one place.
export async function maybeRunPresetOnboarding(args) {
  const filtered = args.filter((arg) => arg !== "--no-presets-onboard");
  return filtered.length !== args.length ? filtered : args;
}

export async function presetsCommand(rest) {
  const [sub, ...args] = rest;
  switch (sub) {
    case "onboard":
      return presetsOnboard(args);
    case "bundle":
      return bundleCommand(args);
    case "apply":
      return presetsApply(args);
    case "status":
      return presetsStatus(args);
    case "check":
      return presetsCheck(args);
    case "remove":
      return presetsRemove(args);
    default:
      console.error(`usage: roborepo onboard | roborepo bundle status|apply|check|remove`);
      process.exit(2);
  }
}

export async function bundleCommand(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case "apply":
      return presetsApply(rest);
    case "status":
      return presetsStatus(rest);
    case "check":
      return presetsCheck(rest);
    case "remove":
      return presetsRemove(rest);
    default:
      console.error(`usage: roborepo bundle status|apply|check|remove`);
      process.exit(2);
  }
}

// The interactive bundle-toggle wizard is an in-progress feature and is intentionally not shown to
// users yet (see docs/plans/item-level-onboarding.md for the planned replacement). Until it ships,
// `roborepo onboard` applies the default bundles headlessly — the same packages install would apply —
// and prints an in-progress notice instead of opening the toggle UI. The original interactive body is
// recorded in docs/plans/onboarding-reinstatement.md.
export async function presetsOnboard(args) {
  rejectUnknownFlags(args, new Set());
  console.log("Onboarding is an in-progress feature and is not interactive yet.");
  console.log("Applying the default configuration (the same packages install sets up automatically).");
  presetsApply(["--default"]);
  const catalog = readPresetCatalog();
  const state = readPresetState();
  const selected = withDependencies(new Set(state.selected ?? catalog.default));
  writePresetState({
    selected: [...selected],
    onboardedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    bundles: bundleStates(catalog, selected),
  });
  console.log(`bundles: ${selected.size} applied`);
}

export function presetsApply(args) {
  rejectUnknownFlags(args, new Set(["--default", "--all"]));
  const catalog = readPresetCatalog();
  const requested = withDependencies(requestedBundles(args, catalog));
  applySelection(requested, catalog, { reconcile: false });
  const state = readPresetState();
  const selected = withDependencies(new Set([...(state.selected ?? []), ...requested]));
  writePresetState({
    ...state,
    selected: [...selected],
    updatedAt: new Date().toISOString(),
    bundles: bundleStates(catalog, selected),
  });
}

export function presetsStatus(args) {
  rejectUnknownFlags(args, new Set());
  const catalog = readPresetCatalog();
  const state = readPresetState();
  const selected = new Set(state.selected ?? []);
  const policy = readInstallPolicy();
  console.log(`onboarded: ${state.onboardedAt ? state.onboardedAt : "no"}`);
  for (const bundle of catalog.bundles) {
    const applied = bundleApplied(bundle, manifestRowsByKey(), policy);
    const mark = selected.has(bundle.id) ? "selected" : "unselected";
    console.log(`${bundle.id.padEnd(12)} ${mark.padEnd(10)} ${applied ? "applied" : "missing"}  ${bundle.label}`);
  }
}

export function presetsCheck(args) {
  rejectUnknownFlags(args, new Set());
  const catalog = readPresetCatalog();
  const state = readPresetState();
  const selected = new Set(state.selected ?? []);
  const rows = manifestRowsByKey();
  const policy = readInstallPolicy();
  let failed = 0;
  for (const bundle of catalog.bundles) {
    if (!selected.has(bundle.id)) continue;
    if (bundleApplied(bundle, rows, policy)) {
      console.log(`ok: ${bundle.id}`);
    } else {
      console.error(`fail: ${bundle.id} selected but not fully applied`);
      failed = 1;
    }
  }
  process.exit(failed);
}

export function presetsRemove(args) {
  rejectUnknownFlags(args, new Set());
  const catalog = readPresetCatalog();
  const requested = requestedBundles(args, catalog);
  const rows = manifestRowsByKey();
  for (const id of requested) {
    const bundle = catalog.byId.get(id);
    removeBundle(bundle, rows);
  }
  const state = readPresetState();
  const selected = new Set(state.selected ?? []);
  for (const id of requested) selected.delete(id);
  writePresetState({
    ...state,
    selected: [...selected],
    updatedAt: new Date().toISOString(),
    bundles: bundleStates(catalog, selected),
  });
}

export function markTelemetrySelected(enabled) {
  const catalog = readPresetCatalog();
  const state = readPresetState();
  const selected = new Set(state.selected ?? []);
  if (enabled) selected.add("telemetry");
  else selected.delete("telemetry");
  writePresetState({
    ...state,
    selected: [...selected],
    updatedAt: new Date().toISOString(),
    bundles: bundleStates(catalog, selected),
  });
}

function isInstalledCore() {
  try {
    const state = JSON.parse(fs.readFileSync(installStatePath, "utf8"));
    return state?.repo === repoRoot;
  } catch {
    return false;
  }
}

function isBypassCommand(args) {
  const cmd = args[0];
  if (cmd === undefined || cmd === "-h" || cmd === "--help") return true;
  return new Set(["update", "repair", "doctor", "verify", "onboard", "bundle", "presets", "telemetry"]).has(cmd);
}

function readPresetCatalog() {
  const raw = JSON.parse(fs.readFileSync(PRESET_MANIFEST, "utf8"));
  const bundles = raw.bundles ?? [];
  const byId = new Map(bundles.map((bundle) => [bundle.id, bundle]));
  return { default: raw.default ?? [], bundles, byId };
}

function readPresetState() {
  try {
    return JSON.parse(fs.readFileSync(presetsStatePath, "utf8"));
  } catch {
    return {};
  }
}

function writePresetState(state) {
  fs.mkdirSync(path.dirname(presetsStatePath), { recursive: true });
  fs.writeFileSync(presetsStatePath, JSON.stringify(state, null, 2) + "\n");
}

function bundleStates(catalog, selected) {
  const states = {};
  for (const bundle of catalog.bundles) {
    states[bundle.id] = {
      selected: selected.has(bundle.id),
      rows: bundle.rows.length,
    };
  }
  return states;
}

// Retained for the disabled interactive onboarding wizard (see docs/plans/onboarding-reinstatement.md).
// Currently unused; restored to use when the wizard is reinstated.
function printBundleChoices(catalog, current) {
  catalog.bundles.forEach((bundle, index) => {
    const mark = current.has(bundle.id) ? "x" : " ";
    console.log(`  ${index + 1}) [${mark}] ${bundle.label} (${bundle.id})`);
    console.log(`      ${bundle.description}`);
  });
}

function resolveSelection(answer, catalog, current) {
  const next = new Set(current);
  const trimmed = answer.trim().toLowerCase();
  if (trimmed === "") return next;
  if (trimmed === "all") return new Set(catalog.bundles.map((bundle) => bundle.id));
  if (trimmed === "none") return new Set();
  for (const part of trimmed.split(/[,\s]+/).filter(Boolean)) {
    const index = Number.parseInt(part, 10);
    if (!Number.isInteger(index) || index < 1 || index > catalog.bundles.length) {
      console.error(`invalid preset selection: ${part}`);
      process.exit(2);
    }
    const id = catalog.bundles[index - 1].id;
    if (next.has(id)) next.delete(id);
    else next.add(id);
  }
  return next;
}

function requestedBundles(args, catalog) {
  const positional = args.filter((arg) => !arg.startsWith("--"));
  if (args.includes("--all") || positional.includes("all")) {
    return new Set(catalog.bundles.map((bundle) => bundle.id));
  }
  if (args.includes("--default") || positional.includes("default") || positional.length === 0) {
    return new Set(catalog.default);
  }
  const selected = new Set();
  for (const id of positional) {
    if (!catalog.byId.has(id)) {
      console.error(`unknown preset bundle: ${id}`);
      process.exit(2);
    }
    selected.add(id);
  }
  return selected;
}

function withDependencies(selected) {
  if (selected.has("telemetry")) selected.add("hooks");
  return selected;
}

function applySelection(selected, catalog, { reconcile }) {
  const rows = manifestRowsByKey();
  const policy = readInstallPolicy();
  for (const bundle of catalog.bundles) {
    if (selected.has(bundle.id)) applyBundle(bundle, rows, policy);
    else if (reconcile) removeBundle(bundle, rows);
  }
}

function applyBundle(bundle, rows, policy) {
  for (const key of bundle.rows) {
    const row = rows.get(key);
    if (!row) {
      console.warn(`warn: preset ${bundle.id} references missing manifest row ${key}`);
      continue;
    }
    applyRow(row, policy);
  }
}

function removeBundle(bundle, rows) {
  const policy = readInstallPolicy();
  for (const key of bundle.rows) {
    const row = rows.get(key);
    if (!row) continue;
    removeRow(row, policy);
  }
}

function applyRow(row, policy) {
  if (!harnessAvailable(row.harness)) return;
  if (row.kind === "cleanup") return cleanupRow(row);
  if (row.kind === "link") {
    if (policy.mode === "adopt") return copyItem(row, policy);
    return linkItem(row, policy);
  }
  if (row.kind === "root_config") return copyItem(row, policy);
}

function cleanupRow(row) {
  const target = readlink(row.homeAbs);
  if (target && resolvesInsideRepo(row.homeAbs)) {
    fs.unlinkSync(row.homeAbs);
    console.log(`cleanup: ${row.homeAbs}`);
  }
}

function linkItem(row, policy) {
  const expected = path.join(repoRoot, row.srcRel);
  fs.mkdirSync(path.dirname(row.homeAbs), { recursive: true });

  const link = readlink(row.homeAbs);
  if (link && path.resolve(path.dirname(row.homeAbs), link) === expected) {
    console.log(`ok: ${row.homeAbs}`);
    return;
  }
  if (link && resolvesInsideRepo(row.homeAbs)) {
    fs.unlinkSync(row.homeAbs);
    fs.symlinkSync(expected, row.homeAbs);
    console.log(`relink: ${row.homeAbs} -> ${expected}`);
    return;
  }
  if (pathExists(row.homeAbs)) {
    if (policy.onConflict === "keep") {
      stageUpdate(row);
      printMergePrompt(row);
      return;
    }
    if (pathHasMeaningfulContent(row.homeAbs)) {
      const originalPath = timestampedPath(row.homeAbs, "original");
      fs.mkdirSync(path.dirname(originalPath), { recursive: true });
      fs.renameSync(row.homeAbs, originalPath);
      console.log(`backup: ${row.homeAbs} -> ${originalPath}`);
      printMergePrompt(row);
    } else {
      fs.rmSync(row.homeAbs, { recursive: true, force: true });
    }
  }

  fs.symlinkSync(expected, row.homeAbs);
  console.log(`link: ${row.homeAbs} -> ${expected}`);
}

function savePreInstallBackup(row) {
  if (!row.harness) return;
  if (readlink(row.homeAbs)) return;
  if (!pathExists(row.homeAbs)) return;
  const dest = path.join(os.homedir(), ".roborepo", "backups", "pre-install", row.harness, path.basename(row.homeAbs));
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  copyTree(row.homeAbs, dest);
  console.log(`pre-install backup: ${row.homeAbs} -> ${dest}`);
}

function copyItem(row, policy) {
  const source = path.join(repoRoot, row.srcRel);
  savePreInstallBackup(row);
  fs.mkdirSync(path.dirname(row.homeAbs), { recursive: true });
  const link = readlink(row.homeAbs);
  if (link && resolvesInsideRepo(row.homeAbs)) fs.unlinkSync(row.homeAbs);

  if (!pathExists(row.homeAbs)) {
    copyTree(source, row.homeAbs);
    console.log(`copy: ${row.homeAbs} <- ${source}`);
    return;
  }

  if (pathsEquivalentForCopy(source, row.homeAbs)) {
    console.log(`ok: ${row.homeAbs}`);
    return;
  }

  if (policy.onConflict === "keep") {
    stageUpdate(row);
    printMergePrompt(row);
    return;
  }

  if (pathHasMeaningfulContent(row.homeAbs)) {
    const originalPath = timestampedPath(row.homeAbs, "original");
    fs.mkdirSync(path.dirname(originalPath), { recursive: true });
    fs.renameSync(row.homeAbs, originalPath);
    console.log(`backup: ${row.homeAbs} -> ${originalPath}`);
    printMergePrompt(row);
  } else {
    fs.rmSync(row.homeAbs, { recursive: true, force: true });
  }
  copyTree(source, row.homeAbs);
  console.log(`copy: ${row.homeAbs} <- ${source}`);
}

function removeOwnedLink(row) {
  const link = readlink(row.homeAbs);
  if (!link) return;
  if (!resolvesInsideRepo(row.homeAbs)) return;
  fs.unlinkSync(row.homeAbs);
  console.log(`unlink: ${row.homeAbs}`);
}

function removeRow(row, policy) {
  const source = path.join(repoRoot, row.srcRel);
  const staged = findSiblingArtifact(row.homeAbs, "update");
  const backup = findSiblingArtifact(row.homeAbs, "original");

  if (staged && policy.onConflict === "keep") {
    fs.rmSync(staged, { recursive: true, force: true });
    console.log(`unlink: ${staged}`);
  }

  if (row.kind === "link") {
    const link = readlink(row.homeAbs);
    if (link && path.resolve(path.dirname(row.homeAbs), link) === source) {
      fs.unlinkSync(row.homeAbs);
      console.log(`unlink: ${row.homeAbs}`);
      return;
    }
  }

  if (!pathExists(row.homeAbs)) return;

  if (policy.onConflict === "keep") {
    if (staged) return;
    if (!pathLooksRepoManaged(source, row.homeAbs)) return;
    fs.rmSync(row.homeAbs, { recursive: true, force: true });
    console.log(`unlink: ${row.homeAbs}`);
    return;
  }

  if (backup && pathLooksRepoManaged(source, row.homeAbs)) {
    fs.rmSync(row.homeAbs, { recursive: true, force: true });
    fs.renameSync(backup, row.homeAbs);
    console.log(`restore: ${row.homeAbs} <- ${backup}`);
    return;
  }

  if (pathLooksRepoManaged(source, row.homeAbs)) {
    fs.rmSync(row.homeAbs, { recursive: true, force: true });
    console.log(`unlink: ${row.homeAbs}`);
  }
}

function bundleApplied(bundle, rows, policy = readInstallPolicy()) {
  return bundle.rows.every((key) => {
    const row = rows.get(key);
    if (!row || !harnessAvailable(row.harness)) return true;
    if (row.kind === "root_config") return fs.existsSync(row.homeAbs) && !readlink(row.homeAbs);
    if (row.kind === "link" && policy.mode === "adopt") return fs.existsSync(row.homeAbs) && !readlink(row.homeAbs);
    if (row.kind === "link") return realpath(row.homeAbs) === path.join(repoRoot, row.srcRel);
    return true;
  });
}

function readInstallPolicy() {
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(installStatePath, "utf8"));
  } catch {}
  const mode = state.mode === "adopt" ? "adopt" : "managed";
  const envConflict = process.env.ROBOREPO_ON_CONFLICT;
  const stateConflict = state.onConflict;
  const onConflict = envConflict === "keep" || envConflict === "overwrite"
    ? envConflict
    : stateConflict === "keep" || stateConflict === "overwrite"
      ? stateConflict
      : mode === "adopt"
        ? "keep"
        : "overwrite";
  return { mode, onConflict };
}

function timestampedPath(target, tag) {
  const timestamp = process.env.ROBOREPO_INSTALL_TIMESTAMP ?? formatTimestamp(new Date());
  const dir = path.dirname(target);
  const base = path.basename(target);
  if (pathExists(target) && fs.lstatSync(target).isDirectory() && !fs.lstatSync(target).isSymbolicLink()) {
    return uniquePath(path.join(dir, `${base}_${tag}_${timestamp}`));
  }
  const ext = path.extname(base);
  const name = ext ? base.slice(0, -ext.length) : base;
  return uniquePath(path.join(dir, `${name}_${tag}_${timestamp}${ext}`));
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function uniquePath(target) {
  if (!pathExists(target)) return target;
  let index = 1;
  while (pathExists(`${target}.${index}`)) index += 1;
  return `${target}.${index}`;
}

function copyTree(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.lstatSync(source).isDirectory()) {
    fs.cpSync(source, target, { recursive: true, preserveTimestamps: true });
  } else {
    fs.copyFileSync(source, target);
  }
}

function stageUpdate(row) {
  const source = path.join(repoRoot, row.srcRel);
  const updatePath = timestampedPath(row.homeAbs, "update");
  copyTree(source, updatePath);
  console.log(`stage: ${updatePath} <- ${source}`);
}

function printMergePrompt(row) {
  const source = path.join(repoRoot, row.srcRel);
  console.log("");
  console.log("Merge review prompt:");
  console.log("-----");
  console.log(`Resolve this harness install conflict.

Repo harness path:
  ${source}

Existing local path:
  ${row.homeAbs}

Default stance: preserve the existing local path as source of truth unless you can prove a repo change can be added without breaking local behavior.

Required first step: compute your own complete comparison of both paths. Do not rely on this prompt as an exhaustive conflict summary. For directories, inspect the full recursive file list and content diffs. For structured files, parse the format when possible instead of using only text matching.

Goal: preserve the user's existing local behavior while installing useful harness behavior from the repo.

Merge instructions:
- Keep local-only behavior by default.
- Add repo-only harness behavior only when it does not conflict with local behavior.
- If both sides edit the same setting, hook, rule, command, skill, or MCP/server entry, explain the conflict and stop for user choice.
- Do not delete, replace, or move the local path unless the user explicitly approves that exact action.
- Report the files changed and the conflicts left unresolved.`);
  console.log("-----");
  console.log("");
}

function pathsEquivalentForCopy(source, target) {
  if (!pathExists(source) || !pathExists(target)) return false;
  if (!fs.lstatSync(source).isFile() || !fs.lstatSync(target).isFile() || readlink(target)) return false;
  return fs.readFileSync(source).equals(fs.readFileSync(target));
}

function pathHasMeaningfulContent(target) {
  if (!pathExists(target)) return false;
  const stats = fs.lstatSync(target);
  if (stats.isSymbolicLink()) return true;
  if (stats.isFile()) return stats.size > 0;
  if (stats.isDirectory()) return fs.readdirSync(target).length > 0;
  return true;
}

function pathExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function findSiblingArtifact(target, tag) {
  const dir = path.dirname(target);
  const base = path.basename(target);
  const ext = path.extname(base);
  const name = ext ? base.slice(0, -ext.length) : base;
  const prefix = `${name}_${tag}_`;
  const suffix = ext || "";

  if (!pathExists(dir)) return null;
  const matches = fs.readdirSync(dir)
    .filter((entry) => entry.startsWith(prefix) && entry.endsWith(suffix))
    .sort()
    .map((entry) => path.join(dir, entry));
  return matches.at(-1) ?? null;
}

function pathLooksRepoManaged(source, target) {
  if (!pathExists(source) || !pathExists(target)) return false;
  const srcStat = fs.lstatSync(source);
  const dstStat = fs.lstatSync(target);
  if (dstStat.isSymbolicLink()) {
    return resolvesInsideRepo(target);
  }
  if (srcStat.isFile() && dstStat.isFile()) {
    return fs.readFileSync(source).equals(fs.readFileSync(target));
  }
  if (srcStat.isDirectory() && dstStat.isDirectory()) {
    return directoryTreesEqual(source, target);
  }
  return false;
}

function directoryTreesEqual(source, target) {
  const sourceEntries = fs.readdirSync(source, { withFileTypes: true }).map((entry) => entry.name).sort();
  const targetEntries = fs.readdirSync(target, { withFileTypes: true }).map((entry) => entry.name).sort();
  if (sourceEntries.length !== targetEntries.length) return false;
  for (let i = 0; i < sourceEntries.length; i += 1) {
    if (sourceEntries[i] !== targetEntries[i]) return false;
    const sourceChild = path.join(source, sourceEntries[i]);
    const targetChild = path.join(target, targetEntries[i]);
    const sourceStat = fs.lstatSync(sourceChild);
    const targetStat = fs.lstatSync(targetChild);
    if (sourceStat.isDirectory() && targetStat.isDirectory()) {
      if (!directoryTreesEqual(sourceChild, targetChild)) return false;
      continue;
    }
    if (sourceStat.isFile() && targetStat.isFile()) {
      if (!fs.readFileSync(sourceChild).equals(fs.readFileSync(targetChild))) return false;
      continue;
    }
    if (sourceStat.isSymbolicLink() && targetStat.isSymbolicLink()) {
      if (fs.readlinkSync(sourceChild) !== fs.readlinkSync(targetChild)) return false;
      continue;
    }
    return false;
  }
  return true;
}

function manifestRowsByKey() {
  const map = new Map();
  for (const row of readManifestRows()) {
    map.set(`${row.harness}:${row.homeSub}`, row);
  }
  return map;
}

function readManifestRows() {
  const rows = [];
  for (const line of fs.readFileSync(INSTALL_MANIFEST, "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [harness, kind, srcRel, homeSub, homeRoot, flags] = line.split("\t");
    rows.push({
      harness,
      kind,
      srcRel,
      homeSub,
      homeRoot,
      flags,
      homeAbs: path.join(MANIFEST_HOME[homeRoot], homeSub),
    });
  }
  return rows;
}

function harnessAvailable(harness) {
  if (harness === "claude") return fs.existsSync(MANIFEST_HOME.claude);
  if (harness === "codex") return fs.existsSync(MANIFEST_HOME.codex);
  return false;
}

function readlink(target) {
  try {
    return fs.lstatSync(target).isSymbolicLink() ? fs.readlinkSync(target) : null;
  } catch {
    return null;
  }
}

function realpath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

function resolvesInsideRepo(target) {
  const real = path.resolve(path.dirname(target), readlink(target) ?? "");
  return real === repoRoot || real.startsWith(`${repoRoot}${path.sep}`);
}

function rejectUnknownFlags(args, allowed) {
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    if (!allowed.has(arg)) {
      console.error(`unknown flag: ${arg}`);
      process.exit(2);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  presetsCommand(process.argv.slice(2)).catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}

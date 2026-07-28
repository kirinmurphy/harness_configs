import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import { roborepoStateDir } from "./state-paths.mjs";
import { writeRootConfig } from "./root-config-writes.mjs";
import { clearOwnedScalar, readOwnedScalar, recordOwnedScalar } from "./owned-scalars-state.mjs";

export function runtimeAssetDestination(pkg, component) {
  const target = component.target || path.basename(component.source);
  return path.join(roborepoStateDir, "runtime", pkg.id, target);
}

export function installRuntimeAsset(pkg, component, { dryRun = false } = {}) {
  const sourcePath = path.join(repoRoot, component.source);
  const destPath = runtimeAssetDestination(pkg, component);
  if (dryRun) {
    console.log(`  [dry-run] install runtime asset ${component.source} -> ${destPath}`);
    return destPath;
  }
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(sourcePath, destPath);
  fs.chmodSync(destPath, fs.statSync(sourcePath).mode | 0o755);
  console.log(`  runtime asset: ${destPath}`);
  return destPath;
}

export function removeRuntimeAsset(pkg, component, { dryRun = false } = {}) {
  const destPath = runtimeAssetDestination(pkg, component);
  if (dryRun) {
    console.log(`  [dry-run] remove runtime asset ${destPath}`);
    return;
  }
  try {
    fs.unlinkSync(destPath);
    console.log(`  removed runtime asset: ${destPath}`);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    console.log(`  ok: runtime asset already absent: ${destPath}`);
  }
}

export function readHarnessConfig(component, pkg) {
  const data = JSON.parse(fs.readFileSync(path.join(repoRoot, component.source), "utf8"));
  return expandRuntimeRefs(data, runtimeSubstitutions(pkg));
}

export function mergeHarnessConfig(pkg, component, { claudeSettingsPath, codexConfigPath, readSettings, writeSettings }) {
  const config = readHarnessConfig(component, pkg);
  if (component.harness === "claude") {
    if (!config.statusLine || typeof config.statusLine !== "object") throw new Error(`${pkg.id}: Claude harness-config needs statusLine`);
    mergeClaudeStatusLine(claudeSettingsPath, config.statusLine, { readSettings, writeSettings });
    return;
  }
  if (component.harness === "codex") {
    mergeCodexTuiStatusLine(codexConfigPath, config.tui || {});
    return;
  }
  throw new Error(`${pkg.id}: unsupported harness-config harness: ${component.harness}`);
}

export function unmergeHarnessConfig(pkg, component, { claudeSettingsPath, codexConfigPath, readSettings, writeSettings }) {
  const config = readHarnessConfig(component, pkg);
  if (component.harness === "claude") {
    unmergeClaudeStatusLine(claudeSettingsPath, config.statusLine, { readSettings, writeSettings });
    return;
  }
  if (component.harness === "codex") {
    unmergeCodexTuiStatusLine(codexConfigPath, config.tui || {});
    return;
  }
  throw new Error(`${pkg.id}: unsupported harness-config harness: ${component.harness}`);
}

export function codexStatusLineIncludes(configText, item) {
  const match = configText.match(/^\[tui\]\s*\n([\s\S]*?)(?=^\[|\s*$)/m);
  if (!match) return false;
  const array = match[1].match(/^status_line\s*=\s*\[([^\]]*)\]/m);
  if (!array) return false;
  return [...array[1].matchAll(/"((?:\\.|[^"\\])*)"/g)]
    .map((entry) => JSON.parse(`"${entry[1]}"`))
    .includes(item);
}

function runtimeSubstitutions(pkg) {
  return new Map(
    (pkg.components || [])
      .filter((component) => component.type === "runtime-asset")
      .map((component) => [path.basename(component.source), runtimeAssetDestination(pkg, component)])
  );
}

function expandRuntimeRefs(value, substitutions) {
  if (typeof value === "string") {
    return value.replace(/\$\{runtime:([^}]+)\}/g, (match, name) => substitutions.get(name) || match);
  }
  if (Array.isArray(value)) return value.map((entry) => expandRuntimeRefs(entry, substitutions));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, expandRuntimeRefs(entry, substitutions)]));
  }
  return value;
}

function statusLineMatches(existing, desired) {
  return JSON.stringify(existing || null) === JSON.stringify(desired || null);
}

function mergeClaudeStatusLine(settingsPath, desired, { readSettings, writeSettings }) {
  const settings = readSettings(settingsPath);
  if (settings.statusLine && !statusLineMatches(settings.statusLine, desired)) {
    console.warn("  conflict: Claude statusLine already exists; leaving unmanaged setting unchanged");
    return;
  }
  settings.statusLine = desired;
  writeSettings(settingsPath, settings);
  console.log(`  wired: Claude statusLine -> ${settingsPath}`);
}

function unmergeClaudeStatusLine(settingsPath, desired, { readSettings, writeSettings }) {
  const settings = readSettings(settingsPath);
  if (!settings.statusLine) {
    console.log("  ok: Claude statusLine already absent");
    return;
  }
  if (!statusLineMatches(settings.statusLine, desired)) {
    console.warn("  conflict: Claude statusLine is unmanaged; leaving it unchanged");
    return;
  }
  delete settings.statusLine;
  writeSettings(settingsPath, settings);
  console.log(`  removed: Claude statusLine <- ${settingsPath}`);
}

const COLORS_KEY = "status_line_use_colors";

function mergeCodexTuiStatusLine(configPath, tui) {
  const desired = Array.isArray(tui.status_line) ? tui.status_line : [];
  if (desired.length === 0) throw new Error("Codex harness-config needs non-empty tui.status_line");
  let text = "";
  try { text = fs.readFileSync(configPath, "utf8"); } catch {}
  let next = mergeTomlArray(text, "tui", "status_line", desired).text;
  if (typeof tui.status_line_use_colors === "boolean") {
    next = mergeCodexColorScalar(next, tui.status_line_use_colors);
  }
  if (next !== text) {
    writeRootConfig("codex", configPath, next);
    console.log(`  wired: Codex tui.status_line -> ${configPath}`);
  } else {
    console.log(`  ok: Codex tui.status_line already present -> ${configPath}`);
  }
}

// Own the color scalar safely. On the first enable, an existing value we didn't set is unmanaged: if
// it disagrees with what we want, preserve it and report rather than corrupt it. Once roborepo has
// recorded ownership, subsequent enables freely reassert the desired value (the user's original is
// safe in provenance and restored on disable).
function mergeCodexColorScalar(text, desiredValue) {
  const priorRecord = readOwnedScalar("codex", "tui", COLORS_KEY);
  const current = getTomlScalar(text, "tui", COLORS_KEY);
  if (!priorRecord && current !== undefined && current !== desiredValue) {
    console.warn(`  conflict: Codex tui.${COLORS_KEY} is unmanaged; leaving it unchanged`);
    return text;
  }
  recordOwnedScalar("codex", "tui", COLORS_KEY, current);
  return setTomlScalar(text, "tui", COLORS_KEY, desiredValue);
}

function unmergeCodexTuiStatusLine(configPath, tui) {
  const owned = Array.isArray(tui.status_line) ? tui.status_line : [];
  let text = "";
  try { text = fs.readFileSync(configPath, "utf8"); } catch {}
  let next = unmergeTomlArray(text, "tui", "status_line", owned);
  if (typeof tui.status_line_use_colors === "boolean") {
    next = unmergeCodexColorScalar(next);
  }
  if (next !== text) {
    writeRootConfig("codex", configPath, next);
    console.log(`  removed: Codex tui.status_line <- ${configPath}`);
  } else {
    console.log(`  ok: Codex tui.status_line already absent <- ${configPath}`);
  }
}

// Restore the color scalar to its provenance: put back an unmanaged prior value, or remove the key
// entirely if roborepo introduced it. Only touches the scalar when roborepo recorded ownership, so
// a manual user value set after enable is never clobbered.
function unmergeCodexColorScalar(text) {
  const record = readOwnedScalar("codex", "tui", COLORS_KEY);
  if (!record) return text;
  const next = record.existed
    ? setTomlScalar(text, "tui", COLORS_KEY, record.priorValue)
    : removeTomlScalar(text, "tui", COLORS_KEY);
  clearOwnedScalar("codex", "tui", COLORS_KEY);
  return next;
}

function tomlArrayLine(key, values) {
  return `${key} = [${values.map((value) => JSON.stringify(String(value))).join(", ")}]\n`;
}

function tomlTableKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function tableHeader(table) {
  return `[${tomlTableKey(table)}]`;
}

// Captures a table's body as everything from just after its `[header]\n` up to the next table
// header (`^[`) or the true end of the string. The end-of-string branch is `$(?![\s\S])` — NOT a
// bare `\s*$`: under the `m` flag `$` matches every line end, so a lazy body + `\s*$` would stop at
// the FIRST line, silently excluding later keys in the same table (e.g. a scalar written after an
// array) and causing duplicate-key appends on re-write. Anchoring to absolute end keeps the whole
// table body in one capture.
function tableBlockPattern(table) {
  const header = tableHeader(table).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^${header}\\n)([\\s\\S]*?)(?=^\\[|$(?![\\s\\S]))`, "m");
}

function parseTomlArray(body, key) {
  const match = body.match(new RegExp(`^${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m"));
  if (!match) return null;
  return [...match[1].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((entry) => JSON.parse(`"${entry[1]}"`));
}

function mergeTomlArray(text, table, key, values) {
  const pattern = tableBlockPattern(table);
  const deduped = (existing) => [...new Set([...existing, ...values.map(String)])];
  if (pattern.test(text)) {
    return {
      text: text.replace(pattern, (_match, header, body) => {
        const existing = parseTomlArray(body, key);
        if (existing) {
          return `${header}${body.replace(new RegExp(`^${key}\\s*=\\s*\\[[^\\]]*\\].*\\n?`, "m"), tomlArrayLine(key, deduped(existing)))}`;
        }
        const prefix = body.endsWith("\n") || body.length === 0 ? body : `${body}\n`;
        return `${header}${prefix}${tomlArrayLine(key, deduped([]))}`;
      }),
    };
  }
  const prefix = text && !text.endsWith("\n") ? `${text}\n` : text;
  return { text: `${prefix}${prefix ? "\n" : ""}${tableHeader(table)}\n${tomlArrayLine(key, deduped([]))}` };
}

function unmergeTomlArray(text, table, key, values) {
  const pattern = tableBlockPattern(table);
  if (!pattern.test(text)) return text;
  const owned = new Set(values.map(String));
  return text.replace(pattern, (_match, header, body) => {
    const existing = parseTomlArray(body, key);
    if (!existing) return `${header}${body}`;
    const nextValues = existing.filter((value) => !owned.has(value));
    return `${header}${body.replace(new RegExp(`^${key}\\s*=\\s*\\[[^\\]]*\\].*\\n?`, "m"), tomlArrayLine(key, nextValues))}`;
  }).replace(/\n{3,}/g, "\n\n");
}

// Read a boolean scalar's current value from a TOML table. Returns undefined when the table or key
// is absent — the caller distinguishes "absent" (safe to remove on disable) from a real value.
function getTomlScalar(text, table, key) {
  const match = text.match(tableBlockPattern(table));
  if (!match) return undefined;
  const line = match[2].match(new RegExp(`^${key}\\s*=\\s*(true|false)`, "m"));
  return line ? line[1] === "true" : undefined;
}

function removeTomlScalar(text, table, key) {
  const pattern = tableBlockPattern(table);
  if (!pattern.test(text)) return text;
  return text
    .replace(pattern, (_match, header, body) => `${header}${body.replace(new RegExp(`^${key}\\s*=.*\\n?`, "m"), "")}`)
    .replace(/\n{3,}/g, "\n\n");
}

function setTomlScalar(text, table, key, value) {
  const pattern = tableBlockPattern(table);
  const line = `${key} = ${value ? "true" : "false"}\n`;
  if (pattern.test(text)) {
    return text.replace(pattern, (_match, header, body) => {
      if (new RegExp(`^${key}\\s*=`, "m").test(body)) {
        return `${header}${body.replace(new RegExp(`^${key}\\s*=.*\\n?`, "m"), line)}`;
      }
      const prefix = body.endsWith("\n") || body.length === 0 ? body : `${body}\n`;
      return `${header}${prefix}${line}`;
    });
  }
  const prefix = text && !text.endsWith("\n") ? `${text}\n` : text;
  return `${prefix}${prefix ? "\n" : ""}${tableHeader(table)}\n${line}`;
}

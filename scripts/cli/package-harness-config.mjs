import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import { roborepoStateDir } from "./state-paths.mjs";
import { writeRootConfig } from "./root-config-writes.mjs";

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

function mergeCodexTuiStatusLine(configPath, tui) {
  const desired = Array.isArray(tui.status_line) ? tui.status_line : [];
  if (desired.length === 0) throw new Error("Codex harness-config needs non-empty tui.status_line");
  let text = "";
  try { text = fs.readFileSync(configPath, "utf8"); } catch {}
  const merged = mergeTomlArray(text, "tui", "status_line", desired);
  let next = merged.text;
  if (typeof tui.status_line_use_colors === "boolean") {
    next = setTomlScalar(next, "tui", "status_line_use_colors", tui.status_line_use_colors);
  }
  if (next !== text) {
    writeRootConfig("codex", configPath, next);
    console.log(`  wired: Codex tui.status_line -> ${configPath}`);
  } else {
    console.log(`  ok: Codex tui.status_line already present -> ${configPath}`);
  }
}

function unmergeCodexTuiStatusLine(configPath, tui) {
  const owned = Array.isArray(tui.status_line) ? tui.status_line : [];
  let text = "";
  try { text = fs.readFileSync(configPath, "utf8"); } catch {}
  const next = unmergeTomlArray(text, "tui", "status_line", owned);
  if (next !== text) {
    writeRootConfig("codex", configPath, next);
    console.log(`  removed: Codex tui.status_line <- ${configPath}`);
  } else {
    console.log(`  ok: Codex tui.status_line already absent <- ${configPath}`);
  }
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

function tableBlockPattern(table) {
  const header = tableHeader(table).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^${header}\\n)([\\s\\S]*?)(?=^\\[|\\s*$)`, "m");
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

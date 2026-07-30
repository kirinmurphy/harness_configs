// Codex harness provider. Phase 2 wires this into the registry with real discovery and
// placeholder capability adapters; Phases 3-6 replace the placeholders with migrated behavior
// from scripts/cli/{root-config-merge,mcp-codex,telemetry,...}.mjs one capability at a time.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineHarnessProvider } from "../contract.mjs";
import { detectHarnessProvider } from "../discovery.mjs";
import { stubAdapterGroups } from "../stub-adapter.mjs";
import { mergeCodexConfig, normalizeRootConfigContent } from "../../cli/root-config-merge.mjs";
import { clearOwnedScalar, readOwnedScalar, recordOwnedScalar } from "../../cli/owned-scalars-state.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(here, "..", "..", "..", "globals", "harnesses", "codex", "provider.json");
const codexManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

// --- TOML [table] array/scalar helpers, moved unchanged from package-harness-config.mjs. Only
// Codex needs these (Claude's package config is a JSON statusLine key, handled entirely by the
// Claude provider's own mergePackageComponent). ---

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

const COLORS_KEY = "status_line_use_colors";

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

// mergePackageComponent/unmergePackageComponent take the already-read component config (not the
// raw component) so this module never needs package-harness-config.mjs's readHarnessConfig, which
// depends on paths.mjs's harness-path section -> registry.mjs -> this module — a cycle.
//
// Returns { changed, content } rather than writing the file itself: writeRootConfig (drift-state
// bookkeeping) lives behind paths.mjs's harness-path section too, so a provider adapter calling it
// directly would recreate the same cycle. The orchestrator (package-harness-config.mjs), which sits
// above both the provider and paths.mjs in the dependency graph, performs the actual write.
function mergePackageComponent(pkg, config, { codexConfigPath }) {
  const tui = config.tui || {};
  const desired = Array.isArray(tui.status_line) ? tui.status_line : [];
  if (desired.length === 0) throw new Error("Codex harness-config needs non-empty tui.status_line");
  let text = "";
  try { text = fs.readFileSync(codexConfigPath, "utf8"); } catch {}
  let next = mergeTomlArray(text, "tui", "status_line", desired).text;
  if (typeof tui.status_line_use_colors === "boolean") {
    next = mergeCodexColorScalar(next, tui.status_line_use_colors);
  }
  return { changed: next !== text, content: next };
}

function unmergePackageComponent(pkg, config, { codexConfigPath }) {
  const tui = config.tui || {};
  const owned = Array.isArray(tui.status_line) ? tui.status_line : [];
  let text = "";
  try { text = fs.readFileSync(codexConfigPath, "utf8"); } catch {}
  let next = unmergeTomlArray(text, "tui", "status_line", owned);
  if (typeof tui.status_line_use_colors === "boolean") {
    next = unmergeCodexColorScalar(next);
  }
  return { changed: next !== text, content: next };
}

const stubGroups = stubAdapterGroups("codex", {
  rules: ["render"],
  permissions: ["render"],
  skills: ["link"],
  commands: ["render"],
  hooks: ["read", "write"],
  mcp: ["add", "remove"],
  telemetry: ["wireCaptureHooks", "parseRateLimits"],
  transcripts: ["locate", "parse"],
  session: ["launch"],
});

// merge/render stay thin wrappers over root-config-merge.mjs's existing, characterization-tested
// functions (scripts/test/{root-config-merge,package-harness-config}-characterization-check.mjs)
// rather than a re-port — this phase moves OWNERSHIP behind the provider contract, not the
// implementation itself.
export const codexProvider = defineHarnessProvider({
  manifest: codexManifest,
  adapters: {
    discovery: { detect: () => detectHarnessProvider(codexManifest) },
    ...stubGroups,
    rootConfig: {
      merge: (repoText, localText) => mergeCodexConfig(repoText, localText),
      render: (content) => normalizeRootConfigContent("codex", content),
      mergePackageComponent,
      unmergePackageComponent,
    },
  },
});

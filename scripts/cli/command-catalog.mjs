import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "./paths.mjs";
import { loadCommandDefinitions, readRemovedCommands } from "./command-definition-files.mjs";
import { composeCommandNodes } from "./command-tree-compose.mjs";
import { listHarnessProviders } from "../harnesses/registry.mjs";

const CATALOG_PATH = path.join(repoRoot, "manifests", "platform", "cli-commands.json");
const NODE_KINDS = new Set(["namespace", "command", "internal"]);

export function loadCommandCatalog() {
  const catalog = composeCatalog(JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8")));
  catalog.description = rootDescription();
  validateCommandCatalog(catalog);
  return catalog;
}

// Root help's one-line summary, built from whichever providers are actually registered rather
// than the manifest's static two-name text — so a third provider (or a Claude/Codex-only build)
// shows the real list without a JSON edit.
function rootDescription() {
  const names = listHarnessProviders().map((provider) => provider.manifest.displayName);
  const list = names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  return `manage ${list} harness configuration`;
}

export function validateCommandCatalog(catalog) {
  if (catalog.schemaVersion !== 2) throw new Error("cli catalog schemaVersion must be 2");
  if (!catalog.nodes || typeof catalog.nodes !== "object") throw new Error("cli catalog needs nodes");
  if (!catalog.navigation || typeof catalog.navigation !== "object") throw new Error("cli catalog needs navigation");

  const paths = new Set();
  const handlers = [];
  for (const { tokens, node } of listCommandNodes(catalog, { includeInternal: true })) {
    const key = tokens.join(" ");
    if (paths.has(key)) throw new Error(`duplicate CLI path: ${key}`);
    paths.add(key);
    if (!NODE_KINDS.has(node.kind)) throw new Error(`invalid node kind at ${key}`);
    if ((node.kind === "command" || node.kind === "internal") && !node.execution) {
      throw new Error(`missing execution for ${key}`);
    }
    if (node.execution) handlers.push(node.execution.adapter);
  }
  return { paths, handlers };
}

export function listCommandNodes(catalog, { includeInternal = false, includeAdvanced = true } = {}) {
  const out = [];
  walkNodes(catalog.nodes, [], out, { includeInternal, includeAdvanced });
  return out;
}

export function childEntries(nodeOrCatalog, { includeInternal = false, includeAdvanced = true } = {}) {
  const children = nodeOrCatalog.children || nodeOrCatalog.nodes || {};
  return Object.entries(children)
    .map(([key, node]) => ({ key, node }))
    .filter(({ node }) => includeInternal || node.kind !== "internal")
    .filter(({ node }) => includeAdvanced || !node.advanced)
    .sort((a, b) => (a.node.order ?? 0) - (b.node.order ?? 0) || a.key.localeCompare(b.key));
}

export function promotedRootEntries(catalog) {
  return listCommandNodes(catalog, { includeInternal: false, includeAdvanced: false })
    .filter(({ tokens, node }) => tokens.length > 1 && node.promoteToRoot)
    .sort((a, b) => (a.node.rootOrder ?? a.node.order ?? 0) - (b.node.rootOrder ?? b.node.order ?? 0));
}

export function displayTokens(key, node, parentTokens = []) {
  return node.tokens || [...parentTokens, key];
}

function walkNodes(nodes, parentTokens, out, options) {
  for (const { key, node } of childEntries({ nodes }, options)) {
    const tokens = displayTokens(key, node, parentTokens);
    out.push({ tokens, node });
    if (node.children) walkNodes(node.children, tokens, out, options);
  }
}

function composeCatalog(catalog) {
  if (!catalog.commandDefinitionRoots?.length) return catalog;
  const definitions = loadCommandDefinitions({ roots: catalog.commandDefinitionRoots });
  return {
    ...catalog,
    nodes: composeCommandNodes({
      definitions,
      executionPresets: catalog.executionPresets || {},
    }),
    removed: readRemovedCommands({ relPath: catalog.removedPath }),
  };
}

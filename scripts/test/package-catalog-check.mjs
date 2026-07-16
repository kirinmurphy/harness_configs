#!/usr/bin/env node
import { loadPackageCatalog, validatePackageCatalog } from "../cli/package-catalog.mjs";
import { listPackageCommands } from "../cli/package-commands.mjs";
import { loadSlashCommandPlan } from "../cli/slash-commands.mjs";
import { readConfigSnapshot } from "../cli/config.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const catalog = loadPackageCatalog({ includeUnavailable: true });
validatePackageCatalog(catalog);

const packageIds = new Set(catalog.map((pkg) => pkg.id));
for (const id of ["jcodemunch", "jdocmunch", "code-intel", "telemetry", "caveman"]) {
  assert(packageIds.has(id), `missing package: ${id}`);
}

const commands = listPackageCommands({ includeUnavailable: true }).map((command) => command.name).sort();
for (const name of ["index code", "index docs", "watch code"]) {
  assert(commands.includes(name), `missing package CLI command: ${name}`);
}

const slashNames = loadSlashCommandPlan().commands.map((command) => command.name).sort();
for (const name of ["case-study", "frontend-design", "technical-planning", "tighten", "wrap-up"]) {
  assert(slashNames.includes(name), `missing slash command: ${name}`);
}

const snapshot = readConfigSnapshot();
const sections = new Map(snapshot.behaviorView.map((section) => [section.category, section]));
assert(sections.has("Token Optimization"), "missing Token Optimization section");
assert(sections.has("Commands"), "missing Commands section");
assert(sections.has("Code Conventions"), "missing Code Conventions section");
assert(sections.has("Chat-Time Output"), "missing Chat-Time Output section");
assert(sections.get("Token Optimization").items.some((item) => item.id === "jcodemunch"), "jcodemunch not visible in Token Optimization");
assert(sections.get("Commands").items.some((item) => item.label === "/tighten"), "/tighten not visible in Commands");

console.log("ok: package catalog behavior");

#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadCommandCatalog, listCommandNodes, promotedRootEntries } from "../cli/command-catalog.mjs";
import { validateExecutions } from "../cli/command-executor.mjs";
import { renderHelp } from "../cli/help-renderer.mjs";
import { repoRoot } from "../cli/paths.mjs";
import { resolveCommand } from "../cli/command-resolver.mjs";

const catalog = loadCommandCatalog();
validateExecutions({ catalog });

assert.deepEqual(catalog.commandDefinitionRoots, ["manifests/platform/cli/command-definitions"]);
assert.equal(catalog.discoveryRoots, undefined);
assert.ok(catalog.nodes.package.children.dev, "package dev namespace composed");
assert.ok(catalog.nodes.config.children.rules.children["check-home"], "nested config rules command composed");

const executableNodes = listCommandNodes(catalog, { includeInternal: true })
  .filter(({ node }) => node.execution);
assert.ok(executableNodes.length > 20, "catalog exposes executable routes");
for (const { tokens, node } of executableNodes) {
  assert.ok(node.execution.adapter, `${tokens.join(" ")} has execution adapter`);
}

const rootHelp = renderHelp(catalog);
assert.match(rootHelp, /Primary commands:/);
assert.match(rootHelp, /package manage/);
assert.doesNotMatch(rootHelp, /skill render-commands/);
assert.doesNotMatch(rootHelp, /roborepo onboard/);
assert.equal(rootHelp.match(/package manage/g).length, 1);
assert.ok(rootHelp.indexOf("web") < rootHelp.indexOf("package manage"));
assert.ok(rootHelp.indexOf("package manage") < rootHelp.indexOf("update"));
assert.equal(promotedRootEntries(catalog).length, 1);
assert.equal(catalog.nodes.web.execution.prependArgs, undefined);
assert.deepEqual(catalog.nodes.web.interactiveArgs, ["--detach"]);

const packageHelp = renderHelp(catalog, catalog.nodes.package, ["package"]);
assert.match(packageHelp, /roborepo package - Manage and develop RoboRepo packages/);
assert.match(packageHelp, /package dev/);
assert.doesNotMatch(packageHelp, /telemetry status/);

const maintenanceHelp = renderHelp(catalog, catalog.nodes.maintenance, ["maintenance"]);
assert.match(maintenanceHelp, /maintenance doctor/);
assert.match(maintenanceHelp, /maintenance repair/);
assert.doesNotMatch(maintenanceHelp, /maintenance uninstall/);

assert.deepEqual(resolveCommand(catalog, ["help", "package", "dev"]), {
  kind: "help",
  node: catalog.nodes.package.children.dev,
  tokens: ["package", "dev"],
});
assert.deepEqual(resolveCommand(catalog, ["package", "dev", "--help"]), {
  kind: "help",
  node: catalog.nodes.package.children.dev,
  tokens: ["package", "dev"],
});
assert.deepEqual(resolveCommand(catalog, ["package", "dev", "help"]), {
  kind: "help",
  node: catalog.nodes.package.children.dev,
  tokens: ["package", "dev"],
});

const removed = resolveCommand(catalog, ["watch", "code", "."]);
assert.equal(removed.kind, "removed");
assert.deepEqual(removed.replacement.replacement, ["index", "code", "--watch"]);
assert.equal(resolveCommand(catalog, ["onboard"]).kind, "removed");
assert.equal(resolveCommand(catalog, ["verify", "--verbose"]).kind, "removed");
assert.equal(resolveCommand(catalog, ["enable"]).kind, "removed");
assert.equal(resolveCommand(catalog, ["disable"]).kind, "removed");

const watch = resolveCommand(catalog, ["index", "code", ".", "--watch"]);
assert.equal(watch.kind, "command");
assert.deepEqual(watch.tokens, ["index", "code"]);
assert.deepEqual(watch.args, [".", "--watch"]);

const namespaceWithDefaultExecution = resolveCommand(catalog, ["config", "rules", "--check"]);
assert.equal(namespaceWithDefaultExecution.kind, "command");
assert.deepEqual(namespaceWithDefaultExecution.tokens, ["config", "rules"]);
assert.deepEqual(resolveCommand(catalog, ["config", "rules"]).kind, "menu");

const activeDocPaths = [
  "README.md",
  "docs/reference/services/roborepo-cli.md",
  "docs/reference/services/roborepo.md",
  "docs/guides/setup-and-daily-use.md",
  "docs/guides/install-workflows.md",
  "docs/guides/first-time-setup.md",
  "docs/guides/telemetry.md",
  "docs/reference/services/jcodemunch.md",
  "docs/reference/services/jdocmunch.md",
  "docs/reference/services/portal.md",
  "docs/reference/services/plans-portal.md",
  "docs/reference/services/claude-hooks.md",
  "docs/reference/services/codex-hooks.md",
  "docs/reference/services/config-control-panel.md",
  "docs/reference/services/architecture.md",
  "docs/reference/internal/harness-anatomy.md",
  "docs/architecture/documentation-map-and-audit.md",
  "docs/guides/plan/lifecycle/plan-docs.md",
  "local/skills/roborepo-development/SKILL.md",
  "local/skills/roborepo-development/references/package-development.md",
  "globals/system/skills/roborepo-support/SKILL.md",
  "globals/packages/telemetry/package.config.json",
  "scripts/install/main.sh",
  "scripts/cli/config.mjs",
  "scripts/cli/package-probes.mjs",
  "scripts/cli/presets.mjs",
  "scripts/cli/telemetry.mjs",
  "scripts/cli/telemetry-seed-demo.mjs",
];
const removedCommandPattern = /\broborepo (?:onboard|serve|verify|watch code|enable|disable)\b(?!-)(?!` was replaced)/;
for (const docPath of activeDocPaths) {
  const content = fs.readFileSync(path.join(repoRoot, docPath), "utf8");
  assert.doesNotMatch(content, removedCommandPattern, `${docPath} documents removed top-level package commands`);
}

console.log("cli-command-catalog-check passed");

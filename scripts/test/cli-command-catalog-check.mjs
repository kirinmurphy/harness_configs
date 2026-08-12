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
assert.doesNotMatch(rootHelp, /skill render-commands/);
assert.doesNotMatch(rootHelp, /roborepo onboard/);
// `library` is the root-level front door for package management; `package manage` stays
// discoverable under the package namespace but is no longer promoted to root, so root help
// teaches one name for the workflow rather than two.
assert.match(rootHelp, /library/);
assert.doesNotMatch(rootHelp, /package manage/);
assert.equal(promotedRootEntries(catalog).length, 0);
// init leads the lifecycle vocabulary a new user reads first.
assert.match(rootHelp, /init/);
assert.ok(rootHelp.indexOf("init") < rootHelp.indexOf("web"));
assert.ok(rootHelp.indexOf("web") < rootHelp.indexOf("library"));
assert.ok(rootHelp.indexOf("library") < rootHelp.indexOf("update"));
assert.equal(catalog.nodes.web.execution.prependArgs, undefined);
assert.deepEqual(catalog.nodes.web.interactiveArgs, ["--detach"]);

// --- `library` and `package manage` are two entry points to one implementation. Sharing the
// packageLibrary execution preset makes divergence structurally impossible rather than a thing a
// future edit has to remember to keep in sync. ---
assert.deepEqual(
  catalog.nodes.library.execution,
  catalog.nodes.package.children.manage.execution,
  "library and package manage must resolve to identical execution",
);
assert.equal(catalog.nodes.library.execution.export, "presetsCommand");
assert.deepEqual(catalog.nodes.library.execution.prependArgs, ["onboard"]);

// --- init is a public root command; setup stays internal so it is never taught as a first-run step. ---
assert.equal(catalog.nodes.init.kind, "command");
assert.equal(catalog.nodes.init.execution.module, "scripts/cli/initialize.mjs");
assert.equal(catalog.nodes.setup.kind, "internal");

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
  "docs/user/reference/roborepo-cli.md",
  "docs/user/reference/roborepo.md",
  "docs/user/guides/setup-and-daily-use.md",
  "docs/user/guides/install-workflows.md",
  "docs/user/guides/first-time-setup.md",
  "docs/user/guides/telemetry.md",
  "docs/user/reference/jcodemunch.md",
  "docs/user/reference/jdocmunch.md",
  "docs/user/reference/portal.md",
  "docs/user/reference/plans-portal.md",
  "docs/user/reference/claude-hooks.md",
  "docs/user/reference/codex-hooks.md",
  "docs/user/reference/config-control-panel.md",
  "docs/user/reference/architecture.md",
  "docs/internal/harness-anatomy.md",
  "docs/architecture/documentation-map-and-audit.md",
  "docs/user/guides/plan/lifecycle/plan-docs.md",
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

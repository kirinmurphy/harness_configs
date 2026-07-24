#!/usr/bin/env node
import assert from "node:assert/strict";
import { loadCommandCatalog, listCommandNodes, promotedRootEntries } from "../cli/command-catalog.mjs";
import { validateExecutions } from "../cli/command-executor.mjs";
import { renderHelp } from "../cli/help-renderer.mjs";
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

const watch = resolveCommand(catalog, ["index", "code", ".", "--watch"]);
assert.equal(watch.kind, "command");
assert.deepEqual(watch.tokens, ["index", "code"]);
assert.deepEqual(watch.args, [".", "--watch"]);

const namespaceWithDefaultExecution = resolveCommand(catalog, ["config", "rules", "--check"]);
assert.equal(namespaceWithDefaultExecution.kind, "command");
assert.deepEqual(namespaceWithDefaultExecution.tokens, ["config", "rules"]);
assert.deepEqual(resolveCommand(catalog, ["config", "rules"]).kind, "menu");

console.log("cli-command-catalog-check passed");

import { childEntries, displayTokens, promotedRootEntries } from "./command-catalog.mjs";

export function renderHelp(catalog, node = null, tokens = []) {
  return node ? renderScopedHelp(catalog, node, tokens) : renderRootHelp(catalog);
}

function renderRootHelp(catalog) {
  const commands = rootRows(catalog, "command");
  const namespaces = rootRows(catalog, "namespace");
  const labels = catalog.helpLabels;
  return [
    `${catalog.commandName} - ${catalog.description}`,
    "",
    labels.usage,
    `  ${catalog.commandName}                       ${labels.openMenu}`,
    `  ${catalog.commandName} <namespace>           ${labels.openNamespaceMenu}`,
    `  ${catalog.commandName} <command> [options]   ${labels.runDirect}`,
    "",
    labels.primaryCommands,
    ...commands,
    "",
    labels.namespaces,
    ...namespaces,
    "",
    labels.scopedHelpHint,
  ].join("\n");
}

function renderScopedHelp(catalog, node, tokens) {
  if (node.kind === "command" || node.kind === "internal") {
    return [
      `${catalog.commandName} ${tokens.join(" ")} - ${node.description}`,
      "",
      catalog.helpLabels.usage,
      `  ${node.usage || `${catalog.commandName} ${tokens.join(" ")}`}`,
    ].join("\n");
  }

  const commands = childRows(node, tokens, "command");
  const namespaces = childRows(node, tokens, "namespace");
  return [
    `${catalog.commandName} ${tokens.join(" ")} - ${node.description}`,
    "",
    catalog.helpLabels.usage,
    `  ${catalog.commandName} ${tokens.join(" ")}                 ${catalog.helpLabels.openThisMenu}`,
    `  ${catalog.commandName} ${tokens.join(" ")} <command>       ${catalog.helpLabels.runDirect}`,
    "",
    ...(commands.length ? [catalog.helpLabels.commands, ...commands, ""] : []),
    ...(namespaces.length ? [catalog.helpLabels.namespaces, ...namespaces, ""] : []),
    catalog.helpLabels.deeperHelpHint.replace("{path}", tokens.join(" ")),
  ].join("\n").trimEnd();
}

function rootRows(catalog, kind) {
  if (kind !== "command") return childRows(catalog, [], kind);
  return rootCommandEntries(catalog)
    .map(({ tokens, node }) => `  ${commandLine(tokens, node.description)}`);
}

function childRows(nodeOrCatalog, tokens, kind) {
  return childEntries(nodeOrCatalog, { includeInternal: false, includeAdvanced: false })
    .filter(({ node }) => node.kind === kind)
    .map(({ key, node }) => `  ${commandLine(displayTokens(key, node, tokens), node.description)}`);
}

function rootCommandEntries(catalog) {
  const direct = childEntries(catalog, { includeInternal: false, includeAdvanced: false })
    .filter(({ node }) => node.kind === "command")
    .map(({ key, node }) => ({ tokens: displayTokens(key, node, []), node }));
  return [...direct, ...promotedRootEntries(catalog)]
    .sort((a, b) => (a.node.rootOrder ?? a.node.order ?? 0) - (b.node.rootOrder ?? b.node.order ?? 0));
}

function commandLine(tokens, description) {
  return `${tokens.join(" ").padEnd(14)} ${description}`;
}

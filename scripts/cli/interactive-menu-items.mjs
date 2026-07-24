import { childEntries, displayTokens, promotedRootEntries } from "./command-catalog.mjs";

export function menuItems(catalog, node, tokens) {
  const root = node || catalog;
  const entries = node ? childEntries(root, { includeInternal: false, includeAdvanced: false }) : rootEntries(catalog);
  const commandItems = entries
    .filter(({ node: child }) => child.interactive !== false)
    .map(({ key, node: child, tokens: childTokens }) => itemForChild(key, child, tokens, childTokens));
  return [...commandItems, ...navigationItems(catalog, Boolean(node))];
}

export function menuTitle(catalog, node, tokens) {
  const title = node ? node.title || tokens.join(" ") : catalog.title;
  return `${title}\n`;
}

function itemForChild(key, node, parentTokens, childTokens = null) {
  const tokens = childTokens || displayTokens(key, node, parentTokens);
  return {
    label: node.title || tokens.at(-1),
    desc: node.description || "",
    value: node.kind === "namespace"
      ? { action: "namespace", node, tokens }
      : { action: "command", node, tokens },
  };
}

function rootEntries(catalog) {
  const direct = childEntries(catalog, { includeInternal: false, includeAdvanced: false });
  return rootOrder([
    ...promotedRootEntries(catalog).map(({ tokens, node }) => ({ key: tokens.at(-1), node, tokens })),
    ...direct,
  ]);
}

function rootOrder(entries) {
  return entries.sort((a, b) => (a.node.rootOrder ?? a.node.order ?? 0) - (b.node.rootOrder ?? b.node.order ?? 0));
}

function navigationItems(catalog, includeBack) {
  return catalog.navigation
    .filter((item) => includeBack || item.action !== "back")
    .map((item) => item.kind === "header"
      ? { header: item.label }
      : { label: item.label, desc: item.description || "", value: { action: item.action } });
}

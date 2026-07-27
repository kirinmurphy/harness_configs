import { childEntries, displayTokens, promotedRootEntries } from "./command-catalog.mjs";

export function menuItems(catalog, node, tokens) {
  const root = node || catalog;
  const commandItems = node ? childMenuItems(root, tokens) : rootMenuItems(catalog);
  return [
    ...commandItems,
    ...(node ? [] : supportItems(catalog, tokens)),
    ...navigationItems(catalog, Boolean(node)),
  ];
}

export function menuTitle(catalog, node, tokens, notice = null) {
  const title = node ? node.title || tokens.join(" ") : "Main Menu";
  const heading = menuHeading(`${catalog.title.toUpperCase()} - ${title}`);
  return menuHeader({ heading, isSubmenu: Boolean(node), notice });
}

function menuHeading(label) {
  const width = Math.max(44, label.length + 8);
  const side = Math.max(2, Math.floor((width - label.length - 2) / 2));
  const left = "=".repeat(side);
  const right = "=".repeat(width - label.length - side - 2);
  return `${left} ${label} ${right}`;
}

function menuHeader({ heading, isSubmenu, notice }) {
  const lines = [];
  if (notice) {
    lines.push(formatNotice(notice));
    lines.push("");
  }
  lines.push(heading);
  if (isSubmenu) lines.push("\x1b[38;5;245mEsc - return to previous menu\x1b[0m");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function formatNotice(notice) {
  const item = typeof notice === "string" ? { text: notice, level: "success" } : notice;
  const color = {
    success: "32",
    warning: "33",
    error: "31",
  }[item.level] || "32";
  return `\x1b[1;${color}m** ${item.text}\x1b[0m`;
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

function childMenuItems(root, tokens) {
  const entries = childEntries(root, { includeInternal: false, includeAdvanced: false })
    .filter(({ node: child }) => child.interactive !== false)
    .flatMap(({ key, node: child, tokens: childTokens }) => menuEntriesForChild(key, child, tokens, childTokens));
  if (!entries.some(({ section }) => section)) return entries.map(({ item }) => item);

  const sections = [];
  const sectionItems = new Map();
  for (const entry of entries) {
    const section = entry.section || "Commands";
    if (!sectionItems.has(section)) {
      sections.push(section);
      sectionItems.set(section, []);
    }
    sectionItems.get(section).push(entry.item);
  }

  return sections.flatMap((section) => [{ header: section }, ...sectionItems.get(section)]);
}

function menuEntriesForChild(key, child, parentTokens, childTokens) {
  const tokensForChild = childTokens || displayTokens(key, child, parentTokens);
  if (child.collapseInMenu && child.kind === "namespace") {
    const visibleChildren = childEntries(child, { includeInternal: false, includeAdvanced: false })
      .filter(({ node }) => node.interactive !== false);
    if (visibleChildren.length === 1) {
      const only = visibleChildren[0];
      const tokens = displayTokens(only.key, only.node, tokensForChild);
      return [{ section: only.node.menuSection || child.menuSection || null, item: itemForChild(only.key, only.node, parentTokens, tokens) }];
    }
  }
  return [{ section: child.menuSection || null, item: itemForChild(key, child, parentTokens, tokensForChild) }];
}

function rootMenuItems(catalog) {
  const direct = childEntries(catalog, { includeInternal: false, includeAdvanced: false });
  const primary = rootOrder([
    ...promotedRootEntries(catalog).map(({ tokens, node }) => ({ key: tokens.at(-1), node, tokens })),
    ...direct.filter(({ key, node }) => node.kind === "command" && key !== "doctor"),
  ]);
  const modules = rootOrder(direct.filter(({ key, node }) => node.kind === "namespace" && key !== "maintenance"));
  return [
    ...primary
      .filter(({ node: child }) => child.interactive !== false)
      .map(({ key, node: child, tokens }) => itemForChild(key, child, [], tokens)),
    { header: "Agent Config" },
    ...modules
      .filter(({ node: child }) => child.interactive !== false)
      .map(({ key, node: child, tokens }) => itemForChild(key, child, [], tokens)),
  ];
}

function rootOrder(entries) {
  return entries.sort((a, b) =>
    (a.node.rootOrder ?? a.node.order ?? 0) - (b.node.rootOrder ?? b.node.order ?? 0)
    || (a.key || "").localeCompare(b.key || ""));
}

function navigationItems(catalog, includeBack) {
  return catalog.navigation
    .filter((item) => includeBack || item.action !== "help")
    .filter((item) => includeBack || item.action !== "back")
    .map((item) => item.kind === "header"
      ? { header: item.label }
      : { label: item.label, desc: item.description || "", value: { action: item.action } });
}

function supportItems(catalog, tokens) {
  const items = [
    { label: "Help", desc: "Show scoped help", value: { action: "help" } },
  ];
  const doctor = catalog.nodes.doctor;
  if (doctor && tokens[0] !== "maintenance") items.push({
    label: doctor.title || "Doctor",
    desc: doctor.description || "",
    value: { action: "command", node: doctor, tokens: ["doctor"] },
  });
  const maintenance = catalog.nodes.maintenance;
  if (maintenance && tokens[0] !== "maintenance") items.push({
    label: maintenance.title || "Maintenance",
    desc: maintenance.description || "",
    value: { action: "namespace", node: maintenance, tokens: ["maintenance"] },
  });
  return [{ header: "Support" }, ...items];
}

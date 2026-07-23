import { portalCopyText, portalEl as el, portalFillSlots as fill, portalTpl as tpl } from "/portal/shared/api.js";
import { statusText } from "./state.js";

const OTHER_INSTANCES = "Other instances";

export function emptyState(title, body) {
  return fill(tpl("tpl-empty"), { title, body });
}

export function notice(text) {
  return el("p", {}, text);
}

export function noticeWithDoc(text) {
  const node = el("p", {}, text, " ");
  node.append(el("a", { href: "/docs/reference/services/localhoster.md", target: "_blank", rel: "noreferrer" }, "Localhoster docs"));
  return node;
}

export function group(title, headerEnd, nodes) {
  const node = fill(tpl("tpl-group"), { title });
  const headerEndSlot = node.querySelector("[data-slot=meta]");
  if (headerEnd instanceof Node) headerEndSlot.append(headerEnd);
  else if (headerEnd != null) headerEndSlot.textContent = headerEnd;
  node.querySelector("[data-slot=items]").append(...nodes);
  return node;
}

export function toolbarActions() {
  return tpl("tpl-toolbar-actions");
}

export function collapsibleGroup(title, meta, nodes) {
  const node = fill(tpl("tpl-collapsible-group"), { meta, "expanded-title": title });
  node.querySelector("[data-slot=items]").append(...nodes);
  node.querySelector("[data-action=collapse]").addEventListener("click", (event) => {
    event.preventDefault();
    node.open = false;
  });
  return node;
}

export function instanceCard(project, instance, actions) {
  const node = fill(tpl("tpl-card"), {
    title: instanceTitle(project, instance),
    status: statusText(instance),
    latency: instance.latencyMs == null ? "unknown" : `${instance.latencyMs}ms`,
    process: `${instance.process.command} (${instance.process.pid})`,
    identity: `${instance.project?.evidence || project.evidence || "runtime"} · ${instance.project?.confidence || project.confidence || "low"}`,
    bind: `${instance.bind.address}:${instance.bind.port}`,
  });
  const origin = node.querySelector("[data-slot=origin]");
  if (instance.origin) {
    origin.textContent = instance.origin;
    origin.href = instance.origin;
  } else {
    origin.textContent = "origin unavailable";
    origin.removeAttribute("href");
  }
  const warning = node.querySelector("[data-slot=warning]");
  if (instance.bind.warning) {
    warning.hidden = false;
    warning.textContent = instance.bind.warning;
  }
  const duplicateNotice = node.querySelector("[data-slot=duplicate-notice]");
  if (instance.duplicatePorts?.length > 1) {
    duplicateNotice.hidden = false;
    duplicateNotice.textContent = `It looks like this project is running on multiple ports: ${instance.duplicatePorts.join(", ")}. You may have a leftover process to stop.`;
  }
  const links = node.querySelector("[data-slot=links]");
  for (const link of instance.app?.links || []) {
    const a = el("a", { href: link.url, target: "_blank", rel: "noreferrer", class: "quick-link" }, link.label);
    links.append(a);
  }
  if (!links.childElementCount) links.append(el("span", { class: "no-links" }, "No saved links"));
  wireCardActions(node, project, instance, actions);
  return node;
}

export function inactiveCard(project, actions) {
  const node = fill(tpl("tpl-card"), {
    title: project.name || project.app.name || "localhost app",
    status: "Inactive",
    latency: "not running",
    process: "not running",
    identity: project.identity,
    bind: "no active listener",
  });
  const origin = node.querySelector("[data-slot=origin]");
  origin.textContent = "saved routes only";
  node.querySelector("[data-action=copy]").hidden = true;
  node.querySelector("[data-action=open]").hidden = true;
  node.querySelector("[data-action=associate]").hidden = true;
  wireCardActions(node, { identity: project.identity, name: project.name }, { app: project.app, origin: null }, actions);
  return node;
}

export function linkRow(link = {}) {
  const node = tpl("tpl-link-row");
  node.querySelector("[data-field=id]").value = link.id || "";
  node.querySelector("[data-field=label]").value = link.label || "";
  node.querySelector("[data-field=path]").value = link.path || "";
  return node;
}

export function linkEmpty() {
  return el("p", { class: "no-links", "data-empty": "true" }, "No saved links. Add a row to create one.");
}

export function settingsSection(title, rows) {
  const node = fill(tpl("tpl-settings-section"), { title });
  const container = node.querySelector("[data-slot=rows]");
  if (rows.length) container.append(...rows);
  else container.append(el("p", { class: "no-links" }, "None"));
  return node;
}

export function settingsRow(title, meta, label, onClick) {
  const node = fill(tpl("tpl-settings-row"), { title, meta, action: label });
  node.querySelector("[data-slot=action]").addEventListener("click", onClick);
  return node;
}

function wireCardActions(node, project, instance, actions) {
  const trigger = node.querySelector("[data-action=menu]");
  const menu = node.querySelector("[data-menu]");
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    actions.onToggleMenu(node);
  });
  node.querySelector("[data-action=link]").addEventListener("click", () => {
    actions.onCloseMenus();
    actions.onAddLink(project, instance);
  });
  node.querySelector("[data-action=edit]").addEventListener("click", () => {
    actions.onCloseMenus();
    actions.onEditLinks(project, instance);
  });
  node.querySelector("[data-action=copy]").addEventListener("click", () => {
    actions.onCloseMenus();
    portalCopyText(instance.origin || "");
  });
  node.querySelector("[data-action=open]").addEventListener("click", () => {
    actions.onCloseMenus();
    if (instance.origin) window.open(instance.origin, "_blank", "noopener,noreferrer");
  });
  node.querySelector("[data-action=associate]").addEventListener("click", () => {
    actions.onCloseMenus();
    actions.onAssociate(project, instance);
  });
  node.querySelector("[data-action=alias]").addEventListener("click", () => {
    actions.onCloseMenus();
    actions.onAlias(project, instance);
  });
  node.querySelector("[data-action=favorite]").addEventListener("click", () => {
    actions.onCloseMenus();
    actions.onToggleFavorite(project, instance);
  });
  node.querySelector("[data-action=hide]").addEventListener("click", () => {
    actions.onCloseMenus();
    actions.onHide(project, instance);
  });
  menu.addEventListener("click", (event) => event.stopPropagation());
}

function instanceTitle(project, instance) {
  const projectName = project.name === OTHER_INSTANCES ? null : project.name;
  return projectName || instance.app?.name || instance.title || instance.process.command;
}

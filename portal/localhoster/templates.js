import { portalCopyText, portalEl as el, portalFillSlots as fill, portalTpl as tpl } from "/portal/shared/api.js";
import { statusText } from "./state.js";

export function statusPill(value, label) {
  return fill(tpl("tpl-status-pill"), { value, label });
}

export function emptyState(title, body) {
  return fill(tpl("tpl-empty"), { title, body });
}

export function notice(text) {
  return el("p", {}, text);
}

export function group(title, meta, nodes) {
  const node = fill(tpl("tpl-group"), { title, meta });
  node.querySelector("[data-slot=items]").append(...nodes);
  return node;
}

export function instanceCard(project, instance, actions) {
  const node = fill(tpl("tpl-card"), {
    title: instance.app?.name || project.name || instance.process.command,
    subtitle: project.name ? `${project.name} · ${instance.title || "localhost app"}` : instance.title || instance.project?.identity || "unmatched instance",
    status: statusText(instance),
    latency: instance.latencyMs == null ? "" : `${instance.latencyMs}ms`,
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
    title: project.app.name,
    subtitle: `${project.name} · inactive`,
    status: "Inactive",
    latency: "",
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

function wireCardActions(node, project, instance, actions) {
  node.querySelector("[data-action=link]").addEventListener("click", () => actions.onEditLinks(project, instance));
  node.querySelector("[data-action=edit]").addEventListener("click", () => actions.onEditLinks(project, instance));
  node.querySelector("[data-action=copy]").addEventListener("click", () => portalCopyText(instance.origin || ""));
  node.querySelector("[data-action=open]").addEventListener("click", () => {
    if (instance.origin) window.open(instance.origin, "_blank", "noopener,noreferrer");
  });
  node.querySelector("[data-action=associate]").addEventListener("click", () => actions.onAssociate(project, instance));
}

import { portalCopyText, portalFillSlots as fill, portalMiddleEllipsis, portalTpl as tpl } from "/portal/shared/api.js";
import { healthState, statusDetail, statusText, UNMATCHED_PROJECT_NAME } from "./state.js";

export function emptyState(title, body) {
  return fill(tpl("tpl-empty"), { title, body });
}

export function notice(text) {
  return fill(tpl("tpl-notice"), { text });
}

export function noticeWithDoc(text) {
  return fill(tpl("tpl-notice-with-doc"), { text });
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

// One card per Docker Compose project, its containers listed as compact rows rather than each
// getting its own top-level card — a Compose stack (app, db, proxy, mailhog...) is one logical
// operation, not N unrelated ones. Each container is its own row (not each published port) since a
// single container publishing several host ports (e.g. one Traefik proxy on 80/443/8080) is one
// operational unit, not three. See docs/plans/active/localhoster-compose-project-grouping.md.
export function composeProjectCard(composeProject, actions) {
  const allInstances = composeProject.containers.flatMap((c) => c.instances);
  const portCount = allInstances.length;
  // One CPU reading per container (not per port — a container's ports would otherwise multiply
  // its own CPU into the sum), same de-dup as composeContainerRow's own metrics line.
  const aggregateCpu = composeProject.containers.reduce((sum, c) => {
    const cpu = c.instances.find((i) => i.processMetrics)?.processMetrics?.cpuPercent;
    return cpu != null ? sum + cpu : sum;
  }, 0);
  const metaParts = [`${composeProject.containers.length} container${composeProject.containers.length === 1 ? "" : "s"}`, `${portCount} port${portCount === 1 ? "" : "s"}`];
  if (aggregateCpu > 0) metaParts.push(`${aggregateCpu.toFixed(1)}% CPU`);
  const node = fill(tpl("tpl-compose-project-card"), {
    title: composeProject.name,
    meta: metaParts.join(" · "),
  });
  applyGitBadge(node, node, composeProject.git, composeProject.providerUrl);
  wireCopyBranchButton(node, composeProject.git);
  const rows = node.querySelector("[data-slot=rows]");
  for (const container of composeProject.containers) {
    rows.append(composeContainerRow(container, actions));
  }
  wireComposeCardActions(node, composeProject, actions);
  return node;
}

// The action-menu trigger lives inside <summary> (the only child a closed <details> keeps
// rendered — everything else gets force-hidden by the UA stylesheet). Without preventDefault +
// stopPropagation, any click on it would also toggle the details open/closed via the native
// summary click behavior.
function wireComposeCardActions(node, composeProject, actions) {
  const trigger = node.querySelector("[data-action=menu]");
  const menu = node.querySelector("[data-menu]");
  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    actions.onToggleMenu(node);
  });
  node.querySelector("[data-action=repo]").addEventListener("click", (event) => {
    event.preventDefault();
    actions.onCloseMenus();
    actions.onAssociateRepo(composeProject);
  });
  node.querySelector("[data-action=favorite]").addEventListener("click", (event) => {
    event.preventDefault();
    actions.onCloseMenus();
    actions.onToggleFavorite(composeProject);
  });
  node.querySelector("[data-action=hide]").addEventListener("click", (event) => {
    event.preventDefault();
    actions.onCloseMenus();
    actions.onHide(composeProject);
  });
  menu.addEventListener("click", (event) => event.stopPropagation());
}

function composeContainerRow(container, actions) {
  const node = fill(tpl("tpl-compose-container-row"), {
    name: container.name,
  });
  const tooltip = node.querySelector(".info-wrap > template").content;
  fill(tooltip, {
    image: container.image || "unknown",
    state: container.state || "unknown",
  });
  // One PID serves every port a container publishes, so metrics are read off the first instance
  // that has them rather than repeated/recomputed per port.
  const metrics = node.querySelector("[data-slot=metrics]");
  const metricsSource = container.instances.find((i) => i.processMetrics)?.processMetrics;
  const metricsParts = [];
  if (metricsSource?.cpuPercent != null) metricsParts.push(`${metricsSource.cpuPercent}% CPU`);
  if (metricsSource?.residentMemoryKb != null) metricsParts.push(`${formatMemory(metricsSource.residentMemoryKb)} RSS`);
  if (metricsSource?.elapsedSeconds != null) metricsParts.push(`up ${formatElapsed(metricsSource.elapsedSeconds)}`);
  if (metricsParts.length) {
    metrics.hidden = false;
    metrics.textContent = metricsParts.join(" · ");
  }
  const ports = node.querySelector("[data-slot=ports]");
  for (const instance of container.instances) {
    const port = fill(tpl("tpl-compose-container-port"), {
      port: `:${instance.bind.port}`,
      status: `${statusText(instance)} (${statusDetail(instance)})`,
    });
    const origin = port.querySelector("[data-slot=origin]");
    if (instance.origin) {
      origin.textContent = displayOrigin(instance.origin);
      origin.href = instance.origin;
    } else {
      origin.textContent = "—";
      origin.removeAttribute("href");
    }
    const state = healthState(instance);
    if (state) port.dataset.health = state;
    port.querySelector("[data-slot=status-dot]").dataset.active = String(state === "healthy");
    const tooltip = port.querySelector(".info-wrap > template").content;
    fill(tooltip, {
      latency: instance.latencyMs == null ? "unknown" : `${instance.latencyMs}ms`,
      bind: `${instance.bind.address}:${instance.bind.port}`,
    });
    const warning = tooltip.querySelector("[data-slot=warning]");
    if (instance.bind.warning) {
      warning.hidden = false;
      warning.textContent = instance.bind.warning;
    }
    port.querySelector("[data-action=copy]").addEventListener("click", () => {
      portalCopyText(instance.origin || "");
    });
    const history = port.querySelector("[data-action=history]");
    if (!instance.opaqueKey || !actions?.onHistory) history.hidden = true;
    else history.addEventListener("click", () => actions.onHistory(null, instance));
    ports.append(port);
  }
  return node;
}

export function instanceCard(project, instance, actions) {
  const node = fill(tpl("tpl-card"), {
    title: instanceTitle(project, instance),
  });
  const tooltip = node.querySelector(".info-wrap > template").content;
  fill(tooltip, {
    status: `${statusText(instance)} (${statusDetail(instance)})`,
    latency: instance.latencyMs == null ? "unknown" : `${instance.latencyMs}ms`,
    process: `${instance.process.command} (${instance.process.pid})`,
    identity: `${instance.project?.evidence || project.evidence || "runtime"} · ${instance.project?.confidence || project.confidence || "low"}`,
    bind: `${instance.bind.address}:${instance.bind.port}`,
  });
  const state = healthState(instance);
  if (state) node.dataset.health = state;
  const gitInfo = instance.project?.git || project.git || null;
  applyGitBadge(node, tooltip, gitInfo, project.providerUrl || instance.project?.providerUrl || null);
  wireCopyBranchButton(node, gitInfo);
  applyDockerBadge(node, tooltip, instance.docker);
  applyProcessMetricsBadge(tooltip, instance.processMetrics);
  const origin = node.querySelector("[data-slot=origin]");
  if (instance.origin) {
    origin.textContent = instance.origin;
    origin.href = instance.origin;
  } else {
    origin.textContent = "origin unavailable";
    origin.removeAttribute("href");
  }
  const warning = tooltip.querySelector("[data-slot=warning]");
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
    const a = fill(tpl("tpl-quick-link"), { label: link.label });
    a.href = link.url;
    links.append(a);
  }
  if (!links.childElementCount) links.append(fill(tpl("tpl-no-links"), { text: "No saved links" }));
  wireCardActions(node, project, instance, actions);
  return node;
}

export function inactiveCard(project, actions) {
  const node = fill(tpl("tpl-card"), {
    title: project.name || project.app.name || "localhost app",
  });
  fill(node.querySelector(".info-wrap > template").content, {
    status: "Inactive",
    latency: "not running",
    process: "not running",
    identity: project.identity,
    bind: "no active listener",
  });
  node.querySelector("[data-slot=origin]").hidden = true;
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
  return tpl("tpl-link-empty");
}

export function settingsSection(title, rows) {
  const node = fill(tpl("tpl-settings-section"), { title });
  const container = node.querySelector("[data-slot=rows]");
  if (rows.length) container.append(...rows);
  else container.append(fill(tpl("tpl-no-links"), { text: "None" }));
  return node;
}

export function settingsRow(title, meta, label, onClick) {
  const node = fill(tpl("tpl-settings-row"), { title, meta, action: label });
  node.querySelector("[data-slot=action]").addEventListener("click", onClick);
  return node;
}

// Render Git context, distinguishing "no uncommitted changes" from "we could not tell". A dirty
// marker only appears for an explicit true; null means the subprocess could not answer, and drawing
// nothing there is the honest choice — a card that implied "clean" would be acted on.
function applyGitBadge(node, tooltip, git, providerUrl) {
  const badge = node.querySelector("[data-slot=git]");
  if (!badge || !git?.provider?.ok || (!git.branch && !git.shortHead)) return;

  badge.hidden = false;
  node.querySelector("[data-slot=git-branch]").textContent = git.detached
    ? "detached"
    : git.branch || "";

  const repoLink = node.querySelector("[data-slot=git-repo-link]");
  const repoName = node.querySelector("[data-slot=git-repo-name]");
  if (providerUrl) {
    repoLink.hidden = false;
    repoLink.href = providerUrl;
    const fullName = repoNameFromProviderUrl(providerUrl);
    repoLink.firstChild.textContent = portalMiddleEllipsis(fullName);
    repoLink.title = fullName;
  } else {
    repoName.hidden = false;
    repoName.textContent = "local repo";
  }

  // A dot, not a badge/text label — commit hash and "clean/dirty" as a boolean are rarely acted
  // on day to day; both stay available in the hover detail for the rare case (reset, diff) that
  // actually needs them, rather than claiming permanent top-level space.
  const dirty = node.querySelector("[data-slot=git-dirty]");
  dirty.classList.toggle("is-dirty", git.dirty === true);
  dirty.title = git.dirty === true ? "Uncommitted changes" : git.dirty === false ? "No uncommitted changes" : "Dirty state unavailable";

  const tracking = node.querySelector("[data-slot=git-tracking]");
  const marks = [];
  if (git.ahead) marks.push(`↑${git.ahead}`);
  if (git.behind) marks.push(`↓${git.behind}`);
  if (marks.length) {
    tracking.hidden = false;
    tracking.textContent = marks.join(" ");
    tracking.title = `${git.ahead || 0} ahead, ${git.behind || 0} behind ${git.upstream || "upstream"}`;
  }

  const summary = gitTooltip(git);
  badge.title = summary;
  tooltip.querySelector("[data-slot=git-detail]").hidden = false;
  tooltip.querySelector("[data-slot=git-detail-text]").textContent = summary;
}

function wireCopyBranchButton(node, git) {
  const button = node.querySelector("[data-action=copy-branch]");
  if (!button) return;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    portalCopyText(git?.detached ? git.shortHead || "" : git?.branch || "");
  });
}

// Docker/process fields are current-snapshot facts only — real provider data or nothing, never a
// placeholder. A card for an instance the Docker/process provider never observed shows no badge at
// all, matching the git badge's correct-or-absent discipline.
function applyDockerBadge(node, tooltip, docker) {
  const badge = node.querySelector("[data-slot=docker]");
  if (!badge || !docker) return;

  badge.hidden = false;
  node.querySelector("[data-slot=docker-label]").textContent = docker.composeService || docker.name || "container";

  const detail = tooltip.querySelector("[data-slot=docker-detail]");
  const parts = [docker.name || docker.containerId];
  if (docker.image) parts.push(docker.image);
  if (docker.composeProject) parts.push(`compose: ${docker.composeProject}${docker.composeService ? `/${docker.composeService}` : ""}`);
  if (docker.state) parts.push(docker.state);
  detail.hidden = false;
  tooltip.querySelector("[data-slot=docker-detail-text]").textContent = parts.join(" · ");
}

function applyProcessMetricsBadge(tooltip, metrics) {
  const detail = tooltip.querySelector("[data-slot=process-metrics-detail]");
  if (!detail || !metrics) return;

  const parts = [];
  if (metrics.cpuPercent != null) parts.push(`${metrics.cpuPercent}% CPU`);
  if (metrics.residentMemoryKb != null) parts.push(`${formatMemory(metrics.residentMemoryKb)} RSS`);
  if (metrics.elapsedSeconds != null) parts.push(`up ${formatElapsed(metrics.elapsedSeconds)}`);
  if (!parts.length) return;

  detail.hidden = false;
  tooltip.querySelector("[data-slot=process-metrics-detail-text]").textContent = parts.join(" · ");
}

function formatMemory(kb) {
  if (kb >= 1024 * 1024) return `${(kb / (1024 * 1024)).toFixed(1)}GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)}MB`;
  return `${kb}KB`;
}

function formatElapsed(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// Every localhost origin is http(s) by construction (see http-probe.mjs) — the scheme is never
// informative here, only visual noise, so the link keeps its real href but displays without it.
function displayOrigin(origin) {
  return origin.replace(/^https?:\/\//, "");
}

function repoNameFromProviderUrl(providerUrl) {
  try {
    const path = new URL(providerUrl).pathname.replace(/^\/|\/$/g, "");
    return path.split("/").pop() || path || "repo";
  } catch {
    return "repo";
  }
}

function gitTooltip(git) {
  const parts = [git.detached ? `detached at ${git.shortHead}` : `${git.branch} · ${git.shortHead}`];
  if (git.isWorktree) parts.push("linked worktree");
  parts.push(git.dirty === null ? "dirty state unavailable" : git.dirty ? "uncommitted changes" : "no uncommitted changes");
  if (git.upstream) parts.push(`tracking ${git.upstream}`);
  return parts.join(" · ");
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
  const history = node.querySelector("[data-action=history]");
  // Only an instance the current snapshot minted a key for has readable history.
  if (!instance.opaqueKey || !actions.onHistory) history.hidden = true;
  else {
    history.addEventListener("click", () => {
      actions.onCloseMenus();
      actions.onHistory(project, instance);
    });
  }
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
  const projectName = project.name === UNMATCHED_PROJECT_NAME ? null : project.name;
  return projectName || instance.app?.name || instance.title || instance.process.command;
}

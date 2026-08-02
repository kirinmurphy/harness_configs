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

// How a compose project's repository was established, weakest last. "auto-bind" is called out as
// inferred because, unlike a compose working_dir (which Compose guarantees is the project
// directory), it is derived from a container's bind-mount path — see collectGitForComposeProjects.
const REPO_PROVENANCE = {
  manual: "repo set manually",
  auto: "repo from compose working dir",
  "auto-bind": "repo inferred from mount path",
};

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
  //
  // Sums cpuPercentOfHost, never cpuPercent: docker stats reports percent of ONE core, so adding
  // those across an 11-container project produced numbers like 161% that meant nothing (neither a
  // share of the machine nor of a core). Percent-of-machine is the only figure that survives a sum.
  const aggregateCpu = composeProject.containers.reduce((sum, c) => {
    const cpu = c.instances.find((i) => i.processMetrics)?.processMetrics?.cpuPercentOfHost;
    return cpu != null ? sum + cpu : sum;
  }, 0);
  // CPU is deliberately absent from the persistent meta line: in practice these sit well under 1%,
  // so printing the number every time spends permanent space on a fact that almost never warrants
  // action. It moves to the tooltip, and only re-earns a persistent slot as a badge once it crosses
  // the concern threshold (see applyResourceConcernBadge).
  const metaParts = [`${composeProject.containers.length} container${composeProject.containers.length === 1 ? "" : "s"}`, `${portCount} port${portCount === 1 ? "" : "s"}`];
  const node = fill(tpl("tpl-compose-project-card"), {
    title: composeProject.name,
    meta: metaParts.join(" · "),
  });
  const tooltip = node.querySelector(".info-wrap > template").content;
  const aggregateMemoryKb = composeProject.containers.reduce((sum, c) => {
    const kb = c.instances.find((i) => i.processMetrics)?.processMetrics?.residentMemoryKb;
    return kb != null ? sum + kb : sum;
  }, 0);
  fill(tooltip, {
    containers: composeProject.containers.map((c) => c.name).join(", ") || "none",
    "ports-detail": String(portCount),
    resources: aggregateCpu > 0 || aggregateMemoryKb > 0
      ? `${aggregateCpu.toFixed(1)}% of machine CPU · ${formatMemory(aggregateMemoryKb)} RSS`
      : "unavailable",
    identity: `compose · ${REPO_PROVENANCE[composeProject.resolvedFrom] || "repo unresolved"}`,
  });
  applyGitBadge(node, tooltip, composeProject.git, composeProject.providerUrl);
  applyResourceConcernBadge(node, aggregateCpu);
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
  // One PID serves every port a container publishes, so metrics are read off the first instance
  // that has them rather than repeated/recomputed per port.
  const metricsSource = container.instances.find((i) => i.processMetrics)?.processMetrics;
  const metricsParts = [];
  // Both figures, because they answer different questions and `docker stats` only ever shows the
  // per-core one — printing only percent-of-machine would not match what the CLI reports.
  if (metricsSource?.cpuPercent != null) {
    metricsParts.push(metricsSource.cpuPercentOfHost != null
      ? `${metricsSource.cpuPercent}% of a core (${metricsSource.cpuPercentOfHost.toFixed(1)}% of machine)`
      : `${metricsSource.cpuPercent}% CPU`);
  }
  if (metricsSource?.residentMemoryKb != null) metricsParts.push(`${formatMemory(metricsSource.residentMemoryKb)} RSS`);
  if (metricsSource?.elapsedSeconds != null) metricsParts.push(`up ${formatElapsed(metricsSource.elapsedSeconds)}`);
  const tooltip = node.querySelector(".info-wrap > template").content;
  fill(tooltip, {
    image: container.image || "unknown",
    state: container.state || "unknown",
    // Raw numbers live here rather than on the row — see composeProjectCard for why a sub-1% CPU
    // reading does not earn permanent space.
    resources: metricsParts.join(" · ") || "unavailable",
  });
  applyResourceConcernBadge(node, metricsSource?.cpuPercentOfHost);
  const ports = node.querySelector("[data-slot=ports]");
  for (const instance of container.instances) {
    const port = fill(tpl("tpl-compose-container-port"), {
      status: `${statusText(instance)} (${statusDetail(instance)})`,
    });
    const origin = port.querySelector("[data-slot=origin]");
    if (instance.origin) {
      origin.textContent = displayOrigin(instance.origin);
      origin.href = instance.origin;
    } else {
      origin.textContent = `:${instance.bind.port}`;
      origin.removeAttribute("href");
    }
    const state = healthState(instance);
    if (state) port.dataset.health = state;
    applyPortHealthBadge(port, instance, state);
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

// One card per repository, holding every instance that resolves to it however discovery found it —
// a Compose stack, a dev server, and a tunnel launched from one repo previously rendered as three
// unrelated cards in three page sections (localhoster-repository-card-merge).
//
// Members keep their existing card kinds rather than being flattened into a new compact row: a
// listener stays a full instance card (quick links, association, alias, history all keep working)
// and a Compose stack stays its own sub-card, since `docker compose down` stops those containers as
// one unit. Merging is a grouping change, not a redesign of what a member is.
export function repositoryCard(repository, { instanceActions, composeActions }) {
  const memberCount = repository.members.length
    + repository.composeGroups.reduce((sum, group) => sum + group.containers.length, 0);
  const metaParts = [`${memberCount} member${memberCount === 1 ? "" : "s"}`];
  if (repository.composeGroups.length) {
    metaParts.push(`${repository.composeGroups.length} compose stack${repository.composeGroups.length === 1 ? "" : "s"}`);
  }
  const node = fill(tpl("tpl-repository-card"), {
    title: repository.name,
    meta: metaParts.join(" · "),
  });
  const tooltip = node.querySelector(".info-wrap > template").content;
  const memberNames = [
    ...repository.composeGroups.map((group) => `compose ${group.name}`),
    ...repository.members.map((member) => member.name),
  ];
  fill(tooltip, {
    "members-detail": memberNames.join(", ") || "none",
    // Same discipline as composeProjectCard: the raw figure lives here, and only crosses onto the
    // card as a badge once applyResourceConcernBadge decides it warrants action.
    resources: repository.cpuPercentOfHost != null
      ? `${repository.cpuPercentOfHost.toFixed(1)}% of machine CPU`
      : "unavailable",
    // A git: id is portable across machines and promotable to other pages; a local: id is stable
    // but derived from this machine's path, so the distinction is worth stating outright.
    identity: repository.identityKind === "git" ? "git repository" : "local repository (no remote)",
  });
  applyGitBadge(node, tooltip, repository.git, repository.providerUrl);
  applyResourceConcernBadge(node, repository.cpuPercentOfHost);
  wireCopyBranchButton(node, repository.git);

  const members = node.querySelector("[data-slot=members]");
  for (const group of repository.composeGroups) {
    members.append(composeProjectCard(group, composeActions));
  }
  for (const member of repository.members) {
    members.append(instanceCard(memberProject(repository, member), member.instance, instanceActions));
  }
  return node;
}

// Members arrive flattened for rendering, but instanceCard expects the project-shaped object the
// legacy collections handed it. Rebuild just the fields it reads, preferring the repository's git
// context (one root, one answer) over anything stale on the instance.
function memberProject(repository, member) {
  return {
    name: repository.name,
    identity: member.projectIdentity,
    git: repository.git,
    providerUrl: repository.providerUrl,
  };
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
  applyResourceConcernBadge(node, instance.processMetrics?.cpuPercentOfHost);
  const origin = node.querySelector("[data-slot=origin]");
  if (instance.origin) {
    // Display without the scheme (the href keeps it) — every origin on this page is http(s) by
    // construction, so the prefix is noise. Same treatment the compose port rows already used.
    origin.textContent = displayOrigin(instance.origin);
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
// The row itself is cloned from the shared tpl-git-row rather than pre-authored inside each card
// template: both card kinds expose only an empty [data-slot=git-row] container, so there is exactly
// one authored copy of this markup and the two cards cannot drift apart again.
function applyGitBadge(node, tooltip, git, providerUrl) {
  const row = node.querySelector("[data-slot=git-row]");
  if (!row || !git?.provider?.ok || (!git.branch && !git.shortHead)) return;

  const badge = tpl("tpl-git-row");
  row.append(badge);
  badge.hidden = false;
  badge.querySelector("[data-slot=git-branch]").textContent = git.detached
    ? "detached"
    : git.branch || "";

  const repoLink = badge.querySelector("[data-slot=git-repo-link]");
  const repoName = badge.querySelector("[data-slot=git-repo-name]");
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
  const dirty = badge.querySelector("[data-slot=git-dirty]");
  dirty.classList.toggle("is-dirty", git.dirty === true);
  dirty.title = git.dirty === true ? "Uncommitted changes" : git.dirty === false ? "No uncommitted changes" : "Dirty state unavailable";

  const tracking = badge.querySelector("[data-slot=git-tracking]");
  const marks = [];
  if (git.ahead) marks.push(`↑${git.ahead}`);
  if (git.behind) marks.push(`↓${git.behind}`);
  if (marks.length) {
    tracking.hidden = false;
    tracking.textContent = marks.join(" ");
    tracking.title = `${git.ahead || 0} ahead, ${git.behind || 0} behind ${git.upstream || "upstream"}`;
  }

  badge.title = gitTooltip(git);
  applyGitTooltipFields(tooltip, git);
}

// Branch, commit, and working-tree state are three independent facts; crammed onto one
// "main · b4c373f · no uncommitted changes · tracking origin/main" line they read as noise. Each
// gets its own labeled row, and any field the provider could not answer stays hidden rather than
// rendering an empty or guessed value.
function applyGitTooltipFields(tooltip, git) {
  const branch = tooltip.querySelector("[data-slot=git-detail]");
  if (branch) {
    branch.hidden = false;
    const parts = [git.detached ? "detached" : git.branch || "unknown"];
    if (git.isWorktree) parts.push("linked worktree");
    if (git.upstream) parts.push(`tracking ${git.upstream}`);
    tooltip.querySelector("[data-slot=git-detail-text]").textContent = parts.join(" · ");
  }
  const commit = tooltip.querySelector("[data-slot=git-commit-detail]");
  if (commit && git.shortHead) {
    commit.hidden = false;
    const marks = [];
    if (git.ahead) marks.push(`${git.ahead} ahead`);
    if (git.behind) marks.push(`${git.behind} behind`);
    tooltip.querySelector("[data-slot=git-commit-text]").textContent = marks.length
      ? `${git.shortHead} · ${marks.join(", ")}`
      : git.shortHead;
  }
  const status = tooltip.querySelector("[data-slot=git-status-detail]");
  if (status) {
    status.hidden = false;
    tooltip.querySelector("[data-slot=git-status-text]").textContent = git.dirty === null
      ? "dirty state unavailable"
      : git.dirty
        ? "uncommitted changes"
        : "no uncommitted changes";
  }
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

// Thresholds are percent of the WHOLE machine, so they mean the same thing for a single native
// process and for an 11-container Compose project. Measured against per-core percentages these
// would have fired on container count rather than real load.
//
// CPU only earns persistent space once it is worth acting on; below the warn threshold the number
// stays in the tooltip. Provisional fixed defaults — the plan doc's resource-threshold follow-up
// covers spike detection and per-project overrides, which this intentionally does not attempt.
const CPU_WARN_PERCENT_OF_HOST = 25;
const CPU_ALERT_PERCENT_OF_HOST = 60;

function applyResourceConcernBadge(node, cpuPercentOfHost) {
  const badge = node.querySelector("[data-slot=resource-concern]");
  if (!badge || cpuPercentOfHost == null || cpuPercentOfHost < CPU_WARN_PERCENT_OF_HOST) return;
  badge.hidden = false;
  badge.textContent = `${cpuPercentOfHost.toFixed(0)}% CPU`;
  const alert = cpuPercentOfHost >= CPU_ALERT_PERCENT_OF_HOST;
  badge.dataset.tone = alert ? "danger" : "warn";
  badge.title = `${cpuPercentOfHost.toFixed(1)}% of total machine CPU — ${alert ? "very high" : "elevated"}`;
}

// `unknown` deliberately maps to neutral, not warn: an unconfigured listener answering a 4xx is not
// a fault worth coloring, matching the same decision the card-level health accent already makes.
const PORT_HEALTH_TONES = {
  healthy: "ok",
  degraded: "warn",
  starting: "warn",
  unhealthy: "danger",
};

// Leading column of a port row: the HTTP status code when the probe actually returned one, and an
// explicit "No healthcheck" otherwise. A container port that never answers HTTP (Postgres, Redis)
// is not unhealthy — it was never checked — so it gets a neutral badge rather than a red one or a
// silently empty cell.
function applyPortHealthBadge(port, instance, state) {
  const badge = port.querySelector("[data-slot=health-badge]");
  if (!badge) return;
  if (instance.status) {
    badge.textContent = String(instance.status);
    badge.dataset.tone = PORT_HEALTH_TONES[state] || "neutral";
    badge.title = `${statusText(instance)} · ${statusDetail(instance)}`;
    return;
  }
  // "N/A", not "Not Found": this column also renders real 404s, and "Not Found" would make a
  // never-probed listener read as a failed one. Kept to status-code width so the badge column stays
  // aligned instead of one long label pushing every address out of line — full wording in the title.
  badge.textContent = "N/A";
  badge.dataset.tone = "neutral";
  badge.title = `No HTTP healthcheck · ${statusDetail(instance)}`;
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

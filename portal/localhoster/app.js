import { portalHideLoading, portalSetUpdatedAt } from "/portal/shared/api.js";
import * as api from "./api.js";
import * as state from "./state.js";
import * as tmpl from "./templates.js";

const refs = {
  status: document.getElementById("status-strip"),
  refreshState: document.getElementById("refresh-state"),
  refresh: document.getElementById("refresh"),
  settings: document.getElementById("settings"),
  search: document.getElementById("search"),
  capability: document.getElementById("capability"),
  warnings: document.getElementById("warnings"),
  content: document.getElementById("content"),
  linkDialog: document.getElementById("link-dialog"),
  linkForm: document.getElementById("link-form"),
  linkList: document.getElementById("link-list"),
  linkAdd: document.getElementById("link-add"),
  appDialog: document.getElementById("app-dialog"),
  appForm: document.getElementById("app-form"),
  appRemoveAssociation: document.getElementById("app-remove-association"),
  aliasDialog: document.getElementById("alias-dialog"),
  aliasForm: document.getElementById("alias-form"),
  settingsDialog: document.getElementById("settings-dialog"),
  settingsBody: document.getElementById("settings-body"),
};

let lastSnapshot = null;
let lastHash = null;
let pollTimer = null;

async function load({ force = false } = {}) {
  try {
    const snap = force ? await api.refreshLocalhoster() : await api.fetchLocalhoster();
    applySnapshot(snap);
  } catch (err) {
    showError(err.message);
  } finally {
    portalHideLoading();
  }
}

function applySnapshot(snapshot) {
  lastSnapshot = snapshot;
  const filtered = state.filterSnapshot(snapshot, refs.search.value);
  const hash = state.snapshotHash(filtered);
  if (hash !== lastHash) {
    lastHash = hash;
    render(filtered);
  }
  portalSetUpdatedAt(snapshot.generatedAt);
}

function render(snapshot) {
  const counts = state.snapshotCounts(snapshot);
  refs.status.replaceChildren(
    tmpl.statusPill(counts.active, "active apps"),
    tmpl.statusPill(counts.projects, "identified projects"),
    tmpl.statusPill(counts.unmatched, "unmatched"),
    tmpl.statusPill(counts.inactive, "inactive saved"),
    tmpl.statusPill(counts.hidden, "hidden"),
  );
  refs.refresh.disabled = snapshot.refresh?.state === "refreshing";
  refs.refresh.setAttribute("aria-busy", snapshot.refresh?.state === "refreshing" ? "true" : "false");
  refs.refreshState.textContent = snapshot.refresh?.state === "refreshing" ? "Refreshing..." : refreshLabel(snapshot);
  renderCapability(snapshot);
  renderWarnings(snapshot);
  const groups = [];
  if (snapshot.projects.length) {
    const activeNodes = snapshot.projects.flatMap((project) => project.instances.map((instance) => tmpl.instanceCard(project, instance, cardActions())));
    groups.push(tmpl.group("Active apps", `${activeNodes.length} running`, activeNodes));
  }
  if (snapshot.unmatchedInstances.length) {
    const nodes = snapshot.unmatchedInstances.map((instance) => tmpl.instanceCard({ name: "Other instances", identity: instance.project?.identity }, instance, cardActions()));
    groups.push(tmpl.collapsibleGroup("Other instances", `${nodes.length} hidden/noisy listeners`, nodes));
  }
  if (snapshot.inactiveProjects.length) {
    groups.push(tmpl.group("Inactive saved projects", `${snapshot.inactiveProjects.length} saved`, snapshot.inactiveProjects.map((project) => tmpl.inactiveCard(project, cardActions()))));
  }
  if (!groups.length) {
    refs.content.replaceChildren(tmpl.emptyState(
      snapshot.capabilities.discovery === "supported" ? "No active HTTP apps found" : "Saved projects remain available",
      snapshot.capabilities.discovery === "supported"
        ? "Refresh after starting a local development server."
        : snapshot.capabilities.message,
    ));
    return;
  }
  refs.content.replaceChildren(...groups);
}

function renderCapability(snapshot) {
  const cap = snapshot.capabilities;
  const unavailableProviders = Object.values(cap.providers || {})
    .filter((provider) => provider.state !== "supported")
    .map((provider) => provider.name);
  refs.capability.hidden = cap.discovery === "supported" && unavailableProviders.length === 0;
  refs.capability.replaceChildren();
  if (cap.discovery !== "supported") {
    refs.capability.append(tmpl.noticeWithDoc(`${cap.message} Saved projects and links remain available, but RoboRepo cannot currently detect their active ports.`));
  } else if (unavailableProviders.length) {
    refs.capability.append(tmpl.noticeWithDoc(`Some Localhoster providers are not active yet: ${unavailableProviders.join(", ")}.`));
  }
}

function renderWarnings(snapshot) {
  refs.warnings.hidden = !snapshot.warnings?.length && snapshot.refresh?.state !== "failed";
  refs.warnings.replaceChildren();
  for (const warning of snapshot.warnings || []) refs.warnings.append(tmpl.notice(warning));
  if (snapshot.refresh?.state === "failed") refs.warnings.append(tmpl.notice(`Last successful snapshot: ${snapshot.generatedAt}`));
}

function cardActions() {
  return {
    onAddLink: openAddLinkDialog,
    onEditLinks: openLinkDialog,
    onAssociate: openAppDialog,
    onAlias: openAliasDialog,
    onToggleFavorite: toggleFavorite,
    onHide: hideInstance,
    onToggleMenu: toggleActionMenu,
    onCloseMenus: closeActionMenus,
  };
}

function openAddLinkDialog(project, instance) {
  openLinkDialog(project, instance, { addBlank: true });
}

function openLinkDialog(project, instance, { addBlank = false } = {}) {
  const appId = instance.app?.id || "web";
  document.getElementById("link-project").value = project.identity || instance.project?.identity;
  document.getElementById("link-app").value = appId;
  document.getElementById("link-error").textContent = "";
  const links = state.currentLinks(lastSnapshot, project.identity || instance.project?.identity, appId);
  renderLinkRows(addBlank ? [...links, { label: "", path: "" }] : links);
  refs.linkDialog.showModal();
}

function openAppDialog(project, instance) {
  fillAppDialog(project, instance);
  document.getElementById("app-error").textContent = "";
  refs.appDialog.showModal();
}

function fillAppDialog(project, instance) {
  const projectIdentity = project.identity || instance.project?.identity || "";
  const appId = instance.app?.id || "web";
  const projectSettings = state.currentProjectSettings(lastSnapshot, projectIdentity) || {};
  const appSettings = state.currentAppSettings(lastSnapshot, projectIdentity, appId) || instance.app || {};
  document.getElementById("app-association").value = instance.associationKey || "";
  document.getElementById("app-project").value = projectIdentity;
  document.getElementById("app-project-name").value = project.name === "Other instances" ? "" : projectSettings.name || project.name || "";
  document.getElementById("app-id").value = appId;
  document.getElementById("app-name").value = appSettings.name || "Web";
  document.getElementById("app-origin").value = appSettings.originPreference || "localhost";
  document.getElementById("app-project-favorite").checked = projectSettings.favorite === true;
  document.getElementById("app-project-hidden").checked = projectSettings.hidden === true;
  document.getElementById("app-favorite").checked = appSettings.favorite === true;
  document.getElementById("app-hidden").checked = appSettings.hidden === true;
  document.getElementById("app-health-path").value = appSettings.health?.path || "";
  document.getElementById("app-health-statuses").value = state.csvList(appSettings.health?.acceptedStatuses);
  document.getElementById("app-match-process").value = state.csvList(appSettings.match?.process);
  document.getElementById("app-match-title").value = state.csvList(appSettings.match?.title);
  document.getElementById("app-match-path").value = state.csvList(appSettings.match?.path);
  refs.appRemoveAssociation.hidden = !instance.associationKey;
}

function openAliasDialog(project, instance) {
  document.getElementById("alias-from").value = instance.project?.identity || "";
  document.getElementById("alias-to").value = project.identity || instance.project?.identity || "";
  document.getElementById("alias-confirmed").checked = false;
  document.getElementById("alias-error").textContent = "";
  refs.aliasDialog.showModal();
}

refs.refresh.addEventListener("click", () => load({ force: true }));
refs.settings.addEventListener("click", () => {
  renderSettingsDialog();
  refs.settingsDialog.showModal();
});
refs.search.addEventListener("input", () => {
  if (lastSnapshot) applySnapshot(lastSnapshot);
});
document.addEventListener("click", closeActionMenus);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeActionMenus();
});
refs.linkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const projectIdentity = document.getElementById("link-project").value;
  const appId = document.getElementById("link-app").value;
  await mutateDialog(refs.linkDialog, "link-error", () => api.updateLinks({
    revision: lastSnapshot.settingsRevision,
    projectIdentity,
    appId,
    links: serializeLinkRows(),
  }));
});
refs.linkAdd.addEventListener("click", () => addLinkRow({ label: "", path: "" }));
refs.appForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const projectIdentity = document.getElementById("app-project").value;
  const appId = document.getElementById("app-id").value;
  await mutateDialog(refs.appDialog, "app-error", async () => {
    const assoc = document.getElementById("app-association").value;
    let revision = lastSnapshot.settingsRevision;
    if (assoc) {
      const associationResult = await api.updateAssociation({ revision, associationKey: assoc, projectIdentity, appId });
      lastSnapshot = associationResult.localhoster || associationResult;
      revision = lastSnapshot.settingsRevision;
    }
    const name = document.getElementById("app-project-name").value.trim();
    return api.updateProject({
      revision,
      projectIdentity,
      ...(name ? { name } : {}),
      favorite: document.getElementById("app-project-favorite").checked,
      hidden: document.getElementById("app-project-hidden").checked,
      appId,
      appName: document.getElementById("app-name").value,
      appFavorite: document.getElementById("app-favorite").checked,
      appHidden: document.getElementById("app-hidden").checked,
      originPreference: document.getElementById("app-origin").value,
      health: serializeHealth(),
      match: serializeMatch(),
    });
  });
});
refs.appRemoveAssociation.addEventListener("click", async () => {
  const associationKey = document.getElementById("app-association").value;
  if (!associationKey) return;
  await mutateDialog(refs.appDialog, "app-error", () => api.updateAssociation({
    revision: lastSnapshot.settingsRevision,
    associationKey,
    remove: true,
  }));
});
refs.aliasForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await mutateDialog(refs.aliasDialog, "alias-error", () => api.updateAlias({
    revision: lastSnapshot.settingsRevision,
    from: document.getElementById("alias-from").value,
    to: document.getElementById("alias-to").value,
    confirmed: document.getElementById("alias-confirmed").checked,
  }));
});
for (const close of document.querySelectorAll("[data-close]")) {
  close.addEventListener("click", () => close.closest("dialog").close());
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearInterval(pollTimer);
  else {
    load();
    pollTimer = setInterval(load, 10000);
  }
});

async function mutateDialog(dialog, errorId, mutate) {
  document.getElementById(errorId).textContent = "";
  try {
    const result = await mutate();
    applySnapshot(result.localhoster || result);
    dialog.close();
  } catch (err) {
    document.getElementById(errorId).textContent = err.message;
  }
}

function toggleActionMenu(card) {
  const menu = card.querySelector("[data-menu]");
  const trigger = card.querySelector("[data-action=menu]");
  const willOpen = menu.hidden;
  closeActionMenus();
  menu.hidden = !willOpen;
  trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
}

function closeActionMenus() {
  for (const menu of refs.content.querySelectorAll("[data-menu]")) {
    menu.hidden = true;
    menu.closest(".instance-card")?.querySelector("[data-action=menu]")?.setAttribute("aria-expanded", "false");
  }
}

async function toggleFavorite(project, instance) {
  const projectIdentity = project.identity || instance.project?.identity;
  const appId = instance.app?.id || "web";
  try {
    const result = await api.updateProject({
      revision: lastSnapshot.settingsRevision,
      projectIdentity,
      appId,
      appFavorite: !(instance.app?.favorite === true),
    });
    applySnapshot(result.localhoster || result);
  } catch (err) {
    showError(err.message);
  }
}

async function hideInstance(project, instance) {
  const projectIdentity = project.identity || instance.project?.identity;
  const appId = instance.app?.id || "web";
  try {
    let revision = lastSnapshot.settingsRevision;
    if (instance.associationKey && !instance.app?.id) {
      const associationResult = await api.updateAssociation({ revision, associationKey: instance.associationKey, projectIdentity, appId });
      lastSnapshot = associationResult.localhoster || associationResult;
      revision = lastSnapshot.settingsRevision;
    }
    const result = await api.updateProject({ revision, projectIdentity, appId, appHidden: true });
    applySnapshot(result.localhoster || result);
  } catch (err) {
    showError(err.message);
  }
}

function renderSettingsDialog() {
  refs.settingsBody.replaceChildren(
    tmpl.settingsSection("Hidden", hiddenRows()),
    tmpl.settingsSection("Associations", associationRows()),
    tmpl.settingsSection("Aliases", aliasRows()),
  );
}

function hiddenRows() {
  return (lastSnapshot.settings?.hidden || []).map((item) => tmpl.settingsRow(
    item.kind === "project" ? item.name : `${item.name} / ${item.app.name}`,
    item.kind === "project" ? item.identity : `${item.identity}#${item.app.id}`,
    "Restore",
    () => restoreHidden(item),
  ));
}

function associationRows() {
  return (lastSnapshot.settings?.associations || []).map((item) => tmpl.settingsRow(
    item.key,
    `${item.projectIdentity}#${item.appId}`,
    "Remove",
    () => removeAssociation(item.key),
  ));
}

function aliasRows() {
  return (lastSnapshot.settings?.aliases || []).map((item) => tmpl.settingsRow(
    item.from,
    item.to,
    "Remove",
    () => removeAlias(item.from),
  ));
}

async function restoreHidden(item) {
  await mutateSettings(() => api.updateProject({
    revision: lastSnapshot.settingsRevision,
    projectIdentity: item.identity,
    ...(item.kind === "project" ? { hidden: false } : { appId: item.app.id, appHidden: false }),
  }));
}

async function removeAssociation(associationKey) {
  await mutateSettings(() => api.updateAssociation({ revision: lastSnapshot.settingsRevision, associationKey, remove: true }));
}

async function removeAlias(from) {
  await mutateSettings(() => api.updateAlias({ revision: lastSnapshot.settingsRevision, from, remove: true }));
}

async function mutateSettings(mutate) {
  try {
    const result = await mutate();
    applySnapshot(result.localhoster || result);
    renderSettingsDialog();
  } catch (err) {
    showError(err.message);
  }
}

function renderLinkRows(links) {
  refs.linkList.replaceChildren();
  for (const link of links) addLinkRow(link);
  if (!links.length) refs.linkList.append(tmpl.linkEmpty());
}

function addLinkRow(link) {
  refs.linkList.querySelector("[data-empty]")?.remove();
  const row = tmpl.linkRow(link);
  row.querySelector("[data-action=remove]").addEventListener("click", () => {
    row.remove();
    if (!refs.linkList.querySelector(".link-row")) refs.linkList.append(tmpl.linkEmpty());
  });
  row.querySelector("[data-action=up]").addEventListener("click", () => moveLinkRow(row, -1));
  row.querySelector("[data-action=down]").addEventListener("click", () => moveLinkRow(row, 1));
  refs.linkList.append(row);
  return row;
}

function moveLinkRow(row, direction) {
  const sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
  if (!sibling || sibling.hasAttribute("data-empty")) return;
  if (direction < 0) refs.linkList.insertBefore(row, sibling);
  else refs.linkList.insertBefore(sibling, row);
}

function serializeLinkRows() {
  return [...refs.linkList.querySelectorAll(".link-row")].map((row) => {
    const id = row.querySelector("[data-field=id]").value;
    return {
      ...(id ? { id } : {}),
      label: row.querySelector("[data-field=label]").value,
      path: row.querySelector("[data-field=path]").value,
    };
  });
}

function serializeHealth() {
  const path = document.getElementById("app-health-path").value.trim();
  const acceptedStatuses = state.parseCsvList(document.getElementById("app-health-statuses").value).map((value) => Number(value));
  return {
    ...(path ? { path } : {}),
    ...(acceptedStatuses.length ? { acceptedStatuses } : {}),
  };
}

function serializeMatch() {
  return {
    process: state.parseCsvList(document.getElementById("app-match-process").value),
    title: state.parseCsvList(document.getElementById("app-match-title").value),
    path: state.parseCsvList(document.getElementById("app-match-path").value),
  };
}

function showError(message) {
  refs.warnings.hidden = false;
  refs.warnings.replaceChildren(tmpl.notice(message));
}

function refreshLabel(snapshot) {
  if (snapshot.refresh?.state === "failed") return "Refresh failed";
  if (snapshot.refresh?.state === "stale") return "Stale";
  return "Idle";
}

load();
pollTimer = setInterval(load, 10000);

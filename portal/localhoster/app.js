import { portalHideLoading, portalSetUpdatedAt } from "/portal/shared/api.js";
import * as api from "./api.js";
import * as state from "./state.js";
import * as tmpl from "./templates.js";

const refs = {
  status: document.getElementById("status-strip"),
  refreshState: document.getElementById("refresh-state"),
  refresh: document.getElementById("refresh"),
  search: document.getElementById("search"),
  capability: document.getElementById("capability"),
  warnings: document.getElementById("warnings"),
  content: document.getElementById("content"),
  linkDialog: document.getElementById("link-dialog"),
  linkForm: document.getElementById("link-form"),
  appDialog: document.getElementById("app-dialog"),
  appForm: document.getElementById("app-form"),
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
  );
  refs.refreshState.textContent = snapshot.refresh?.state === "refreshing" ? "Refreshing..." : refreshLabel(snapshot);
  renderCapability(snapshot);
  renderWarnings(snapshot);
  const groups = [];
  if (snapshot.projects.length) {
    for (const project of snapshot.projects) {
      groups.push(tmpl.group(project.name, `${project.instances.length} active`, project.instances.map((instance) => tmpl.instanceCard(project, instance, cardActions()))));
    }
  }
  if (snapshot.unmatchedInstances.length) {
    const nodes = snapshot.unmatchedInstances.map((instance) => tmpl.instanceCard({ name: "Other instances", identity: instance.project?.identity }, instance, cardActions()));
    groups.push(tmpl.group("Other instances", `${nodes.length} needs association`, nodes));
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
  refs.capability.hidden = cap.discovery === "supported";
  refs.capability.replaceChildren();
  if (cap.discovery !== "supported") {
    refs.capability.append(tmpl.notice(`${cap.message} Saved projects and links remain available, but RoboRepo cannot currently detect their active ports.`));
  }
}

function renderWarnings(snapshot) {
  refs.warnings.hidden = !snapshot.warnings?.length && snapshot.refresh?.state !== "failed";
  refs.warnings.replaceChildren();
  for (const warning of snapshot.warnings || []) refs.warnings.append(tmpl.notice(warning));
  if (snapshot.refresh?.state === "failed") refs.warnings.append(tmpl.notice(`Last successful snapshot: ${snapshot.generatedAt}`));
}

function cardActions() {
  return { onEditLinks: openLinkDialog, onAssociate: openAppDialog };
}

function openLinkDialog(project, instance) {
  const appId = instance.app?.id || "web";
  document.getElementById("link-project").value = project.identity || instance.project?.identity;
  document.getElementById("link-app").value = appId;
  document.getElementById("link-label").value = "";
  document.getElementById("link-path").value = "";
  document.getElementById("link-error").textContent = "";
  refs.linkDialog.showModal();
}

function openAppDialog(project, instance) {
  document.getElementById("app-association").value = instance.associationKey || "";
  document.getElementById("app-project").value = project.identity || instance.project?.identity || "";
  document.getElementById("app-id").value = instance.app?.id || "web";
  document.getElementById("app-name").value = instance.app?.name || "Web";
  document.getElementById("app-origin").value = instance.app?.originPreference || "localhost";
  document.getElementById("app-error").textContent = "";
  refs.appDialog.showModal();
}

refs.refresh.addEventListener("click", () => load({ force: true }));
refs.search.addEventListener("input", () => {
  if (lastSnapshot) applySnapshot(lastSnapshot);
});
refs.linkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const projectIdentity = document.getElementById("link-project").value;
  const appId = document.getElementById("link-app").value;
  const existing = state.currentLinks(lastSnapshot, projectIdentity, appId);
  const label = document.getElementById("link-label").value;
  const path = document.getElementById("link-path").value;
  await mutateDialog(refs.linkDialog, "link-error", () => api.updateLinks({
    revision: lastSnapshot.settingsRevision,
    projectIdentity,
    appId,
    links: [...existing, { label, path }],
  }));
});
document.getElementById("link-remove").addEventListener("click", async () => {
  const projectIdentity = document.getElementById("link-project").value;
  const appId = document.getElementById("link-app").value;
  const links = state.currentLinks(lastSnapshot, projectIdentity, appId).slice(0, -1);
  await mutateDialog(refs.linkDialog, "link-error", () => api.updateLinks({ revision: lastSnapshot.settingsRevision, projectIdentity, appId, links }));
});
refs.appForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const projectIdentity = document.getElementById("app-project").value;
  const appId = document.getElementById("app-id").value;
  await mutateDialog(refs.appDialog, "app-error", async () => {
    const assoc = document.getElementById("app-association").value;
    if (assoc) await api.updateAssociation({ revision: lastSnapshot.settingsRevision, associationKey: assoc, projectIdentity, appId });
    return api.updateProject({
      revision: lastSnapshot.settingsRevision + (assoc ? 1 : 0),
      projectIdentity,
      appId,
      appName: document.getElementById("app-name").value,
      originPreference: document.getElementById("app-origin").value,
    });
  });
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

import { portalHideLoading, portalSetUpdatedAt } from "/portal/shared/api.js";
import * as api from "./api.js";
import * as state from "./state.js";
import * as tmpl from "./templates.js";
import { createHistoryView } from "./history-view.js";

// A stale opaque key (the app moved ports since this render) resolves by reloading the snapshot
// rather than surfacing an error.
const historyView = createHistoryView({ onStale: () => load({ force: true }) });

// Built once and reused across every render/reconcile — the Active apps header holds this same
// node for the page's lifetime so refresh/settings listeners and live spinner state never get
// torn down by a rebuild.
const toolbarActionsNode = tmpl.toolbarActions();

const refs = {
  refresh: toolbarActionsNode.querySelector("#refresh"),
  refreshSpinner: toolbarActionsNode.querySelector(".spinner"),
  refreshIcon: toolbarActionsNode.querySelector("svg"),
  settings: toolbarActionsNode.querySelector("#settings"),
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
// Cards the auto-poll last rendered, by stable key, so a poll can update/add/mark-offline
// in place instead of tearing down DOM the user may be interacting with (open <details>,
// open action menu, a link about to be clicked).
const renderedCards = new Map();

// force: true is a user-clicked refresh, not the silent background poll. A user click is a good
// moment to clear any cards marked offline by earlier polls — the user just took an action and
// expects the view to reflect current reality, so a full rebuild (reconcile: false) is fine here
// even though the background poll must never do that on its own.
async function load({ force = false } = {}) {
  if (force) setRefreshing(true);
  try {
    const snap = force
      ? await api.refreshLocalhoster()
      : await api.fetchLocalhoster();
    applySnapshot(snap, { reconcile: !force });
  } catch (err) {
    showError(err.message);
  } finally {
    portalHideLoading();
    if (force) setRefreshing(false);
  }
}

function setRefreshing(refreshing) {
  refs.refresh.disabled = refreshing;
  refs.refresh.setAttribute("aria-busy", refreshing ? "true" : "false");
  refs.refreshSpinner.hidden = !refreshing;
  refs.refreshIcon.hidden = refreshing;
}

// `reconcile: true` (background poll) patches existing cards in place and never removes a
// card that disappeared from the snapshot — it's marked offline instead. User-triggered
// mutations (hide/favorite/associate/alias/settings) pass reconcile: false (the default) and
// get an immediate full rebuild, since the user just took an action and expects it reflected
// right away.
function applySnapshot(snapshot, { reconcile = false } = {}) {
  lastSnapshot = snapshot;
  const hash = state.snapshotHash(snapshot);
  // The hash-skip only makes sense for the reconcile path, where "nothing changed" really does
  // mean nothing to do. A full rebuild (reconcile: false) can be the only thing that clears
  // offline-marked cards — that's client-only DOM state the server-side hash knows nothing
  // about — so a full rebuild must always render even when the snapshot itself looks unchanged.
  if (hash !== lastHash || !reconcile) {
    lastHash = hash;
    render(snapshot, { reconcile });
  }
  portalSetUpdatedAt(snapshot.generatedAt);
}

function render(snapshot, { reconcile }) {
  renderWarnings(snapshot);

  const sections = [
    {
      id: "active",
      kind: "group",
      title: "Running now",
      headerEnd: toolbarActionsNode,
      // Refresh/Settings live in this header, so it must always render even with zero active
      // apps — otherwise those controls would vanish along with the empty-state fallback.
      alwaysShow: true,
      cards: snapshot.projects.flatMap((project) =>
        project.instances.map((instance) => ({
          key: instance.associationKey,
          hash: JSON.stringify(instance) + JSON.stringify(project),
          build: () => tmpl.instanceCard(project, instance, cardActions()),
        })),
      ),
    },
    {
      id: "unmatched",
      kind: "collapsible",
      title: "Unrecognized listeners",
      meta: (n) => `${n} other hidden/noisy listeners`,
      cards: snapshot.unmatchedInstances.map((instance) => ({
        key: instance.associationKey,
        hash: JSON.stringify(instance),
        build: () =>
          tmpl.instanceCard(
            { name: "Other instances", identity: instance.project?.identity },
            instance,
            cardActions(),
          ),
      })),
    },
    {
      id: "inactive",
      kind: "group",
      title: "Inactive saved projects",
      meta: (n) => `${n} saved`,
      cards: snapshot.inactiveProjects.map((project) => ({
        key: `${project.identity}#${project.app?.id || ""}`,
        hash: JSON.stringify(project),
        build: () => tmpl.inactiveCard(project, cardActions()),
      })),
    },
  ];

  if (!reconcile) {
    renderedCards.clear();
    const visible = sections.filter(
      (section) => section.cards.length || section.alwaysShow,
    );
    refs.content.replaceChildren(...visible.map(buildSection));
    if (!sections.some((section) => section.cards.length)) {
      refs.content.append(emptyStateNode(snapshot));
    }
    return;
  }

  reconcileSections(sections, snapshot);
}

function emptyStateNode(snapshot) {
  if (snapshot.capabilities.discovery === "supported") {
    return tmpl.emptyState(
      "No active HTTP apps found",
      "Refresh after starting a local development server.",
    );
  }
  return tmpl.emptyState(
    "Saved projects remain available",
    tmpl.noticeWithDoc(snapshot.capabilities.message),
  );
}

function buildSection(section) {
  const nodes = section.cards.map(({ key, hash, build }) => {
    const node = build();
    renderedCards.set(sectionCardKey(section.id, key), {
      node,
      hash,
      offline: false,
    });
    return node;
  });
  const groupEl =
    section.kind === "collapsible"
      ? tmpl.collapsibleGroup(section.title, section.meta(nodes.length), nodes)
      : tmpl.group(
          section.title,
          section.headerEnd ?? section.meta(nodes.length),
          nodes,
        );
  groupEl.dataset.sectionId = section.id;
  return groupEl;
}

function sectionCardKey(sectionId, key) {
  return `${sectionId}::${key}`;
}

// Auto-poll reconciliation: updates/adds cards without ever removing one that vanished from
// the snapshot (marks it offline instead) and never rebuilds a section's group/details element,
// so open <details>, an open action menu, or a click in flight all survive a background poll.
function reconcileSections(sections, snapshot) {
  for (const section of sections) reconcileSection(section);
  const anyVisible = [...renderedCards.values()].some(
    (entry) => !entry.offline,
  );
  const emptyNode = refs.content.querySelector(".empty-state");
  if (!anyVisible && !emptyNode) {
    refs.content.append(emptyStateNode(snapshot));
  } else if (anyVisible && emptyNode) {
    emptyNode.remove();
  }
}

function reconcileSection(section) {
  const existingGroup = refs.content.querySelector(
    `[data-section-id="${section.id}"]`,
  );
  if (!section.cards.length && !existingGroup && !section.alwaysShow) return;
  const groupEl = existingGroup || appendSection(section);
  const grid = groupEl.querySelector(".instance-grid");

  const seenKeys = new Set();
  let index = 0;
  for (const { key, hash, build } of section.cards) {
    const cardKey = sectionCardKey(section.id, key);
    seenKeys.add(cardKey);
    const existing = renderedCards.get(cardKey);
    if (!existing) {
      const node = build();
      renderedCards.set(cardKey, { node, hash, offline: false });
      grid.insertBefore(node, grid.children[index] || null);
    } else if (
      (existing.offline || existing.hash !== hash) &&
      !hasOpenMenu(existing.node)
    ) {
      const node = build();
      existing.node.replaceWith(node);
      renderedCards.set(cardKey, { node, hash, offline: false });
    }
    index += 1;
  }
  for (const [cardKey, entry] of renderedCards) {
    if (
      !cardKey.startsWith(`${section.id}::`) ||
      seenKeys.has(cardKey) ||
      entry.offline
    )
      continue;
    if (hasOpenMenu(entry.node)) continue;
    markCardOffline(entry.node);
    entry.offline = true;
  }
  if (section.meta) {
    const visibleCount = grid.querySelectorAll(
      ".instance-card:not(.is-offline)",
    ).length;
    groupEl.querySelector("[data-slot=meta]").textContent =
      section.meta(visibleCount);
  }
}

function hasOpenMenu(node) {
  const menu = node.querySelector("[data-menu]");
  return !!menu && !menu.hidden;
}

function appendSection(section) {
  const groupEl = buildSection({ ...section, cards: [] });
  refs.content.append(groupEl);
  return groupEl;
}

function markCardOffline(node) {
  node.classList.add("is-offline");
  const trigger = node.querySelector("[data-action=menu]");
  if (trigger) trigger.disabled = true;
  node.querySelector("[data-menu]")?.setAttribute("hidden", "");
}

function renderWarnings(snapshot) {
  refs.warnings.hidden =
    !snapshot.warnings?.length && snapshot.refresh?.state !== "failed";
  refs.warnings.replaceChildren();
  for (const warning of snapshot.warnings || [])
    refs.warnings.append(tmpl.notice(warning));
  if (snapshot.refresh?.state === "failed")
    refs.warnings.append(
      tmpl.notice(`Last successful snapshot: ${snapshot.generatedAt}`),
    );
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
    onHistory: (project, instance) => historyView.open(project, instance),
  };
}

function openAddLinkDialog(project, instance) {
  openLinkDialog(project, instance, { addBlank: true });
}

function openLinkDialog(project, instance, { addBlank = false } = {}) {
  const appId = instance.app?.id || "web";
  document.getElementById("link-project").value =
    project.identity || instance.project?.identity;
  document.getElementById("link-app").value = appId;
  document.getElementById("link-error").textContent = "";
  const links = state.currentLinks(
    lastSnapshot,
    project.identity || instance.project?.identity,
    appId,
  );
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
  const projectSettings =
    state.currentProjectSettings(lastSnapshot, projectIdentity) || {};
  const appSettings =
    state.currentAppSettings(lastSnapshot, projectIdentity, appId) ||
    instance.app ||
    {};
  document.getElementById("app-association").value =
    instance.associationKey || "";
  document.getElementById("app-project").value = projectIdentity;
  document.getElementById("app-project-name").value =
    project.name === "Other instances"
      ? ""
      : projectSettings.name || project.name || "";
  document.getElementById("app-id").value = appId;
  document.getElementById("app-name").value = appSettings.name || "Web";
  document.getElementById("app-origin").value =
    appSettings.originPreference || "localhost";
  document.getElementById("app-project-favorite").checked =
    projectSettings.favorite === true;
  document.getElementById("app-project-hidden").checked =
    projectSettings.hidden === true;
  document.getElementById("app-favorite").checked =
    appSettings.favorite === true;
  document.getElementById("app-hidden").checked = appSettings.hidden === true;
  document.getElementById("app-health-path").value =
    appSettings.health?.path || "";
  document.getElementById("app-health-statuses").value = state.csvList(
    appSettings.health?.acceptedStatuses,
  );
  document.getElementById("app-match-process").value = state.csvList(
    appSettings.match?.process,
  );
  document.getElementById("app-match-title").value = state.csvList(
    appSettings.match?.title,
  );
  document.getElementById("app-match-path").value = state.csvList(
    appSettings.match?.path,
  );
  refs.appRemoveAssociation.hidden = !instance.associationKey;
}

function openAliasDialog(project, instance) {
  document.getElementById("alias-from").value =
    instance.project?.identity || "";
  document.getElementById("alias-to").value =
    project.identity || instance.project?.identity || "";
  document.getElementById("alias-confirmed").checked = false;
  document.getElementById("alias-error").textContent = "";
  refs.aliasDialog.showModal();
}

refs.refresh.addEventListener("click", () => load({ force: true }));
refs.settings.addEventListener("click", () => {
  renderSettingsDialog();
  refs.settingsDialog.showModal();
});
document.addEventListener("click", closeActionMenus);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeActionMenus();
});
refs.linkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const projectIdentity = document.getElementById("link-project").value;
  const appId = document.getElementById("link-app").value;
  await mutateDialog(refs.linkDialog, "link-error", () =>
    api.updateLinks({
      revision: lastSnapshot.settingsRevision,
      projectIdentity,
      appId,
      links: serializeLinkRows(),
    }),
  );
});
refs.linkAdd.addEventListener("click", () =>
  addLinkRow({ label: "", path: "" }),
);
refs.appForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const projectIdentity = document.getElementById("app-project").value;
  const appId = document.getElementById("app-id").value;
  await mutateDialog(refs.appDialog, "app-error", async () => {
    const assoc = document.getElementById("app-association").value;
    let revision = lastSnapshot.settingsRevision;
    if (assoc) {
      const associationResult = await api.updateAssociation({
        revision,
        associationKey: assoc,
        projectIdentity,
        appId,
      });
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
  await mutateDialog(refs.appDialog, "app-error", () =>
    api.updateAssociation({
      revision: lastSnapshot.settingsRevision,
      associationKey,
      remove: true,
    }),
  );
});
refs.aliasForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await mutateDialog(refs.aliasDialog, "alias-error", () =>
    api.updateAlias({
      revision: lastSnapshot.settingsRevision,
      from: document.getElementById("alias-from").value,
      to: document.getElementById("alias-to").value,
      confirmed: document.getElementById("alias-confirmed").checked,
    }),
  );
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
    menu
      .closest(".instance-card")
      ?.querySelector("[data-action=menu]")
      ?.setAttribute("aria-expanded", "false");
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
      const associationResult = await api.updateAssociation({
        revision,
        associationKey: instance.associationKey,
        projectIdentity,
        appId,
      });
      lastSnapshot = associationResult.localhoster || associationResult;
      revision = lastSnapshot.settingsRevision;
    }
    const result = await api.updateProject({
      revision,
      projectIdentity,
      appId,
      appHidden: true,
    });
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
  return (lastSnapshot.settings?.hidden || []).map((item) =>
    tmpl.settingsRow(
      item.kind === "project" ? item.name : `${item.name} / ${item.app.name}`,
      item.kind === "project"
        ? item.identity
        : `${item.identity}#${item.app.id}`,
      "Restore",
      () => restoreHidden(item),
    ),
  );
}

function associationRows() {
  return (lastSnapshot.settings?.associations || []).map((item) =>
    tmpl.settingsRow(
      item.key,
      `${item.projectIdentity}#${item.appId}`,
      "Remove",
      () => removeAssociation(item.key),
    ),
  );
}

function aliasRows() {
  return (lastSnapshot.settings?.aliases || []).map((item) =>
    tmpl.settingsRow(item.from, item.to, "Remove", () =>
      removeAlias(item.from),
    ),
  );
}

async function restoreHidden(item) {
  await mutateSettings(() =>
    api.updateProject({
      revision: lastSnapshot.settingsRevision,
      projectIdentity: item.identity,
      ...(item.kind === "project"
        ? { hidden: false }
        : { appId: item.app.id, appHidden: false }),
    }),
  );
}

async function removeAssociation(associationKey) {
  await mutateSettings(() =>
    api.updateAssociation({
      revision: lastSnapshot.settingsRevision,
      associationKey,
      remove: true,
    }),
  );
}

async function removeAlias(from) {
  await mutateSettings(() =>
    api.updateAlias({
      revision: lastSnapshot.settingsRevision,
      from,
      remove: true,
    }),
  );
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
    if (!refs.linkList.querySelector(".link-row"))
      refs.linkList.append(tmpl.linkEmpty());
  });
  row
    .querySelector("[data-action=up]")
    .addEventListener("click", () => moveLinkRow(row, -1));
  row
    .querySelector("[data-action=down]")
    .addEventListener("click", () => moveLinkRow(row, 1));
  refs.linkList.append(row);
  return row;
}

function moveLinkRow(row, direction) {
  const sibling =
    direction < 0 ? row.previousElementSibling : row.nextElementSibling;
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
  const acceptedStatuses = state
    .parseCsvList(document.getElementById("app-health-statuses").value)
    .map((value) => Number(value));
  return {
    ...(path ? { path } : {}),
    ...(acceptedStatuses.length ? { acceptedStatuses } : {}),
  };
}

function serializeMatch() {
  return {
    process: state.parseCsvList(
      document.getElementById("app-match-process").value,
    ),
    title: state.parseCsvList(document.getElementById("app-match-title").value),
    path: state.parseCsvList(document.getElementById("app-match-path").value),
  };
}

function showError(message) {
  refs.warnings.hidden = false;
  refs.warnings.replaceChildren(tmpl.notice(message));
}

load();
pollTimer = setInterval(load, 10000);

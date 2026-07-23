// Wiring only: DOM refs, event listeners, and orchestration between api.js (server calls),
// state.js (filtering/sorting/matching), and templates.js (markup). No markup construction
// should live in this file — add a template in templates.js instead.

import {
  portalSetUpdatedAt,
  portalHideLoading,
  portalCopyText,
} from "/portal/shared/api.js";
import { createSkillDetailModal } from "/portal/shared/skill-detail-modal.js";
import * as api from "./api.js";
import * as tmpl from "./templates.js";
import { createRootsPanel, createInfoModal, createPromptModal } from "./panels.js";
import {
  FILTER_IDS,
  FILTER_DEFAULTS,
  FILTER_OPTION_DEFS,
  LIFECYCLE_LABELS,
  filteredPlans,
  actionablePlans,
  matchesFilters,
  optionCounts,
  optionLabel,
  planSort,
  repositoryContext,
  lifecycleFromSearchParams,
  urlForLifecycle,
} from "./state.js";

const LIFECYCLE_ORDER = ["backlog", "active", "completed", "archived"];

const state = {
  snapshot: null,
  filters: { ...FILTER_DEFAULTS },
  filtersExpanded: false,
  selectedLifecycle: lifecycleFromSearchParams(new URLSearchParams(location.search)),
};

// Plan keys whose displayed field(s) changed via an in-card action (e.g. priority dropdown)
// since the last filter/tab flush — force-included in render() even if they'd now be excluded
// by the active filters, so the user doesn't lose the card they were just acting on.
const dirtyKeys = new Set();

const toastEl = document.getElementById("toast");
const groupsEl = document.getElementById("groups");
const warningsEl = document.getElementById("warnings");
const bannerEl = document.getElementById("package-banner");
const drawer = document.getElementById("drawer");
const nextPrompt = document.getElementById("next-prompt");
const plansHeaderEl = document.getElementById("plans-header");
const filtersToggleEl = document.getElementById("filters-toggle");
const filtersBodyEl = document.getElementById("filters-body");
const filterChipsEl = document.getElementById("filter-chips");
const plansCountTextEl = document.getElementById("plans-count-text");
const reposCountTextEl = document.getElementById("repos-count-text");
const lifecycleTabsEl = document.getElementById("lifecycle-tabs");
const lifecycleDropdownMountEl = document.getElementById("lifecycle-dropdown-mount");
let lifecycleDropdownEl = null;

// Only one of {roots panel, filter panel} is open at a time — each setter closes the other.
const rootsPanel = createRootsPanel({
  onSnapshot: applySnapshot,
  onError: showError,
  onExpand: () => setFiltersExpanded(false),
});
createInfoModal();
const skillModal = createSkillDetailModal(document.getElementById("skill-modal"));
const promptModal = createPromptModal(document.getElementById("prompt-modal"));

bindStaticControls();
load();

function bindStaticControls() {
  const refreshEl = document.getElementById("refresh");
  const refreshIconEl = refreshEl.querySelector("portal-icon");
  const refreshSpinnerEl = refreshEl.querySelector(".spinner");
  refreshEl.addEventListener("click", () => {
    refreshEl.disabled = true;
    refreshIconEl.hidden = true;
    refreshSpinnerEl.hidden = false;
    api.refreshSnapshot().then(applySnapshot).catch(showError).finally(() => {
      refreshEl.disabled = false;
      refreshIconEl.hidden = false;
      refreshSpinnerEl.hidden = true;
    });
  });
  nextPrompt.addEventListener("click", openNextPrompt);
  document.getElementById("drawer-close").addEventListener("click", () => drawer.close());
  for (const id of FILTER_IDS) {
    const node = document.getElementById(id);
    node.addEventListener(id === "search" ? "input" : "change", () => {
      state.filters[id] = node.value;
      flushDirtyState();
      render();
    });
  }
  filtersToggleEl.addEventListener("click", () => setFiltersExpanded(filtersBodyEl.hidden));
  document.getElementById("filters-done").addEventListener("click", () => setFiltersExpanded(false));
  filterChipsEl.addEventListener("chip-remove", (event) => resetFilter(event.detail));
}

function setFiltersExpanded(expanded) {
  state.filtersExpanded = expanded;
  filtersBodyEl.hidden = !expanded;
  if (expanded) rootsPanel.setExpanded(false);
}

function resetFilter(id) {
  state.filters[id] = FILTER_DEFAULTS[id];
  const node = document.getElementById(id);
  if (node) node.value = FILTER_DEFAULTS[id];
  flushDirtyState();
  render();
}

function flushDirtyState() {
  dirtyKeys.clear();
}

async function load() {
  try {
    applySnapshot(await api.fetchSnapshot());
  } catch (err) {
    showError(err);
  } finally {
    portalHideLoading();
  }
}

function applySnapshot(snapshot) {
  state.snapshot = snapshot;
  flushDirtyState();
  portalSetUpdatedAt();
  rootsPanel.render(snapshot.settings.discoveryRoots);
  plansHeaderEl.hidden = snapshot.settings.discoveryRoots.length === 0;
  setPluralCount(plansCountTextEl, snapshot.plans.length, "Plan");
  setPluralCount(reposCountTextEl, snapshot.repositories.length, "Repo");
  populateFilters(snapshot);
  render();
}

function populateFilters(snapshot) {
  for (const id of Object.keys(FILTER_OPTION_DEFS)) {
    setOptions(id, FILTER_OPTION_DEFS[id](snapshot));
  }
}

function setOptions(id, options) {
  const select = document.getElementById(id);
  const previous = select.value || "all";
  select.replaceChildren(...options.map(tmpl.selectOption));
  select.value = options.some(([value]) => value === previous) ? previous : "all";
  state.filters[id] = select.value;
}

// Refreshes each select's option labels with facet counts against the current snapshot + other
// active filters. Rewrites label text only — never touches `.value`, so it's safe to call on
// every render() without disturbing the user's current selection.
function refreshFilterCounts(snapshot) {
  for (const id of Object.keys(FILTER_OPTION_DEFS)) {
    const select = document.getElementById(id);
    const options = FILTER_OPTION_DEFS[id](snapshot);
    const counts = optionCounts(id, options.map(([value]) => value), snapshot.plans, state.filters);
    for (const option of select.options) {
      const def = options.find(([value]) => value === option.value);
      if (!def) continue;
      option.textContent = `${def[1]} (${counts.get(option.value) ?? 0})`;
    }
  }
}

function render() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  renderWarnings(snapshot);
  renderPackageBanner(snapshot);
  renderFilterChips(snapshot);
  refreshFilterCounts(snapshot);
  const allMatchingCurrentFilters = filteredPlans(snapshot.plans, state.filters);
  renderLifecycleTabs(allMatchingCurrentFilters);
  nextPrompt.hidden = !snapshot.planDocsPackage.enabled;
  const currentLifecyclePlans = allMatchingCurrentFilters.filter(
    (record) => record.plan.lifecycle === state.selectedLifecycle,
  );
  const visiblePlans = includeDirtyCards(currentLifecyclePlans);
  if (visiblePlans.length === 0) {
    const empty = tmpl.emptyState(snapshot);
    groupsEl.replaceChildren(...(empty ? [empty] : []));
    return;
  }
  const cardActions = {
    onOpen: openPlan,
    onCopyPath: copyText,
    onCopyContext: (record) => copyText(repositoryContext(record)),
    onPlanDocsStart: (key) => copyPrompt("start", [key]),
    onPriorityChange: handlePriorityChange,
    planDocsEnabled: snapshot.planDocsPackage.enabled,
    onError: showError,
  };
  groupsEl.replaceChildren(tmpl.cardGrid(visiblePlans, cardActions, dirtyKeys));
}

// Dirty cards are force-included only within their OWN lifecycle tab — a card that was
// priority-filtered-out stays visible in whichever tab it already belongs to.
function includeDirtyCards(currentLifecyclePlans) {
  if (dirtyKeys.size === 0) return currentLifecyclePlans;
  const present = new Set(currentLifecyclePlans.map((record) => record.key));
  const forced = state.snapshot.plans.filter(
    (record) =>
      dirtyKeys.has(record.key) &&
      record.plan.lifecycle === state.selectedLifecycle &&
      !present.has(record.key),
  );
  return forced.length ? [...currentLifecyclePlans, ...forced].sort(planSort) : currentLifecyclePlans;
}

function renderLifecycleTabs(plansMatchingOtherFilters) {
  const lifecycles = [...LIFECYCLE_ORDER];
  const unclassifiedCount = plansMatchingOtherFilters.filter(
    (record) => record.plan.lifecycle === "unclassified",
  ).length;
  if (unclassifiedCount > 0) lifecycles.push("unclassified");
  const counts = new Map();
  for (const life of lifecycles) {
    counts.set(
      life,
      plansMatchingOtherFilters.filter((record) => record.plan.lifecycle === life).length,
    );
  }
  lifecycleTabsEl.replaceChildren(
    ...lifecycles.map((life) =>
      tmpl.lifecycleTab(life, counts.get(life) ?? 0, life === state.selectedLifecycle, selectLifecycle),
    ),
  );
  const dropdown = ensureLifecycleDropdown();
  dropdown.options = lifecycles.map((life) => [
    life,
    `${LIFECYCLE_LABELS[life] || life} (${counts.get(life) ?? 0})`,
  ]);
  dropdown.value = state.selectedLifecycle;
}

function ensureLifecycleDropdown() {
  if (!lifecycleDropdownEl) {
    lifecycleDropdownEl = document.createElement("option-dropdown");
    lifecycleDropdownEl.onSelect = (value) => selectLifecycle(value);
    lifecycleDropdownMountEl.replaceChildren(lifecycleDropdownEl);
  }
  return lifecycleDropdownEl;
}

function selectLifecycle(life) {
  state.selectedLifecycle = life;
  flushDirtyState();
  history.pushState(null, "", urlForLifecycle(life));
  render();
}

// Back/forward nav: re-read the tab from the URL (now restored by the browser) and repaint
// without a full reload — pushState above is what makes this fire in the first place.
window.addEventListener("popstate", () => {
  state.selectedLifecycle = lifecycleFromSearchParams(new URLSearchParams(location.search));
  flushDirtyState();
  render();
});

async function handlePriorityChange(record, newPriority) {
  const result = await api.updatePlanPriority(record.key, newPriority, record.mtimeMs);
  record.plan.priority = result.priority;
  record.mtimeMs = result.mtimeMs;
  if (!matchesFilters(record, state.filters, null)) {
    dirtyKeys.add(record.key);
    render(); // repaint immediately so the dirty indicator shows without waiting for a refilter
  }
  return result;
}

function renderFilterChips(snapshot) {
  const descriptors = tmpl.filterChipDescriptors(state.filters, FILTER_DEFAULTS, (id, value) =>
    optionLabel(snapshot, id, value),
  );
  filterChipsEl.replaceChildren(...descriptors.map(tmpl.filterChip));
}

function visibleNextPromptKeys() {
  return actionablePlans(filteredPlans(state.snapshot.plans, state.filters))
    .map((record) => record.key)
    .slice(0, 20);
}

// The popup shows the scope count up front, so it needs the (cheap) key list before the user
// commits to copying — copyPrompt's own key list is recomputed at click-time in case filters
// changed while the popup was open.
function openNextPrompt() {
  const keys = visibleNextPromptKeys();
  promptModal.open({
    title: "/plan-docs next",
    objective:
      "Copies a prompt that asks an agent to work through the next actionable step across these plans, one at a time.",
    scopeCount: keys.length,
    onCopy: async () => {
      const freshKeys = visibleNextPromptKeys();
      if (freshKeys.length === 0) throw new Error("no active or backlog plans in the current view");
      await copyPrompt("next", freshKeys, "portable");
    },
    onError: showError,
  });
}

function renderWarnings(snapshot) {
  const warnings = [
    ...(snapshot.errors || []).map((err) => `${err.root || err.repository || "scan"}: ${err.error}`),
    ...(snapshot.truncated ? ["Scan results truncated. Narrow discovery roots."] : []),
  ];
  warningsEl.hidden = warnings.length === 0;
  warningsEl.replaceChildren(...warnings.map(tmpl.warningLine));
}

function renderPackageBanner(snapshot) {
  const pkg = snapshot.planDocsPackage || {};
  if (pkg.enabled) {
    bannerEl.hidden = true;
    return;
  }
  bannerEl.hidden = false;
  bannerEl.replaceChildren(tmpl.packageBanner(pkg, enablePackage, skillModal));
}

async function enablePackage() {
  try {
    await api.enablePlanDocsPackage();
    applySnapshot(await api.fetchSnapshot());
  } catch (err) {
    showError(err);
  }
}

async function openPlan(key) {
  try {
    renderDrawer(await api.fetchPlanDocument(key));
  } catch (err) {
    showError(err);
  }
}

function renderDrawer(doc) {
  const content = tmpl.drawerContent(doc, {
    onCopyMarkdown: copyText,
    onCopyPath: copyText,
    onCopyRepoContext: (record) => copyText(repositoryContext(record)),
    onCopyPortableContext: (key) => copyPrompt("review", [key], "portable"),
    onPlanDocsAction: (mode, key) => copyPrompt(mode, [key]),
    planDocsEnabled: state.snapshot.planDocsPackage.enabled,
    onError: showError,
  });
  document.getElementById("drawer-title").textContent = content.title;
  document.getElementById("drawer-path").textContent = content.path;
  document.getElementById("drawer-doc").innerHTML = content.html;
  document.getElementById("drawer-meta").replaceChildren(...content.meta);
  document
    .getElementById("drawer-warnings")
    .replaceChildren(...content.warnings.map(tmpl.listItem));
  document.getElementById("drawer-tasks").replaceChildren(...tmpl.drawerTaskItems(content.tasks));
  document.getElementById("drawer-actions").replaceChildren(...content.actions);
  drawer.open();
}

async function copyPrompt(actionName, keys, mode = "repository-aware") {
  await copyText(await api.generatePrompt(actionName, keys, mode));
}

async function copyText(text) {
  await portalCopyText(text, () => showToast("copied"));
}

let toastTimer;
function showToast(text) {
  clearTimeout(toastTimer);
  toastEl.textContent = text;
  toastEl.hidden = false;
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, 1200);
}

function setPluralCount(node, count, noun) {
  const strong = document.createElement("strong");
  strong.textContent = count;
  node.replaceChildren(strong, ` ${noun}${count === 1 ? "" : "s"}`);
}

function showError(err) {
  warningsEl.hidden = false;
  warningsEl.textContent = String(err?.message || err);
}

// Wiring only: DOM refs, event listeners, and orchestration between api.js (server calls),
// state.js (filtering/sorting/matching), and templates.js (markup). No markup construction
// should live in this file — add a template in templates.js instead.

import {
  portalSetUpdatedAt,
  portalHideLoading,
  portalCopyText,
} from "/portal/shared/api.js";
import * as api from "./api.js";
import * as tmpl from "./templates.js";
import { createRootsPanel, createInfoModal } from "./panels.js";
import {
  FILTER_IDS,
  FILTER_DEFAULTS,
  FILTER_OPTION_DEFS,
  filteredPlans,
  actionablePlans,
  optionCounts,
  optionLabel,
  repositoryContext,
  statusText,
} from "./state.js";

const state = {
  snapshot: null,
  filters: { ...FILTER_DEFAULTS },
  filtersExpanded: false,
};

const COLLAPSIBLE_GROUPS = new Set(["completed"]);
const openGroups = new Set(); // lifecycle names the user has expanded, preserved across re-renders

const statusEl = document.getElementById("status");
const groupsEl = document.getElementById("groups");
const warningsEl = document.getElementById("warnings");
const bannerEl = document.getElementById("package-banner");
const drawer = document.getElementById("drawer");
const nextPrompt = document.getElementById("next-prompt");
const filtersEl = document.getElementById("filters");
const filtersBodyEl = document.getElementById("filters-body");
const filterChipsEl = document.getElementById("filter-chips");

const rootsPanel = createRootsPanel({ onSnapshot: applySnapshot, onError: showError });
createInfoModal();

bindStaticControls();
load();

function bindStaticControls() {
  document
    .getElementById("refresh")
    .addEventListener("click", () => api.refreshSnapshot().then(applySnapshot).catch(showError));
  nextPrompt.addEventListener("click", () => copyVisibleNextPrompt().catch(showError));
  document.getElementById("drawer-close").addEventListener("click", () => drawer.close());
  for (const id of FILTER_IDS) {
    const node = document.getElementById(id);
    node.addEventListener(id === "search" ? "input" : "change", () => {
      state.filters[id] = node.value;
      render();
    });
  }
  document.getElementById("filters-toggle").addEventListener("click", () => setFiltersExpanded(true));
  document.getElementById("filters-done").addEventListener("click", () => setFiltersExpanded(false));
  filterChipsEl.addEventListener("chip-remove", (event) => resetFilter(event.detail));
}

function setFiltersExpanded(expanded) {
  state.filtersExpanded = expanded;
  filtersBodyEl.hidden = !expanded;
  filtersEl.classList.toggle("expanded", expanded);
}

function resetFilter(id) {
  state.filters[id] = FILTER_DEFAULTS[id];
  const node = document.getElementById(id);
  if (node) node.value = FILTER_DEFAULTS[id];
  render();
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
  statusEl.textContent = statusText(snapshot);
  portalSetUpdatedAt();
  rootsPanel.render(snapshot.settings.discoveryRoots);
  filtersEl.hidden = snapshot.settings.discoveryRoots.length === 0;
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
  const plans = filteredPlans(snapshot.plans, state.filters);
  nextPrompt.hidden = !snapshot.planDocsPackage.enabled || actionablePlans(plans).length === 0;
  if (plans.length === 0) {
    const empty = tmpl.emptyState(snapshot);
    groupsEl.replaceChildren(...(empty ? [empty] : []));
    return;
  }
  const order = ["active", "backlog", "completed", "archived", "unclassified"];
  const cardActions = {
    onOpen: openPlan,
    onCopyPath: copyText,
    onCopyContext: (record) => copyText(repositoryContext(record)),
    onPlanDocsStart: (key) => copyPrompt("start", [key]),
    planDocsEnabled: snapshot.planDocsPackage.enabled,
    onError: showError,
  };
  groupsEl.replaceChildren(
    ...order
      .map((life) =>
        tmpl.group(
          life,
          plans.filter((record) => record.plan.lifecycle === life),
          {
            collapsible: COLLAPSIBLE_GROUPS.has(life),
            open: openGroups.has(life),
            onToggle: (open) => (open ? openGroups.add(life) : openGroups.delete(life)),
            cardActions,
          },
        ),
      )
      .filter(Boolean),
  );
}

function renderFilterChips(snapshot) {
  const descriptors = tmpl.filterChipDescriptors(state.filters, FILTER_DEFAULTS, (id, value) =>
    optionLabel(snapshot, id, value),
  );
  filterChipsEl.replaceChildren(...descriptors.map(tmpl.filterChip));
}

async function copyVisibleNextPrompt() {
  const keys = actionablePlans(filteredPlans(state.snapshot.plans, state.filters))
    .map((record) => record.key)
    .slice(0, 20);
  if (keys.length === 0) throw new Error("no active or backlog plans in the current view");
  await copyPrompt("next", keys, "portable");
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
  bannerEl.replaceChildren(tmpl.packageBanner(pkg, enablePackage));
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
  await portalCopyText(text, () => {
    statusEl.textContent = "copied";
    setTimeout(() => {
      if (state.snapshot) statusEl.textContent = statusText(state.snapshot);
    }, 1200);
  });
}

function showError(err) {
  statusEl.textContent = "error";
  warningsEl.hidden = false;
  warningsEl.textContent = String(err?.message || err);
}

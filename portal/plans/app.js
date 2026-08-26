// Wiring only: DOM refs, event listeners, and orchestration between api.js (server calls),
// state.js (filtering/sorting/matching), and templates.js (markup). No markup construction
// should live in this file — add a template in templates.js instead.

import {
  portalSetUpdatedAt,
  portalHideLoading,
  portalCopyText,
  portalWireBackdropClose,
} from "/portal/shared/api.js";
import { createSkillDetailModal } from "/portal/shared/skill-detail-modal.js";
import { renderMermaidBlocks } from "/portal/shared/markdown-mermaid.js";
import * as api from "./api.js";
import * as tmpl from "./templates.js";
import { createRootsPanel, createInfoModal, createPromptModal } from "./panels.js";
import { createLifecycleEventDialog, lifecycleEvents } from "./lifecycle-event-dialog.js";
import { createLifecycleErrorDialog } from "./lifecycle-error-dialog.js";
import { createOutcomeToast } from "./toast-controller.js";
import { createBlockersPopover } from "./blockers-popover.js";
import {
  FILTER_IDS,
  FILTER_DEFAULTS,
  FILTER_OPTION_DEFS,
  LIFECYCLE_LABELS,
  filteredPlans,
  actionablePlans,
  sortForLifecycle,
  isNotStarted,
  completionRatio,
  isVisible,
  replaceRecord,
  filteredListActionFor,
  resolveBlockers,
  resolveBlocking,
  optionCounts,
  optionLabel,
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
  openDrawerKey: null,
};

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
const activeTasksBarEl = document.getElementById("active-tasks-bar");
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
const outcomeToast = createOutcomeToast(toastEl);
const blockersPopover = createBlockersPopover(document.getElementById("blockers-popover"), {
  onOpenPlan: (key) => openPlan(key),
});
const lifecycleEventDialog = createLifecycleEventDialog(document.getElementById("lifecycle-event-modal"), {
  onCopyPrompt: (record) => copyPrompt("start", [record.key], "repository-aware"),
  onViewPlan: (record) => openPlan(record.key),
  onRevert: (record, previousValue) => handlePlanChange({ property: "lifecycle", value: previousValue, record }),
});
const lifecycleErrorDialog = createLifecycleErrorDialog(document.getElementById("lifecycle-error-modal"), {
  onViewPlan: (key) => openPlan(key),
});
const allTasksModal = document.getElementById("all-tasks-modal");
portalWireBackdropClose(drawer, () => drawer.close());
portalWireBackdropClose(allTasksModal, () => allTasksModal.close());
// Fires however the dialog closes (button, backdrop, Escape, or a programmatic .close() call
// from presentChangeOutcome) — one place to clear which plan the drawer was showing.
drawer.addEventListener("close", () => { state.openDrawerKey = null; });

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
  document.getElementById("open-all-tasks").addEventListener("click", openAllTasks);
  document.getElementById("all-tasks-close").addEventListener("click", () => allTasksModal.close());
  for (const id of FILTER_IDS) {
    const node = document.getElementById(id);
    node.addEventListener(id === "search" ? "input" : "change", () => {
      state.filters[id] = node.value;
      render();
    });
  }
  filtersToggleEl.addEventListener("click", () => setFiltersExpanded(filtersBodyEl.hidden));
  document.getElementById("filters-done").addEventListener("click", () => setFiltersExpanded(false));
  filterChipsEl.addEventListener("chip-remove", (event) => resetFilter(event.detail));
  // One delegated listener each for cards (bubbles through groupsEl) and the drawer's mounted
  // <plan-status> — both dispatch the same `plan-change` event, so both route through the same
  // mutation orchestrator.
  groupsEl.addEventListener("plan-change", (event) => handlePlanChange(event.detail));
  document.getElementById("drawer-status-mount").addEventListener("plan-change", (event) => handlePlanChange(event.detail));
  // Same delegation for the "blocked by N" badge — card and drawer both mount <plan-status>.
  groupsEl.addEventListener("blocked-click", (event) => openBlockersPopover(event.detail));
  document.getElementById("drawer-status-mount").addEventListener("blocked-click", (event) => openBlockersPopover(event.detail));
}

function openBlockersPopover({ record, anchor }) {
  blockersPopover.open({ blockers: resolveBlockers(record, state.snapshot.plans), anchor });
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
  // Sorted here rather than inside filteredPlans: that result spans every lifecycle (the tabs read
  // it for counts, and visibleNextPromptKeys takes the top 20 across all of them in priority
  // order). Completion ordering is Active-only, so it applies to the visible slice, after the tab
  // filter has narrowed it to one lifecycle.
  const visiblePlans = allMatchingCurrentFilters
    .filter((record) => record.plan.lifecycle === state.selectedLifecycle)
    .sort(sortForLifecycle(state.selectedLifecycle));
  // Set before the empty-state return below, or switching to an empty Active tab would leave the
  // previous tab's bar on screen.
  activeTasksBarEl.hidden = state.selectedLifecycle !== "active" || visiblePlans.length === 0;
  if (visiblePlans.length === 0) {
    const empty = tmpl.emptyState(snapshot);
    groupsEl.replaceChildren(...(empty ? [empty] : []));
    return;
  }
  const cardActions = {
    onOpen: openPlan,
    onCopyPath: copyText,
    onCopyContext: (record) => copyText(repositoryContext(record)),
    onCopyPortableContext: (key) => copyPrompt("review", [key], "portable"),
    onPlanDocsAction: (key, mode, { portable } = {}) =>
      copyPrompt(mode, [key], portable ? "portable" : "repository-aware"),
    onStart: startPlan,
    onArchive: (record) => handlePlanChange({ property: "lifecycle", value: "archived", record }),
    planDocsEnabled: snapshot.planDocsPackage.enabled,
    planDocsPackage: snapshot.planDocsPackage,
    skillModal,
    onEnablePackage: enablePackage,
    onError: showError,
  };
  groupsEl.replaceChildren(tmpl.cardGrid(visiblePlans, cardActions));
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
  history.pushState(null, "", urlForLifecycle(life));
  render();
}

// Back/forward nav: re-read the tab from the URL (now restored by the browser) and repaint
// without a full reload — pushState above is what makes this fire in the first place.
window.addEventListener("popstate", () => {
  state.selectedLifecycle = lifecycleFromSearchParams(new URLSearchParams(location.search));
  render();
});

// mutations: property -> (record, value) => Promise<{change, record}>. Both call through the
// same shared result contract (see docs/plans/active/plan-lifecycle-toggle-control.md's "Shared
// domain mutation result"), so handlePlanChange doesn't need to know which one ran.
const mutations = {
  priority: (record, value) =>
    api.updatePlanPriority(record.plan.id, record.key, value, record.plan.priority, record.mtimeMs, record.repository.id),
  lifecycle: (record, value, { skipDestinationValidation } = {}) =>
    api.updatePlanLifecycle(record.plan.id, record.key, value, record.plan.lifecycle, record.mtimeMs, record.repository.id, skipDestinationValidation),
};

// Plan keys currently mid-mutation. Guards against two overlapping handlePlanChange calls for the
// same record (e.g. the card's and the drawer's mounted <plan-status> both showing the same plan)
// racing the server with the same expected mtimeMs/lifecycle — the loser would otherwise surface a
// confusing stale-conflict recovery for what looked like a single click.
const pendingMutationKeys = new Set();

// The one page-level mutation orchestrator, shared by card dropdowns, the drawer's mounted
// <plan-status>, and the Start/Archive/Revert/Undo shortcuts. Filesystem truth controls UI truth:
// the snapshot is only updated after the server confirms success, and the full record it returns
// replaces the old one outright rather than patching individual fields in place.
async function handlePlanChange({ property, value, record }, mutationOptions) {
  if (pendingMutationKeys.has(record.key)) return null;
  pendingMutationKeys.add(record.key);
  // Captured once up front so the outcome this mutation reports (visibility, tab, filters) always
  // describes the view the user was looking at when they triggered it — not whatever tab/filters
  // are current by the time the server responds.
  const viewAtRequestTime = { selectedLifecycle: state.selectedLifecycle, filters: { ...state.filters } };
  const wasVisible = isVisible(record, viewAtRequestTime.selectedLifecycle, viewAtRequestTime.filters);
  let result;
  try {
    result = await mutations[property](record, value, mutationOptions);
  } catch (err) {
    if (err.code === "STALE_PLAN") {
      await recoverFromStaleConflict(record);
      return null;
    }
    // The mutating control (a dropdown inside <plan-status>) is stuck showing a loading state
    // until it receives a fresh `record` property set — re-set the unchanged record so it clears
    // loading and reverts to the last-known-good value instead of hanging. render() (called by
    // refreshMountedStatus) rebuilds the warnings banner from snapshot data, so showError must run
    // AFTER it or its message gets immediately overwritten.
    refreshMountedStatus(record);
    if (err.code === "LIFECYCLE_REQUIREMENTS") {
      // Validation is a soft warning, not a hard gate (see movePlanLifecycle's comment) — offer
      // "move anyway," which re-enters this same function with the bypass flag so the retry gets
      // the exact same snapshot-replace/outcome handling as any other successful mutation. The
      // dialog also offers the server-generated repair prompt carried on the error, for users who
      // would rather fix the document than move past it.
      //
      // This is the single place a readiness failure surfaces. Card dropdowns, the drawer's
      // <plan-status>, and the Start/Archive/Revert shortcuts all funnel through this function,
      // which is what guarantees they show identical findings.
      lifecycleErrorDialog.open(err, () => handlePlanChange({ property, value, record }, { skipDestinationValidation: true }));
    } else {
      showError(err);
    }
    return null;
  } finally {
    pendingMutationKeys.delete(record.key);
  }
  state.snapshot.plans = replaceRecord(state.snapshot.plans, record.key, result.record);
  const nowVisible = isVisible(result.record, viewAtRequestTime.selectedLifecycle, viewAtRequestTime.filters);
  const previousKey = record.key;
  render();
  // The card grid's render() mounts fresh <plan-status> instances, but the drawer isn't part of
  // that render pass — its mounted <plan-status> would otherwise sit stuck at loading:true
  // (dropdown spinner) forever, since it never receives the new record. presentChangeOutcome may
  // close the drawer for a lifecycle move (a stale key by then); re-set only when it's still open
  // for this same plan.
  if (drawer.open && state.openDrawerKey === previousKey) {
    const drawerStatus = document.getElementById("drawer-status-mount").querySelector("plan-status");
    if (drawerStatus) drawerStatus.record = result.record;
  }
  presentChangeOutcome({ result, wasVisible, nowVisible, previousKey, view: viewAtRequestTime });
  return result.record;
}

// Re-renders whichever mounted <plan-status> instance(s) still reference this record — the card
// grid (full render()) or the open drawer — so a failed mutation's dropdown clears its loading
// state even though nothing about the underlying record actually changed.
function refreshMountedStatus(record) {
  render();
  if (!drawer.open) return;
  const drawerStatus = document.getElementById("drawer-status-mount").querySelector("plan-status");
  if (drawerStatus && drawerStatus.record?.key === record.key) drawerStatus.record = record;
}

async function recoverFromStaleConflict(record) {
  try {
    applySnapshot(await api.fetchSnapshot());
  } catch (err) {
    showError(err);
    return;
  }
  const current = state.snapshot.plans.find((item) => item.plan.id && item.plan.id === record.plan.id) ||
    state.snapshot.plans.find((item) => item.key === record.key);
  if (drawer.open && state.openDrawerKey === record.key) {
    if (current) {
      showError({ message: `This plan changed outside the portal, so the update wasn't applied. The page has been refreshed. Current lifecycle: ${current.plan.lifecycle}.` });
      openPlan(current.key);
    } else {
      drawer.close();
      showError({ message: "This plan was removed or renamed outside the portal." });
    }
  } else {
    showError({ message: "This plan changed outside the portal, so the update wasn't applied. The page has been refreshed." });
  }
}

// Decides which outcome surface (if any) to show after a successful mutation. Lifecycle moves
// into a configured lifecycleEvents destination (Active, Completed) always get the event dialog,
// regardless of current visibility. Everything else gets the passive toast, but only when the
// mutation actually removed the record from view — an unrelated field change that keeps the
// record visible needs no notification.
function presentChangeOutcome({ result, wasVisible, nowVisible, previousKey, view }) {
  const { change, record } = result;
  // A lifecycle move invalidates the open drawer's key/path/actions — close it before showing
  // either outcome surface rather than leaving a stale detail view open behind the dialog/toast.
  if (change.property === "lifecycle" && drawer.open && state.openDrawerKey === previousKey) {
    drawer.close();
  }
  if (change.property === "lifecycle" && lifecycleEvents[change.newValue]) {
    lifecycleEventDialog.open({ change, record, isTransition: true });
    return;
  }
  if (!(wasVisible && !nowVisible)) return;
  // Use the tab/filters captured when the mutation started, not whatever is current now — the
  // toast must describe the view the user was actually looking at when they triggered the change.
  const filteredAction = filteredListActionFor(change, view);
  const label = change.property === "lifecycle" ? LIFECYCLE_LABELS[change.newValue] : change.newValue;
  outcomeToast.show({
    message: `"${record.plan.title}" ${change.property} was set to ${label}.`,
    actions: [
      { label: "Undo", run: () => handlePlanChange({ property: change.property, value: change.previousValue, record }) },
      { label: "View plan", run: () => openPlan(record.key) },
      ...(filteredAction ? [{ label: filteredAction.label, run: () => applyFilteredListAction(filteredAction) }] : []),
    ],
  });
}

function applyFilteredListAction(action) {
  if (action.type === "lifecycle") {
    selectLifecycle(action.value);
  } else if (action.type === "priority") {
    state.filters.priority = action.value;
    document.getElementById("priority").value = action.value;
    render();
  }
}

// Backlog Start: move the plan into Active through the shared mutation, then the Active dialog
// opens automatically via presentChangeOutcome (Active is a configured lifecycleEvents
// destination). Active Start: no mutation — open the same dialog content directly, since the plan
// is already where it needs to be.
async function startPlan(record) {
  if (record.plan.lifecycle === "active") {
    lifecycleEventDialog.open({ change: null, record, isTransition: false });
    return;
  }
  await handlePlanChange({ property: "lifecycle", value: "active", record });
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

// Every active plan's remaining work in one view, ordered the same way the Active tab is so the
// dialog and the board never disagree about what is furthest along.
//
// Reads the plans already in the snapshot rather than fetching: `openTasks` ships with the list
// payload for active plans (see modules/plan-docs/index.mjs), so this needs no round trip and
// cannot show something staler than the cards behind it. Respects the current filters for the same
// reason — a dialog opened from a filtered board that ignored the filter would be a different
// answer to the question the user is looking at.
function openAllTasks() {
  const active = filteredPlans(state.snapshot.plans, state.filters)
    .filter((record) => record.plan.lifecycle === "active")
    .sort(sortForLifecycle("active"));

  const openCount = active.reduce((sum, record) => sum + record.plan.taskCounts.remaining, 0);
  document.getElementById("all-tasks-summary").textContent =
    `${openCount} open ${openCount === 1 ? "task" : "tasks"} across ${active.length} ${active.length === 1 ? "project" : "projects"}`;

  document.getElementById("all-tasks-body").replaceChildren(
    ...active.map((record) =>
      tmpl.allTasksProject(record, {
        notStarted: isNotStarted(record.plan),
        percent: completionRatio(record.plan),
        onViewStory: (key) => {
          // One dialog at a time: the drawer is also a modal, and leaving this one open behind it
          // would stack two backdrops and trap focus in the wrong layer.
          allTasksModal.close();
          openPlan(key);
        },
      }),
    ),
  );
  allTasksModal.showModal();
}

function renderDrawer(doc) {
  state.openDrawerKey = doc.plan.key;
  const content = tmpl.drawerContent(doc, {
    onCopyPath: copyText,
    onCopyRepoContext: (record) => copyText(repositoryContext(record)),
    onCopyPortableContext: (key) => copyPrompt("review", [key], "portable"),
    onPlanDocsAction: (key, mode, { portable } = {}) =>
      copyPrompt(mode, [key], portable ? "portable" : "repository-aware"),
    onEnablePackage: enablePackage,
    planDocsPackage: state.snapshot.planDocsPackage,
    skillModal,
    onError: showError,
  });
  document.getElementById("drawer-title").textContent = content.title;
  document.getElementById("drawer-path").textContent = content.path;
  const pathCopyEl = document.getElementById("drawer-path-copy");
  pathCopyEl.copySource = () => doc.plan.plan.relativePath;
  const drawerDocEl = document.getElementById("drawer-doc");
  drawerDocEl.innerHTML = content.html;
  // Plan bodies routinely carry architecture diagrams; render them rather than showing the source.
  renderMermaidBlocks(drawerDocEl);
  document.getElementById("drawer-meta").replaceChildren(...content.meta);
  document
    .getElementById("drawer-warnings")
    .replaceChildren(...content.warnings.map(tmpl.listItem));
  document.getElementById("drawer-warnings-section").hidden =
    content.warnings.length === 0;
  document.getElementById("drawer-tasks").replaceChildren(...tmpl.drawerTaskItems(content.tasks));
  renderDrawerBlockers(doc.plan);
  const statusEl = document.createElement("plan-status");
  statusEl.record = doc.plan;
  document.getElementById("drawer-status-mount").replaceChildren(statusEl);
  // Recommended-next CTA (hidden when there's no clear recommendation) + the unified ⋯ menu.
  const ctaEl = document.getElementById("drawer-cta");
  if (content.cta) {
    ctaEl.textContent = content.cta.label;
    ctaEl.hidden = false;
    ctaEl.onclick = () => copyPrompt(content.cta.mode, [doc.plan.key], "repository-aware");
  } else {
    ctaEl.hidden = true;
    ctaEl.onclick = null;
  }
  document.getElementById("drawer-menu").panelContent = content.menu;
  drawer.showModal();
}

// Blocked by (this plan's own blocked_by, resolved) and Blocking (other plans that list this one)
// render as two independent warning-styled sections above the drawer's main content — each hidden
// when empty. Every resolved entry is a link that closes to the same drawer re-opened for the
// target plan; unresolved blocked_by ids render as plain text (see resolveBlockers).
function renderDrawerBlockers(record) {
  const blockedBy = resolveBlockers(record, state.snapshot.plans);
  const blocking = resolveBlocking(record, state.snapshot.plans);
  document.getElementById("drawer-blocked-by-section").hidden = blockedBy.length === 0;
  document.getElementById("drawer-blocked-by-links").replaceChildren(...blockedBy.map((b) => tmpl.blockerLink(b, openPlan)));
  document.getElementById("drawer-blocking-section").hidden = blocking.length === 0;
  document.getElementById("drawer-blocking-links").replaceChildren(...blocking.map((b) => tmpl.blockerLink(b, openPlan)));
}

async function copyPrompt(actionName, keys, mode = "repository-aware") {
  await copyText(await api.generatePrompt(actionName, keys, mode));
}

async function copyText(text) {
  await portalCopyText(text, () => outcomeToast.show({ message: "copied" }));
}

function setPluralCount(node, count, noun) {
  const strong = document.createElement("strong");
  strong.textContent = count;
  node.replaceChildren(strong, ` ${noun}${count === 1 ? "" : "s"}`);
}

function showError(err) {
  warningsEl.hidden = false;
  const parts = [String(err?.message || err)];
  if (err?.resolution) parts.push(err.resolution);
  if (err?.details?.length) parts.push(err.details.join("; "));
  warningsEl.textContent = parts.join(" — ");
}

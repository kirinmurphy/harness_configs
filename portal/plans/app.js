import { portalEl as el, portalGetJson, portalPostJson, portalCopyText, portalSetUpdatedAt, portalHideLoading, portalTpl as tpl } from "/portal/shared/api.js";

const FILTER_IDS = ["search", "repository", "lifecycle", "priority", "blocked", "readiness", "review", "health"];
const FILTER_DEFAULTS = { search: "", repository: "all", lifecycle: "all", priority: "all", blocked: "all", readiness: "all", review: "all", health: "all" };
const FILTER_LABELS = { repository: "repo", lifecycle: "lifecycle", priority: "priority", blocked: "blocked", readiness: "readiness", review: "review", health: "health" };

const state = {
  snapshot: null,
  filters: { ...FILTER_DEFAULTS },
  filtersExpanded: false,
};

const statusEl = document.getElementById("status");
const groupsEl = document.getElementById("groups");
const warningsEl = document.getElementById("warnings");
const bannerEl = document.getElementById("package-banner");
const rootsEl = document.getElementById("roots");
const settingsEl = document.getElementById("settings");
const drawer = document.getElementById("drawer");
const nextPrompt = document.getElementById("next-prompt");
const filtersEl = document.getElementById("filters");
const filtersBodyEl = document.getElementById("filters-body");
const filterChipsEl = document.getElementById("filter-chips");
const rootFormErrEl = document.getElementById("root-form-err");
const COLLAPSIBLE_GROUPS = new Set(["completed"]);
const openGroups = new Set(); // lifecycle names the user has expanded, preserved across re-renders

document.getElementById("refresh").addEventListener("click", () => portalPostJson("/api/plans/refresh", {}).then(applySnapshot).catch(showError));
nextPrompt.addEventListener("click", () => copyVisibleNextPrompt().catch(showError));
document.getElementById("root-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  rootFormErrEl.textContent = "";
  const input = document.getElementById("root-input");
  const current = state.snapshot?.settings?.discoveryRoots || [];
  try {
    const snap = await portalPostJson("/api/plans/settings", { discoveryRoots: [...current, input.value] });
    input.value = "";
    applySnapshot(snap);
    settingsEl.open = true; // stay open across multiple adds in one sitting
  } catch (err) {
    rootFormErrEl.textContent = err.message;
  }
});
document.getElementById("roots-done").addEventListener("click", () => { settingsEl.open = false; });
document.getElementById("drawer-close").addEventListener("click", () => { drawer.hidden = true; });
for (const id of FILTER_IDS) {
  const node = document.getElementById(id);
  node.addEventListener(id === "search" ? "input" : "change", () => {
    state.filters[id] = node.value;
    render();
  });
}
document.getElementById("filters-toggle").addEventListener("click", () => setFiltersExpanded(true));
document.getElementById("filters-done").addEventListener("click", () => setFiltersExpanded(false));
filterChipsEl.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-filter-id]");
  if (!btn) return;
  resetFilter(btn.dataset.filterId);
});

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
    applySnapshot(await portalGetJson("/api/plans"));
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
  renderRoots(snapshot.settings.discoveryRoots);
  populateFilters(snapshot);
  render();
}

function renderRoots(roots) {
  filtersEl.hidden = roots.length === 0;
  if (!roots.length) {
    rootsEl.replaceChildren();
    settingsEl.open = true; // prominent until at least one root exists
    return;
  }
  rootsEl.replaceChildren(...roots.map((root) => {
    const remove = el("button", { type: "button", class: "root-remove", title: "Remove discovery root" }, "Remove");
    remove.addEventListener("click", (event) => {
      event.preventDefault(); // don't let the click also toggle the <details> open/closed
      event.stopPropagation();
      removeRoot(root);
    });
    return el("span", { class: "root-chip" }, el("span", {}, root), remove);
  }));
}

async function removeRoot(root) {
  const current = state.snapshot?.settings?.discoveryRoots || [];
  await portalPostJson("/api/plans/settings", { discoveryRoots: current.filter((item) => item !== root) }).then(applySnapshot).catch(showError);
}

function populateFilters(snapshot) {
  setOptions("repository", [["all", "all repositories"], ...snapshot.repositories.map((repo) => [repo.id, repo.name])]);
  setOptions("lifecycle", [["all", "all lifecycle"], ...["active", "backlog", "completed", "archived", "unclassified"].map((v) => [v, v])]);
  setOptions("priority", [["all", "all priority"], ...["high", "medium", "low", "none"].map((v) => [v, v])]);
  setOptions("blocked", [["all", "all blockers"], ["blocked", "blocked"], ["unblocked", "unblocked"]]);
  setOptions("readiness", [["all", "all readiness"], ["ready", "ready"], ["draft", "draft"]]);
  setOptions("review", [["all", "all review"], ...["never-reviewed", "current", "possibly-stale", "unknown"].map((v) => [v, v])]);
  setOptions("health", [["all", "all health"], ["warnings", "has warnings"], ["valid", "valid"]]);
}

function setOptions(id, options) {
  const select = document.getElementById(id);
  const previous = select.value || "all";
  select.replaceChildren(...options.map(([value, label]) => el("option", { value }, label)));
  select.value = options.some(([value]) => value === previous) ? previous : "all";
  state.filters[id] = select.value;
}

function render() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  renderWarnings(snapshot);
  renderPackageBanner(snapshot);
  renderFilterChips();
  const plans = filteredPlans(snapshot.plans);
  nextPrompt.hidden = !snapshot.planDocsPackage.enabled || actionablePlans(plans).length === 0;
  if (plans.length === 0) {
    groupsEl.replaceChildren(renderEmptyState(snapshot));
    return;
  }
  const order = ["active", "backlog", "completed", "archived", "unclassified"];
  groupsEl.replaceChildren(...order.map((life) => renderGroup(life, plans.filter((record) => record.plan.lifecycle === life))).filter(Boolean));
}

function renderFilterChips() {
  const chips = [];
  for (const id of FILTER_IDS) {
    const value = state.filters[id];
    if (value === FILTER_DEFAULTS[id]) continue;
    const label = id === "search" ? `search: "${value}"` : `${FILTER_LABELS[id]}: ${value}`;
    chips.push({ id, label });
  }
  filterChipsEl.replaceChildren(...chips.map((c) => {
    const chip = tpl("tpl-filter-chip");
    chip.querySelector("[data-slot=label]").textContent = c.label;
    chip.querySelector("[data-slot=remove]").dataset.filterId = c.id;
    return chip;
  }));
}

async function copyVisibleNextPrompt() {
  const keys = actionablePlans(filteredPlans(state.snapshot.plans))
    .map((record) => record.key)
    .slice(0, 20);
  if (keys.length === 0) throw new Error("no active or backlog plans in the current view");
  await copyPrompt("next", keys, "portable");
}

function actionablePlans(plans) {
  return plans.filter((record) => !["completed", "archived"].includes(record.plan.lifecycle));
}

function renderEmptyState(snapshot) {
  if (!snapshot.settings.discoveryRoots.length) {
    return el("section", { class: "empty-state" },
      el("h2", {}, "No Project Folders configured"),
      el("p", {}, "Add a repository path, or a folder containing repositories, above."),
      el("p", {}, "The scanner walks each Project Folder looking for a repository (a folder with a .git entry) and, inside it, a docs/plans directory. It stops descending the moment it finds a repository — nested folders inside a repo are never re-scanned — and skips common non-project directories like node_modules, dist, and .venv."),
    );
  }
  if (snapshot.plans.length === 0) {
    return el("section", { class: "empty-state" },
      el("h2", {}, "No plan documents found"),
      el("p", {}, "The scanner looks for Markdown files under docs/plans in each discovered repository."),
    );
  }
  return el("section", { class: "empty-state" },
    el("h2", {}, "No matching plans"),
    el("p", {}, "Adjust search or filters to show more results."),
  );
}

function renderWarnings(snapshot) {
  const warnings = [
    ...(snapshot.errors || []).map((err) => `${err.root || err.repository || "scan"}: ${err.error}`),
    ...(snapshot.truncated ? ["Scan results truncated. Narrow discovery roots."] : []),
  ];
  warningsEl.hidden = warnings.length === 0;
  warningsEl.replaceChildren(...warnings.map((warning) => el("div", {}, warning)));
}

function renderPackageBanner(snapshot) {
  const pkg = snapshot.planDocsPackage || {};
  if (pkg.enabled) {
    bannerEl.hidden = true;
    return;
  }
  bannerEl.hidden = false;
  const text = pkg.available
    ? "Browse plans now, or enable Plan Docs workflows to add /plan-docs prompts."
    : "Browse plans now. Plan Docs workflow package is not available in this install.";
  const enable = el("button", { type: "button" }, "Enable Plan Docs");
  enable.disabled = !pkg.available;
  enable.addEventListener("click", enablePackage);
  bannerEl.replaceChildren(el("div", {}, el("strong", {}, "Plan Docs workflows are not enabled. "), text), enable);
}

async function enablePackage() {
  try {
    await portalPostJson("/api/config/packages", { id: "plan-docs", enabled: true });
    applySnapshot(await portalGetJson("/api/plans"));
  } catch (err) {
    showError(err);
  }
}

function filteredPlans(plans) {
  const q = state.filters.search.toLowerCase().trim();
  return plans.filter((record) => {
    const plan = record.plan;
    if (state.filters.repository !== "all" && record.repository.id !== state.filters.repository) return false;
    if (state.filters.lifecycle !== "all" && plan.lifecycle !== state.filters.lifecycle) return false;
    if (state.filters.priority !== "all" && plan.priority !== state.filters.priority) return false;
    if (state.filters.blocked === "blocked" && plan.blockers.length === 0) return false;
    if (state.filters.blocked === "unblocked" && plan.blockers.length > 0) return false;
    if (state.filters.readiness !== "all" && plan.readiness !== state.filters.readiness) return false;
    if (state.filters.review !== "all" && plan.reviewState !== state.filters.review) return false;
    if (state.filters.health === "warnings" && plan.validation.warnings.length === 0) return false;
    if (state.filters.health === "valid" && plan.validation.warnings.length > 0) return false;
    if (!q) return true;
    return [
      plan.title,
      plan.id,
      plan.relativePath,
      plan.nextAction,
      record.repository.name,
      ...plan.blockers,
      ...plan.validation.warnings,
    ].join(" ").toLowerCase().includes(q);
  }).sort(planSort);
}

function planSort(a, b) {
  const priority = { high: 0, medium: 1, low: 2, none: 3 };
  const activeBlocked = (b.plan.lifecycle === "active" && b.plan.blockers.length ? 1 : 0)
    - (a.plan.lifecycle === "active" && a.plan.blockers.length ? 1 : 0);
  return activeBlocked
    || (priority[a.plan.priority] ?? 3) - (priority[b.plan.priority] ?? 3)
    || Date.parse(b.plan.modifiedAt) - Date.parse(a.plan.modifiedAt)
    || a.plan.title.localeCompare(b.plan.title);
}

function renderGroup(lifecycle, plans) {
  if (plans.length === 0) return null;
  const cards = el("div", { class: "card-grid" }, ...plans.map(renderCard));
  if (COLLAPSIBLE_GROUPS.has(lifecycle)) {
    const details = el("details", { class: "group" },
      el("summary", {}, `${lifecycle} (${plans.length})`),
      cards,
    );
    details.open = openGroups.has(lifecycle);
    details.addEventListener("toggle", () => {
      if (details.open) openGroups.add(lifecycle);
      else openGroups.delete(lifecycle);
    });
    return details;
  }
  return el("section", { class: "group" },
    el("h2", {}, `${lifecycle} (${plans.length})`),
    cards,
  );
}

function renderCard(record) {
  const plan = record.plan;
  const warnings = plan.validation.warnings.length;
  return el("article", { class: "plan-card" },
    el("div", {}, el("h3", {}, plan.title), el("div", { class: "path-line" }, `${record.repository.name} / ${plan.relativePath}`)),
    el("div", { class: "chips" },
      chip(plan.priority, plan.priority === "high" ? "warn" : ""),
      chip(plan.readiness, plan.readiness === "ready" ? "ok" : ""),
      chip(plan.reviewState, plan.reviewState === "possibly-stale" ? "warn" : ""),
      plan.blockers.length ? chip(`${plan.blockers.length} blockers`, "warn") : chip("unblocked", "ok"),
      chip(`${plan.taskCounts.remaining}/${plan.taskCounts.total} tasks`),
      warnings ? chip(`${warnings} warnings`, "warn") : chip("valid", "ok"),
    ),
    el("div", { class: "next-line" }, plan.nextAction || "No next action"),
    el("div", { class: "meta-line" }, `modified ${formatDate(plan.modifiedAt)}`),
    el("div", { class: "card-actions" },
      action("Open", () => openPlan(record.key)),
      action("Copy path", () => copyText(plan.relativePath)),
      action("Context", () => copyText(repositoryContext(record))),
      ...(state.snapshot.planDocsPackage.enabled ? [action("/plan-docs start", () => copyPrompt("start", [record.key]))] : []),
    ),
  );
}

async function openPlan(key) {
  try {
    renderDrawer(await portalGetJson(`/api/plans/document?key=${encodeURIComponent(key)}`));
  } catch (err) {
    showError(err);
  }
}

function renderDrawer(doc) {
  const plan = doc.plan.plan;
  document.getElementById("drawer-title").textContent = plan.title;
  document.getElementById("drawer-path").textContent = `${doc.plan.repository.name} / ${plan.relativePath}`;
  document.getElementById("drawer-doc").innerHTML = doc.html;
  document.getElementById("drawer-meta").replaceChildren(
    ...dtdd("id", plan.id || "(missing)"),
    ...dtdd("lifecycle", plan.lifecycle),
    ...dtdd("priority", plan.priority),
    ...dtdd("next action", plan.nextAction || "(none)"),
    ...dtdd("review", plan.reviewState),
    ...dtdd("tasks", `${plan.taskCounts.complete}/${plan.taskCounts.total} complete`),
  );
  const warnings = plan.validation.warnings.length ? plan.validation.warnings : ["none"];
  document.getElementById("drawer-warnings").replaceChildren(...warnings.map((warning) => el("li", {}, warning)));
  renderDrawerTasks(doc.parsed?.tasks || []);
  const actions = [
    action("Copy Markdown", () => copyText(doc.markdown)),
    action("Copy path", () => copyText(plan.relativePath)),
    action("Repository context", () => copyText(repositoryContext(doc.plan))),
    action("Portable context", () => copyPrompt("review", [doc.plan.key], "portable")),
  ];
  if (state.snapshot.planDocsPackage.enabled) {
    for (const mode of ["start", "sync", "validate", "review", "handoff"]) actions.push(action(`/plan-docs ${mode}`, () => copyPrompt(mode, [doc.plan.key])));
  }
  document.getElementById("drawer-actions").replaceChildren(...actions);
  drawer.hidden = false;
}

function renderDrawerTasks(tasks) {
  const list = document.getElementById("drawer-tasks");
  if (!tasks.length) {
    list.replaceChildren(el("li", {}, "none"));
    return;
  }
  list.replaceChildren(...tasks.map((task) => el("li", {
    class: task.done ? "task-done" : "task-open",
  }, `${task.done ? "[x]" : "[ ]"} ${task.text}`)));
}

async function copyPrompt(actionName, keys, mode = "repository-aware") {
  const result = await portalPostJson("/api/plans/prompt", { action: actionName, keys, mode });
  await copyText(result.prompt);
}

function repositoryContext(record) {
  return `Review the plan at \`${record.plan.relativePath}\` in this repository.\n\nFocus on:\n- the current next action\n- unresolved tasks\n- blockers\n- whether the plan still matches the implementation\n\nDo not assume the document is current. Verify relevant claims against the repository.`;
}

async function copyText(text) {
  await portalCopyText(text, () => {
    statusEl.textContent = "copied";
    setTimeout(() => { if (state.snapshot) statusEl.textContent = statusText(state.snapshot); }, 1200);
  });
}

function action(label, onClick) {
  const button = el("button", { type: "button" }, label);
  button.addEventListener("click", () => {
    try {
      const result = onClick();
      if (result?.catch) result.catch(showError);
    } catch (err) {
      showError(err);
    }
  });
  return button;
}

function chip(text, cls = "") {
  return el("span", { class: `chip ${cls}`.trim() }, text);
}

function dtdd(term, value) {
  return [el("dt", {}, term), el("dd", {}, value)];
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString();
}

function statusText(snapshot) {
  return `${snapshot.plans.length} plans · ${snapshot.repositories.length} repos`;
}

function showError(err) {
  statusEl.textContent = "error";
  warningsEl.hidden = false;
  warningsEl.textContent = String(err?.message || err);
}

load();

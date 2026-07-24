// All markup construction for the Plans page. Every export takes plain data (plus callbacks for
// the handful of elements that need a listener) and returns a DOM node or a set of nodes to
// insert. Nothing here reads or writes app state directly — app.js wires results into the page
// and back into state.

import {
  portalEl as el,
  portalTpl as tpl,
  portalFillSlots as fill,
} from "/portal/shared/api.js";
import { FILTER_LABELS, LIFECYCLE_LABELS, formatDate } from "./state.js";

export function rootChip(root, onRemove) {
  const node = fill(tpl("tpl-root-chip"), { path: root });
  node
    .querySelector("[data-slot=remove]")
    .addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onRemove(root);
    });
  return node;
}

export function filterChip({ id, label, chipValue }) {
  const chip = document.createElement("filter-chip");
  chip.setAttribute("filter-id", id);
  chip.setAttribute("label", label);
  chip.setAttribute("value", chipValue);
  return chip;
}

export function filterChipDescriptors(filters, defaults, optionLabelFor) {
  const chips = [];
  for (const id of Object.keys(defaults)) {
    const value = filters[id];
    if (value === defaults[id]) continue;
    const label = id === "search" ? "search" : FILTER_LABELS[id];
    const chipValue =
      id === "search" ? `"${value}"` : optionLabelFor(id, value);
    chips.push({ id, label, chipValue });
  }
  return chips;
}

export function selectOption([value, label]) {
  return el("option", { value }, label);
}

export function emptyState(snapshot) {
  if (!snapshot.settings.discoveryRoots.length) {
    return null; // the "No Project Folders configured" message already lives in the .settings block
  }
  if (snapshot.plans.length === 0) {
    return fill(tpl("tpl-empty-state"), {
      title: "No plan documents found",
      body: "The scanner looks for Markdown files under docs/plans in each discovered repository.",
    });
  }
  return fill(tpl("tpl-empty-state"), {
    title: "No matching plans",
    body: "Adjust search or filters to show more results.",
  });
}

export function warningLine(text) {
  return el("div", {}, text);
}

export function listItem(text) {
  return el("li", {}, text);
}

export function spinner() {
  return el("span", { class: "spinner" });
}

export function packageBanner(pkg, onEnable, skillModal) {
  const text = pkg.available
    ? "Enable skill to add functionality for managing markdown planning documents."
    : "";
  const node = fill(tpl("tpl-package-banner"), { text });
  const details = node.querySelector("[data-slot=details]");
  details.addEventListener("click", () => skillModal.open("plan-docs", "plan-docs"));
  const action = node.querySelector("[data-slot=action]");
  action.disabled = !pkg.available;
  action.addEventListener("click", onEnable);
  return node;
}

export function lifecycleTab(lifecycle, count, isSelected, onSelect) {
  const btn = el(
    "button",
    {
      type: "button",
      class: "lifecycle-tab" + (isSelected ? " selected" : ""),
      role: "tab",
      "aria-selected": String(isSelected),
    },
    `${LIFECYCLE_LABELS[lifecycle] || lifecycle} (${count})`,
  );
  btn.addEventListener("click", () => onSelect(lifecycle));
  return btn;
}

// cardActions: { onOpen, onCopyPath, onCopyContext, onCopyPortableContext, onPlanDocsAction,
//                 onPriorityChange, planDocsEnabled, planDocsPackage, skillModal, onEnablePackage,
//                 onError }
export function cardGrid(plans, cardActions, dirtyKeys) {
  const grid = document.createElement("div");
  grid.className = "card-grid";
  grid.append(
    ...plans.map((record) =>
      planCardElement(record, cardActions, dirtyKeys.has(record.key)),
    ),
  );
  return grid;
}

function planCardElement(record, cardActions, isDirty) {
  const node = document.createElement("plan-card");
  node.record = record;
  node.actions = cardActions;
  node.dirty = isDirty;
  return node;
}

// The /plan-docs lifecycle actions. Label is the plain, in-context verb (we're already in the
// plan-docs universe, so no "/plan-docs" prefix); mode is the skill action; description is the
// one-line effect. Every one of these produces a clipboard prompt — the agent runs the skill after
// you paste. Wording tracks docs/guides/plan-docs.md's "Common modes".
const PLAN_DOCS_ACTIONS = [
  ["start", "Start", "Move this plan into active and begin."],
  ["sync", "Sync", "Update the plan from completed session work."],
  ["validate", "Validate", "Check schema, lifecycle, and repo consistency."],
  ["review", "Review", "Decide complete / incomplete / blocked / superseded."],
  ["handoff", "Handoff", "Prepare a next-chat handoff."],
];
const ACTION_LABEL = Object.fromEntries(PLAN_DOCS_ACTIONS.map(([mode, label]) => [mode, label]));

// Which lifecycles each action is valid in — only valid actions are SHOWN in the menu now (not
// disabled), so the menu is scoped to what makes sense for this plan's state. Grounded in the
// plan-docs workflow references: start moves backlog/unclassified work into active (workflow-start:
// "not completed or archived", "backlog → active"); sync/review act on an active plan
// (workflow-sync keeps it active; workflow-review decides an active plan's outcome); handoff hands
// off in-progress work (backlog/active); validate is a safe consistency check in any lifecycle.
const ACTION_LIFECYCLES = {
  start: new Set(["backlog", "unclassified"]),
  sync: new Set(["active"]),
  validate: null, // null = every lifecycle
  review: new Set(["active"]),
  handoff: new Set(["backlog", "active"]),
};

function actionAppliesToLifecycle(mode, lifecycle) {
  const set = ACTION_LIFECYCLES[mode];
  return set === null || set === undefined ? true : set.has(lifecycle);
}

function actionsForLifecycle(lifecycle) {
  return PLAN_DOCS_ACTIONS.filter(([mode]) => actionAppliesToLifecycle(mode, lifecycle));
}

// Best-effort single recommended next mode, derived from plan state. Returns null when no rule
// clearly applies (e.g. blocked, or already mid-progress with no strong signal) rather than guessing.
export function recommendedPlanDocsMode(plan) {
  if (plan.blockers.length > 0) return null;
  if (plan.lifecycle === "backlog") return "start";
  if (plan.lifecycle !== "active") return null;
  const { complete, total } = plan.taskCounts;
  if (total > 0 && complete === total) return "review";
  if (plan.reviewState === "possibly-stale") return "sync";
  if (plan.reviewState === "never-reviewed") return "validate";
  return null;
}

// The recommended-next CTA descriptor, or null. Only surfaces a mode that is both recommended AND
// valid for the current lifecycle. Label reads e.g. "Review prompt".
function recommendedCta(plan) {
  const mode = recommendedPlanDocsMode(plan);
  if (!mode || !actionAppliesToLifecycle(mode, plan.lifecycle)) return null;
  return { mode, label: `${ACTION_LABEL[mode]} prompt` };
}

// One clickable menu item (icon + label + optional description) that runs copyFn on click. `run`
// wraps copyFn so a copy failure surfaces via onError instead of an unhandled rejection.
function menuItem({ icon = "copy", label, description, run }) {
  const item = el(
    "button",
    { type: "button", class: "menu-button-item" },
    el("portal-icon", { name: icon, width: "14", height: "14", class: "menu-button-item-icon" }),
    el(
      "div",
      { class: "menu-button-item-body" },
      el("span", {}, label),
      description ? el("span", { class: "menu-button-item-desc" }, description) : null,
    ),
  );
  item.addEventListener("click", async (event) => {
    event.stopPropagation();
    await run();
  });
  return item;
}

// The unified ⋯ menu body, shared by the drawer and the card. When plan-docs is installed it shows
// the lifecycle-valid actions (each copies its prompt), with the recommended one marked and Review
// carrying a "portable" variant (a self-contained summary for a chat without repo access — the one
// place portable is meaningful, since the other actions edit repo files). Copy path is always last.
// When plan-docs is NOT installed there are no lifecycle actions, so it falls back to the generic
// repo-aware / portable prompts plus the enable-skill banner.
//
// api: { installed, lifecycle, recommendedMode, planDocsPackage, skillModal, onError,
//        copyPath, copyPrompt(mode, {portable}), copyRepoPrompt, copyPortablePrompt, onEnablePackage }
function planMenuBody(api) {
  const wrap = el("div", { class: "plan-menu" });
  const run = (fn) => async () => {
    try {
      await fn();
    } catch (err) {
      api.onError?.(err);
    }
  };

  if (api.installed) {
    wrap.append(
      el("p", { class: "menu-button-item-desc plan-menu-note" },
        "Copies a /plan-docs prompt to your clipboard — paste it into an agent chat to run."),
    );
    const group = el("div", { class: "plan-menu-group" });
    for (const [mode, label, description] of actionsForLifecycle(api.lifecycle)) {
      const isRecommended = mode === api.recommendedMode;
      const row = el("div", { class: "plan-menu-action" + (isRecommended ? " is-recommended" : "") });
      row.append(menuItem({ icon: "agent-prompt", label, description, run: run(() => api.copyPrompt(mode, { portable: false })) }));
      // Review is a read/decide action, so a portable (repo-less) variant is useful; the file-
      // editing actions need repo access, so they get no portable variant.
      if (mode === "review") {
        const portable = el("button", { type: "button", class: "plan-menu-variant" }, "portable");
        portable.title = "Self-contained prompt — works in a chat without repo access";
        portable.addEventListener("click", (event) => { event.stopPropagation(); run(() => api.copyPrompt(mode, { portable: true }))(); });
        row.append(portable);
      }
      group.append(row);
    }
    wrap.append(group);
  } else {
    // No lifecycle actions available — offer the generic prompts the actions would otherwise cover.
    wrap.append(
      el("p", { class: "menu-button-item-desc plan-menu-note" },
        "Enable the Plan Docs skill for lifecycle actions (start, sync, review…). For now, copy a generic prompt:"),
      menuItem({ icon: "agent-prompt", label: "Repo-aware prompt", description: "For an agent that already has this repo open", run: run(() => api.copyRepoPrompt()) }),
      menuItem({ icon: "agent-prompt", label: "Portable prompt", description: "Self-contained — works without repo access", run: run(() => api.copyPortablePrompt()) }),
    );
  }

  wrap.append(menuItem({ icon: "copy", label: "Copy path", run: run(() => api.copyPath()) }));

  if (api.installed === false && api.planDocsPackage) {
    wrap.append(packageBanner(api.planDocsPackage, api.onEnablePackage, api.skillModal));
  }
  return wrap;
}

// drawerActions: { onCopyPath, onCopyRepoContext, onCopyPortableContext, onPlanDocsAction,
//                   onEnablePackage, planDocsPackage, skillModal, onError }
export function drawerContent(doc, drawerActions) {
  const plan = doc.plan.plan;
  const pkg = drawerActions.planDocsPackage || {};
  const key = doc.plan.key;
  const menu = planMenuBody({
    installed: Boolean(pkg.enabled),
    lifecycle: plan.lifecycle,
    recommendedMode: recommendedPlanDocsMode(plan),
    planDocsPackage: pkg,
    skillModal: drawerActions.skillModal,
    onError: drawerActions.onError,
    onEnablePackage: drawerActions.onEnablePackage,
    copyPath: () => drawerActions.onCopyPath(plan.relativePath),
    copyPrompt: (mode, { portable }) => drawerActions.onPlanDocsAction(key, mode, { portable }),
    copyRepoPrompt: () => drawerActions.onCopyRepoContext(doc.plan),
    copyPortablePrompt: () => drawerActions.onCopyPortableContext(key),
  });
  return {
    title: plan.title,
    path: `${doc.plan.repository.name} / ${plan.relativePath}`,
    html: doc.html,
    meta: [
      dtdd("id", plan.id || "(missing)"),
      dtdd("lifecycle", plan.lifecycle),
      dtdd("priority", plan.priority),
      dtdd("next action", plan.nextAction || "(none)"),
      dtdd("review", plan.reviewState),
      dtdd(
        "tasks",
        `${plan.taskCounts.complete}/${plan.taskCounts.total} complete`,
      ),
    ],
    warnings: plan.validation.warnings,
    tasks: doc.parsed?.tasks || [],
    cta: recommendedCta(plan),
    menu,
  };
}

// The plan card's ⋯ menu — the same unified body as the drawer, wired to the card's cardActions.
// record is a plan record (record.plan is the plan). Returns a configured <portal-menu-button>.
export function cardActionMenu(record, cardActions) {
  const plan = record.plan;
  const menu = document.createElement("portal-menu-button");
  menu.setAttribute("label", "⋯");
  menu.setAttribute("aria-label", "Plan actions");
  menu.panelContent = planMenuBody({
    installed: Boolean(cardActions.planDocsEnabled),
    lifecycle: plan.lifecycle,
    recommendedMode: recommendedPlanDocsMode(plan),
    planDocsPackage: cardActions.planDocsPackage,
    skillModal: cardActions.skillModal,
    onError: cardActions.onError,
    onEnablePackage: cardActions.onEnablePackage,
    copyPath: () => cardActions.onCopyPath(plan.relativePath),
    copyPrompt: (mode, { portable }) => cardActions.onPlanDocsAction(record.key, mode, { portable }),
    copyRepoPrompt: () => cardActions.onCopyContext(record),
    copyPortablePrompt: () => cardActions.onCopyPortableContext(record.key),
  });
  return menu;
}

// Recommended-next CTA button for the card, or null when there's no clear recommendation. Copies the
// recommended action's prompt on click.
export function cardRecommendedCta(record, cardActions) {
  const cta = recommendedCta(record.plan);
  if (!cta) return null;
  const btn = el("button", { type: "button", class: "recommended-cta", "data-btn": "cta" }, cta.label);
  btn.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await cardActions.onPlanDocsAction(record.key, cta.mode, { portable: false });
    } catch (err) {
      cardActions.onError?.(err);
    }
  });
  return btn;
}

export function drawerTaskItems(tasks) {
  if (!tasks.length) return [el("li", {}, "none")];
  return tasks.map((task) =>
    el(
      "li",
      { class: task.done ? "task-done" : "task-open" },
      `${task.done ? "[x]" : "[ ]"} ${task.text}`,
    ),
  );
}

export function dtdd(term, value) {
  return fill(tpl("tpl-dtdd-row"), { term, value });
}

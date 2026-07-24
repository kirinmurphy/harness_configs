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

// cardActions: { onOpen, onCopyPath, onCopyContext, onPlanDocsStart, onPriorityChange,
//                 planDocsEnabled, onError }
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

// Short, fixed descriptions for each /plan-docs mode — shown in the drawer's Actions popup table.
// Wording matches docs/guides/plan-docs.md's "Common modes" list.
const PLAN_DOCS_MODES = [
  ["start", "Move selected work into active and begin."],
  ["sync", "Update a plan from completed session work."],
  ["validate", "Check schema, lifecycle, and repo consistency."],
  ["review", "Decide complete/incomplete/blocked/superseded."],
  ["handoff", "Prepare a next-chat handoff."],
];

// Best-effort single recommended next mode, derived from plan state. Returns null when no rule
// clearly applies (e.g. blocked, or already mid-progress with no strong signal) rather than
// guessing — an unhighlighted table beats a wrong highlight.
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

// drawerActions: { onCopyMarkdown, onCopyPath, onCopyRepoContext, onCopyPortableContext,
//                   onPlanDocsAction, onEnablePackage, planDocsPackage, skillModal, onError }
export function drawerContent(doc, drawerActions) {
  const plan = doc.plan.plan;
  const copyMenu = copyMenuContent(doc, drawerActions);
  const actionsMenu = actionsMenuContent(doc, drawerActions);
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
    copyMenu,
    actionsMenu,
  };
}

function copyMenuItem(label, description, copySource) {
  const item = el(
    "button",
    { type: "button", class: "menu-button-item" },
    el("portal-icon", { name: "copy", width: "14", height: "14", class: "menu-button-item-icon" }),
    el(
      "div",
      { class: "menu-button-item-body" },
      el("span", {}, label),
      description ? el("span", { class: "menu-button-item-desc" }, description) : null,
    ),
  );
  item.addEventListener("click", async (event) => {
    event.stopPropagation();
    await copySource();
  });
  return item;
}

function copyMenuContent(doc, drawerActions) {
  const plan = doc.plan.plan;
  return el(
    "div",
    {},
    copyMenuItem("Copy Markdown", null, () => drawerActions.onCopyMarkdown(doc.markdown)),
    copyMenuItem("Copy path", null, () => drawerActions.onCopyPath(plan.relativePath)),
    copyMenuItem(
      "Repository context",
      "Prompt for an agent that already has this repo open",
      () => drawerActions.onCopyRepoContext(doc.plan),
    ),
    copyMenuItem(
      "Portable context",
      "Self-contained prompt — works without repo access",
      () => drawerActions.onCopyPortableContext(doc.plan.key),
    ),
  );
}

function actionsMenuContent(doc, drawerActions) {
  const plan = doc.plan.plan;
  const pkg = drawerActions.planDocsPackage || {};
  if (!pkg.enabled) {
    return el(
      "div",
      { class: "actions-menu-disabled" },
      el("p", { class: "menu-button-item-desc" }, "Plan Docs is an optional skill that adds /plan-docs workflow prompts (start, sync, validate, review, handoff) for this plan."),
      packageBanner(pkg, drawerActions.onEnablePackage, drawerActions.skillModal),
    );
  }
  const recommended = recommendedPlanDocsMode(plan);
  const table = el("table", { class: "actions-menu-table" });
  for (const [mode, description] of PLAN_DOCS_MODES) {
    const isRecommended = mode === recommended;
    const button = el(
      "button",
      { type: "button", "data-btn": isRecommended ? "cta" : "secondary" },
      mode,
    );
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await drawerActions.onPlanDocsAction(mode, doc.plan.key);
    });
    table.append(
      el(
        "tr",
        { class: isRecommended ? "actions-menu-row-recommended" : "" },
        el("td", {}, el("strong", {}, `${mode}: `), description),
        el("td", {}, button),
      ),
    );
  }
  return table;
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

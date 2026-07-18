// All markup construction for the Plans page. Every export takes plain data (plus callbacks for
// the handful of elements that need a listener) and returns a DOM node or a set of nodes to
// insert. Nothing here reads or writes app state directly — app.js wires results into the page
// and back into state.

import { portalEl as el, portalTpl as tpl, portalFillSlots as fill } from "/portal/shared/api.js";
import { FILTER_LABELS, formatDate } from "./state.js";

export function rootChip(root, onRemove) {
  const node = fill(tpl("tpl-root-chip"), { path: root });
  node.querySelector("[data-slot=remove]").addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onRemove(root);
  });
  return node;
}

export function filterChip({ id, label, chipValue }) {
  const chip = tpl("tpl-filter-chip");
  chip.querySelector("[data-slot=label]").textContent = label;
  chip.querySelector("[data-slot=value]").textContent = chipValue;
  chip.querySelector("[data-slot=remove]").dataset.filterId = id;
  return chip;
}

export function filterChipDescriptors(filters, defaults, optionLabelFor) {
  const chips = [];
  for (const id of Object.keys(defaults)) {
    const value = filters[id];
    if (value === defaults[id]) continue;
    const label = id === "search" ? "search" : FILTER_LABELS[id];
    const chipValue = id === "search" ? `"${value}"` : optionLabelFor(id, value);
    chips.push({ id, label, chipValue });
  }
  return chips;
}

export function selectOption([value, label]) {
  return el("option", { value }, label);
}

export function emptyState(snapshot) {
  if (!snapshot.settings.discoveryRoots.length) {
    return null; // the "No Project Folders configured" message already lives in the settings header
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

export function packageBanner(pkg, onEnable) {
  const text = pkg.available
    ? "Browse plans now, or enable Plan Docs workflows to add /plan-docs prompts."
    : "Browse plans now. Plan Docs workflow package is not available in this install.";
  const node = fill(tpl("tpl-package-banner"), { text });
  const action = node.querySelector("[data-slot=action]");
  action.disabled = !pkg.available;
  action.addEventListener("click", onEnable);
  return node;
}

export function group(lifecycle, plans, { collapsible, open, onToggle, cardActions }) {
  if (plans.length === 0) return null;
  const title = `${lifecycle} (${plans.length})`;
  const cards = plans.map((record) => card(record, cardActions));
  if (collapsible) {
    const details = fill(tpl("tpl-group-collapsible"), { title });
    details.querySelector("[data-slot=cards]").append(...cards);
    details.open = open;
    details.addEventListener("toggle", () => onToggle(details.open));
    return details;
  }
  const section = fill(tpl("tpl-group"), { title });
  section.querySelector("[data-slot=cards]").append(...cards);
  return section;
}

// cardActions: { onOpen, onCopyPath, onCopyContext, onPlanDocsStart, planDocsEnabled, onError }
function card(record, cardActions) {
  const plan = record.plan;
  const warnings = plan.validation.warnings.length;
  const { onError } = cardActions;
  const node = fill(tpl("tpl-plan-card"), {
    title: plan.title,
    path: `${record.repository.name} / ${plan.relativePath}`,
    next: plan.nextAction || "No next action",
    meta: `modified ${formatDate(plan.modifiedAt)}`,
  });
  node.querySelector("[data-slot=chips]").append(
    chip(plan.priority, plan.priority === "high" ? "warn" : ""),
    chip(plan.readiness, plan.readiness === "ready" ? "ok" : ""),
    chip(plan.reviewState, plan.reviewState === "possibly-stale" ? "warn" : ""),
    plan.blockers.length
      ? chip(`${plan.blockers.length} blockers`, "warn")
      : chip("unblocked", "ok"),
    chip(`${plan.taskCounts.remaining}/${plan.taskCounts.total} tasks`),
    warnings ? chip(`${warnings} warnings`, "warn") : chip("valid", "ok"),
  );
  node.querySelector("[data-slot=actions]").append(
    actionButton("Open", () => cardActions.onOpen(record.key), onError),
    actionButton("Copy path", () => cardActions.onCopyPath(plan.relativePath), onError),
    actionButton("Context", () => cardActions.onCopyContext(record), onError),
    ...(cardActions.planDocsEnabled
      ? [actionButton("/plan-docs start", () => cardActions.onPlanDocsStart(record.key), onError)]
      : []),
  );
  return node;
}

// drawerActions: { onCopyMarkdown, onCopyPath, onCopyRepoContext, onCopyPortableContext,
//                   onPlanDocsAction, planDocsEnabled, onError }
export function drawerContent(doc, drawerActions) {
  const plan = doc.plan.plan;
  const { onError } = drawerActions;
  const actions = [
    actionButton("Copy Markdown", () => drawerActions.onCopyMarkdown(doc.markdown), onError),
    actionButton("Copy path", () => drawerActions.onCopyPath(plan.relativePath), onError),
    actionButton("Repository context", () => drawerActions.onCopyRepoContext(doc.plan), onError),
    actionButton(
      "Portable context",
      () => drawerActions.onCopyPortableContext(doc.plan.key),
      onError,
    ),
  ];
  if (drawerActions.planDocsEnabled) {
    for (const mode of ["start", "sync", "validate", "review", "handoff"])
      actions.push(
        actionButton(
          `/plan-docs ${mode}`,
          () => drawerActions.onPlanDocsAction(mode, doc.plan.key),
          onError,
        ),
      );
  }
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
      dtdd("tasks", `${plan.taskCounts.complete}/${plan.taskCounts.total} complete`),
    ],
    warnings: plan.validation.warnings.length ? plan.validation.warnings : ["none"],
    tasks: doc.parsed?.tasks || [],
    actions,
  };
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

export function actionButton(label, onClick, onError) {
  const button = tpl("tpl-action-button");
  button.textContent = label;
  button.addEventListener("click", () => {
    try {
      const result = onClick();
      if (result?.catch) result.catch(onError);
    } catch (err) {
      onError(err);
    }
  });
  return button;
}

export function chip(text, cls = "") {
  const node = tpl("tpl-chip");
  node.textContent = text;
  if (cls) node.classList.add(cls);
  return node;
}

export function dtdd(term, value) {
  return fill(tpl("tpl-dtdd-row"), { term, value });
}

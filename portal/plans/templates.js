// All markup construction for the Plans page. Every export takes plain data (plus callbacks for
// the handful of elements that need a listener) and returns a DOM node or a set of nodes to
// insert. Nothing here reads or writes app state directly — app.js wires results into the page
// and back into state.

import {
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

// <select> children are trivial and a <template> adds no value here, so this builds the native
// element directly rather than through tpl()/fill() — mirrors telemetry/templates.js's selectOption.
export function selectOption([value, label]) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  return opt;
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
  return fill(tpl("tpl-warning-line"), { text });
}

export function listItem(text) {
  return fill(tpl("tpl-list-item"), { text });
}

export function spinner() {
  return tpl("tpl-spinner");
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
  const btn = fill(tpl("tpl-lifecycle-tab"), {
    label: `${LIFECYCLE_LABELS[lifecycle] || lifecycle} (${count})`,
  });
  btn.classList.toggle("selected", isSelected);
  btn.setAttribute("aria-selected", String(isSelected));
  btn.addEventListener("click", () => onSelect(lifecycle));
  return btn;
}

// cardActions: { onOpen, onCopyPath, onCopyContext, onCopyPortableContext, onPlanDocsAction,
//                 onStart, onArchive, planDocsEnabled, planDocsPackage, skillModal,
//                 onEnablePackage, onError }
export function cardGrid(plans, cardActions) {
  const grid = document.createElement("div");
  grid.className = "card-grid";
  grid.append(...plans.map((record) => planCardElement(record, cardActions)));
  return grid;
}

function planCardElement(record, cardActions) {
  const node = document.createElement("plan-card");
  node.record = record;
  node.actions = cardActions;
  return node;
}

// The /plan-docs lifecycle actions. Label is the plain, in-context verb (we're already in the
// plan-docs universe, so no "/plan-docs" prefix); mode is the skill action; description is the
// one-line effect. Every one of these produces a clipboard prompt — the agent runs the skill after
// you paste. Wording tracks docs/user/guides/plan/lifecycle/plan-docs.md's "Common modes".
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
  const item = fill(tpl("tpl-menu-item"), { label });
  item.querySelector("[data-slot=icon]").setAttribute("name", icon);
  const descSlot = item.querySelector("[data-slot=description]");
  if (description) {
    descSlot.textContent = description;
    descSlot.hidden = false;
  }
  item.addEventListener("click", async (event) => {
    event.stopPropagation();
    await run();
  });
  return item;
}

// The unified ⋯ menu body, shared by the drawer and the card. When plan-docs is installed it shows
// the lifecycle-valid actions (each copies its prompt), with Review carrying a "portable" variant
// (a self-contained summary for a chat without repo access — the one place portable is meaningful,
// since the other actions edit repo files). Copy path is always last. The recommended action gets
// its own dedicated CTA button outside this menu (see recommendedCta/cardRecommendedCta) — it is
// deliberately not called out again inside the menu, to avoid a second, redundant highlight.
// When plan-docs is NOT installed there are no lifecycle actions, so it falls back to the generic
// repo-aware / portable prompts plus the enable-skill banner.
//
// api: { installed, lifecycle, planDocsPackage, skillModal, onError,
//        copyPath, copyPrompt(mode, {portable}), copyRepoPrompt, copyPortablePrompt, onEnablePackage }
function planMenuBody(api) {
  const wrap = tpl("tpl-plan-menu");
  const run = (fn) => async () => {
    try {
      await fn();
    } catch (err) {
      api.onError?.(err);
    }
  };

  const note = wrap.querySelector("[data-slot=note]");
  const group = wrap.querySelector("[data-slot=group]");
  const fallbackActions = wrap.querySelector("[data-slot=fallback-actions]");

  if (api.installed) {
    note.textContent = "Copies a prompt to run in an agent chat.";
    group.hidden = false;
    for (const [mode, label, description] of actionsForLifecycle(api.lifecycle)) {
      const row = tpl("tpl-plan-menu-action");
      row.querySelector("[data-slot=item]").append(
        menuItem({ icon: "agent-prompt", label, description, run: run(() => api.copyPrompt(mode, { portable: false })) }),
      );
      // Review is a read/decide action, so a portable (repo-less) variant is useful; the file-
      // editing actions need repo access, so they get no portable variant.
      if (mode === "review") {
        const portable = row.querySelector("[data-slot=portable]");
        portable.hidden = false;
        portable.title = "Self-contained prompt — works in a chat without repo access";
        portable.addEventListener("click", (event) => { event.stopPropagation(); run(() => api.copyPrompt(mode, { portable: true }))(); });
      }
      group.append(row);
    }
  } else {
    // No lifecycle actions available — offer the generic prompts the actions would otherwise cover.
    note.textContent = "Enable Plan Docs for lifecycle actions. For now:";
    fallbackActions.hidden = false;
    fallbackActions.append(
      menuItem({ icon: "agent-prompt", label: "Repo-aware prompt", description: "For an agent that already has this repo open", run: run(() => api.copyRepoPrompt()) }),
      menuItem({ icon: "agent-prompt", label: "Portable prompt", description: "Self-contained — works without repo access", run: run(() => api.copyPortablePrompt()) }),
    );
  }

  wrap.querySelector("[data-slot=copy-path]").append(
    menuItem({ icon: "copy", label: "Copy path", run: run(() => api.copyPath()) }),
  );

  if (api.installed === false && api.planDocsPackage) {
    const banner = wrap.querySelector("[data-slot=package-banner]");
    banner.hidden = false;
    banner.append(packageBanner(api.planDocsPackage, api.onEnablePackage, api.skillModal));
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
    // Lifecycle, priority, next action, review, and task progress now render in the shared
    // <plan-status> section mounted alongside this metadata list, not as static rows here.
    meta: [
      dtdd("id", plan.id || "(missing)"),
      dtdd("repository", doc.plan.repository.name),
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
  menu.setAttribute("icon", "copy");
  menu.setAttribute("aria-label", "Plan actions");
  menu.panelContent = planMenuBody({
    installed: Boolean(cardActions.planDocsEnabled),
    lifecycle: plan.lifecycle,
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
  const btn = fill(tpl("tpl-recommended-cta"), { label: cta.label });
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

// Start/Archive lifecycle-mutation shortcuts (see docs/plans/active/plan-lifecycle-toggle-control.md
// "Actions by current state"). These call the shared lifecycle mutation directly rather than
// copying a prompt — Start moves Backlog into Active (opening the Active lifecycle-event dialog)
// or, when already Active, opens the same dialog without mutating. Archive moves Active into
// Archived with default (non-CTA) button styling since it doesn't open an event dialog.
export function cardLifecycleActions(record, cardActions) {
  const lifecycle = record.plan.lifecycle;
  if (lifecycle !== "backlog" && lifecycle !== "active") return [];
  const buttons = [];
  const startBtn = fill(tpl("tpl-recommended-cta"), { label: "Start" });
  startBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    cardActions.onStart(record);
  });
  buttons.push(startBtn);
  if (lifecycle === "active") {
    const archiveBtn = fill(tpl("tpl-secondary-action"), { label: "Archive" });
    archiveBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      cardActions.onArchive(record);
    });
    buttons.push(archiveBtn);
  }
  return buttons;
}

export function drawerTaskItems(tasks) {
  if (!tasks.length) return [fill(tpl("tpl-task-item"), { text: "none" })];
  return tasks.map((task) => {
    const node = fill(tpl("tpl-task-item"), { text: `${task.done ? "[x]" : "[ ]"} ${task.text}` });
    node.classList.add(task.done ? "task-done" : "task-open");
    return node;
  });
}

export function dtdd(term, value) {
  return fill(tpl("tpl-dtdd-row"), { term, value });
}

// One entry in the drawer's Blocked by / Blocking sections (see state.js's resolveBlockers /
// resolveBlocking) — a link for a resolved blocker, plain unclickable text otherwise. Shares the
// same tpl-blocker-link/tpl-blocker-unresolved templates as blockers-popover.js's card popup.
export function blockerLink(blocker, onOpenPlan) {
  if (!blocker.resolved) return fill(tpl("tpl-blocker-unresolved"), { title: blocker.title });
  const link = fill(tpl("tpl-blocker-link"), { title: blocker.title });
  link.addEventListener("click", () => onOpenPlan(blocker.key));
  return link;
}

// One problem in the blocked-move dialog: what is wrong, and how to fix it. Findings that predate
// the structured shape carry only a message, so the resolution line is dropped rather than
// rendered empty.
export function lifecycleFinding(item) {
  const node = fill(tpl("tpl-lifecycle-finding"), { message: item.message });
  const resolution = node.querySelector("[data-slot=resolution]");
  if (item.resolution) resolution.textContent = item.resolution;
  else resolution.remove();
  return node;
}

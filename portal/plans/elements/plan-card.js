// <plan-card> — set .record (plan record) and .actions (cardActions bag: onOpen, onCopyPath,
// onCopyContext, onPlanDocsStart, planDocsEnabled, onError) as properties right after creation,
// then append to the DOM. The whole card triggers onOpen on click, except interactive widgets
// (priority dropdown, action buttons) inside it; builds the chip row and action-button row from
// the two properties.
import { portalTpl as tpl, portalFillSlots as fill } from "/portal/shared/api.js";

// Card shows a shortened preview; full text (up to 500 chars) still lives in plan.excerpt
// for copy-context/drawer use — only the on-card display is truncated further here.
const EXCERPT_DISPLAY_LENGTH = 190;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function isSameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "modified: unknown";

  const now = new Date();
  const elapsedMs = now.getTime() - date.getTime();
  const elapsedMinutes = elapsedMs / MINUTE_MS;
  const elapsedHours = elapsedMs / HOUR_MS;
  const elapsedDays = elapsedMs / DAY_MS;

  if (elapsedMinutes < 5) return "just now";
  if (elapsedMinutes < 60) return "a few minutes ago";
  if (elapsedHours < 5) return "a few hours ago";

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameCalendarDay(date, now)) return "earlier today";
  if (isSameCalendarDay(date, yesterday)) return "yesterday";

  if (elapsedDays < 5) return "a few days ago";
  if (elapsedDays < 11) return "a week ago";
  if (elapsedDays < 28) return "a few weeks ago";
  if (elapsedDays < 45) return "a month ago";
  if (elapsedDays < 330) return "a few months ago";
  if (elapsedDays < 550) return "a year ago";
  return "a few years ago";
}

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

function chip(text, cls = "") {
  const node = tpl("tpl-chip");
  node.textContent = text;
  if (cls) node.classList.add(cls);
  return node;
}

function actionButton(label, onClick, onError) {
  const button = document.createElement("action-button");
  button.setAttribute("label", label);
  button.onClick = onClick;
  button.onError = onError;
  return button;
}

const PRIORITY_OPTIONS = [
  ["high", "high"],
  ["medium", "medium"],
  ["low", "low"],
  ["none", "none"],
];

// Priority no longer applies once a plan is done — completed/archived plans keep the field on
// the record for history, but the card shouldn't offer to edit it.
const LIFECYCLES_WITHOUT_PRIORITY = new Set(["completed", "archived"]);

function renderPriorityDropdown(record, cardActions) {
  const dropdown = document.createElement("option-dropdown");
  dropdown.options = PRIORITY_OPTIONS;
  dropdown.value = record.plan.priority;
  dropdown.onSelect = async (value) => {
    dropdown.loading = true;
    dropdown.title = "";
    dropdown.classList.remove("dropdown-error");
    try {
      const result = await cardActions.onPriorityChange(record, value);
      dropdown.value = result.priority;
    } catch (err) {
      // The page-level error banner lives far above the card grid — easy to miss when you're
      // scrolled down acting on a card, so the failure can look like it silently did nothing.
      // Put the message on the control itself too (native title tooltip + red outline) as a
      // failure the user notices right where they clicked.
      dropdown.title = err?.message || String(err);
      dropdown.classList.add("dropdown-error");
      cardActions.onError(err);
    } finally {
      dropdown.loading = false;
    }
  };
  return dropdown;
}

class PlanCardElement extends HTMLElement {
  connectedCallback() {
    if (this.record && this.actions) this.render();
  }

  set record(value) {
    this._record = value;
    if (this.isConnected && this.actions) this.render();
  }
  get record() {
    return this._record;
  }

  set actions(value) {
    this._actions = value;
    if (this.isConnected && this.record) this.render();
  }
  get actions() {
    return this._actions;
  }

  set dirty(value) {
    this._dirty = Boolean(value);
    if (this.isConnected && this.record && this.actions) this.render();
  }
  get dirty() {
    return Boolean(this._dirty);
  }

  render() {
    const record = this._record;
    const cardActions = this._actions;
    const plan = record.plan;
    const warnings = plan.validation.warnings.length;
    const { onError } = cardActions;

    const { total, remaining } = plan.taskCounts;
    const complete = total - remaining;
    const percentComplete = total > 0 ? Math.round((complete / total) * 100) : 0;
    const isBlocked = plan.blockers.length > 0;
    const isActive = plan.lifecycle === "active";

    const node = fill(tpl("tpl-plan-card"), {
      description: truncate(plan.excerpt || "No description", EXCERPT_DISPLAY_LENGTH),
      meta: `modified ${formatRelativeTime(plan.modifiedAt)}`,
      "progress-label": total > 0 ? `${percentComplete}%` : "no tasks",
      next: plan.nextAction || "No next action",
    });
    node.classList.toggle("dirty", this.dirty);
    node.classList.toggle("is-active", isActive);
    node.querySelector("[data-slot=meta]").title = new Date(plan.modifiedAt).toLocaleString();
    const stateBadge = node.querySelector("[data-slot=state-badge]");
    if (isBlocked) {
      stateBadge.textContent = "blocked";
      stateBadge.classList.add("warn");
      stateBadge.hidden = false;
    }
    node.querySelector("[data-slot=implementation]").hidden = !isActive;
    node.querySelector("[data-slot=progress-fill]").style.width = `${percentComplete}%`;
    node.querySelector("[data-slot=status-chips]").append(
      // readiness (draft/ready) only distinguishes actionable-vs-not within backlog; once a plan
      // is active it necessarily already cleared that bar, so the chip is redundant past backlog.
      ...(plan.lifecycle === "backlog"
        ? [chip(plan.readiness, plan.readiness === "ready" ? "ok" : "")]
        : []),
      chip(plan.reviewState, plan.reviewState === "possibly-stale" ? "warn" : ""),
    );
    if (!LIFECYCLES_WITHOUT_PRIORITY.has(plan.lifecycle)) {
      node.querySelector("[data-slot=priority]").append(renderPriorityDropdown(record, cardActions));
    }
    node.querySelector("[data-slot=chips]").append(
      warnings ? chip(`${warnings} warnings`, "warn") : chip("valid", "ok"),
    );
    node.querySelector("[data-slot=title-link]").textContent = plan.title;
    node.querySelector("[data-slot=actions]").append(
      actionButton("Copy path", () => cardActions.onCopyPath(plan.relativePath), onError),
      actionButton("Copy Context", () => cardActions.onCopyContext(record), onError),
      ...(cardActions.planDocsEnabled
        ? [actionButton("/plan-docs start", () => cardActions.onPlanDocsStart(record.key), onError)]
        : []),
    );
    // Whole card is the click surface now (not just title/description text). Clicks/keypresses
    // that land on an interactive widget — priority dropdown, action buttons — are ignored here
    // so they only do their own thing; everywhere else on the card opens the plan. tabindex+role
    // make the card itself keyboard-reachable now that title/description are plain text, not
    // buttons.
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    const isInteractiveTarget = (event) =>
      event.target.closest("button, option-dropdown, a, input, select, .status-section");
    node.addEventListener("click", (event) => {
      if (isInteractiveTarget(event)) return;
      cardActions.onOpen(record.key);
    });
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (isInteractiveTarget(event)) return;
      event.preventDefault();
      cardActions.onOpen(record.key);
    });
    this.replaceChildren(node);
  }
}

customElements.define("plan-card", PlanCardElement);

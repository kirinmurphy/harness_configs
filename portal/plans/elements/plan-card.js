// <plan-card> — set .record (plan record) and .actions (cardActions bag: onOpen, onCopyPath,
// onCopyContext, onPlanDocsStart, planDocsEnabled, onError) as properties right after creation,
// then append to the DOM. Title text is a link that triggers onOpen; builds the chip row and
// action-button row from the two properties.
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

  render() {
    const record = this._record;
    const cardActions = this._actions;
    const plan = record.plan;
    const warnings = plan.validation.warnings.length;
    const { onError } = cardActions;

    const { total, remaining } = plan.taskCounts;
    const complete = total - remaining;
    const percentComplete = total > 0 ? Math.round((complete / total) * 100) : 0;
    const state = plan.blockers.length ? "blocked" : plan.lifecycle;
    const isActive = state === "active";

    const node = fill(tpl("tpl-plan-card"), {
      description: truncate(plan.excerpt || "No description", EXCERPT_DISPLAY_LENGTH),
      "state-badge": state,
      meta: `modified ${formatRelativeTime(plan.modifiedAt)}`,
      "progress-label": total > 0 ? `${percentComplete}% (${complete}/${total} tasks)` : "no tasks",
      next: plan.nextAction || "No next action",
    });
    node.querySelector("[data-slot=meta]").title = new Date(plan.modifiedAt).toLocaleString();
    node.querySelector("[data-slot=state-badge]").classList.add(state === "blocked" ? "warn" : "ok");
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
    node.querySelector("[data-slot=chips]").append(
      chip(plan.priority, plan.priority === "high" ? "warn" : ""),
      warnings ? chip(`${warnings} warnings`, "warn") : chip("valid", "ok"),
    );
    const titleLink = node.querySelector("[data-slot=title-link]");
    titleLink.textContent = plan.title;
    titleLink.addEventListener("click", () => cardActions.onOpen(record.key));
    node.querySelector("[data-slot=actions]").append(
      actionButton("Copy path", () => cardActions.onCopyPath(plan.relativePath), onError),
      actionButton("Copy Context", () => cardActions.onCopyContext(record), onError),
      ...(cardActions.planDocsEnabled
        ? [actionButton("/plan-docs start", () => cardActions.onPlanDocsStart(record.key), onError)]
        : []),
    );
    this.replaceChildren(node);
  }
}

customElements.define("plan-card", PlanCardElement);

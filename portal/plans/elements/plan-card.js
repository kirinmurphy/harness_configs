// <plan-card> — set .record (plan record) and .actions (cardActions bag: onOpen, onCopyPath,
// onCopyContext, onPlanDocsStart, planDocsEnabled, onError) as properties right after creation,
// then append to the DOM. Builds its chip row and action-button row from those two properties.
import { portalTpl as tpl, portalFillSlots as fill } from "/portal/shared/api.js";

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString();
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
    this.replaceChildren(node);
  }
}

customElements.define("plan-card", PlanCardElement);

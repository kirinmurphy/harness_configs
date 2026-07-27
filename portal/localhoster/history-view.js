// History dialog: fetch and render an app's recorded transition events.
//
// Kept out of app.js, which is already long and owns the poll/reconcile loop. History is fetched
// only when the dialog opens — never on the 10s poll, since events change rarely and the read costs
// a file scan on the server.

import { portalFillSlots as fill, portalTpl as tpl } from "/portal/shared/api.js";
import { fetchHistory } from "./api.js";

const TYPE_LABELS = {
  firstSeen: "First seen",
  originChange: "Address changed",
  healthTransition: "Health changed",
  exposureChange: "Exposure changed",
  duplicateChange: "Duplicate ports changed",
  inactive: "Stopped",
};

export function createHistoryView({ onStale } = {}) {
  const dialog = document.getElementById("history-dialog");
  const body = document.getElementById("history-body");
  const subject = document.getElementById("history-subject");
  if (!dialog) return { open() {} };

  dialog.querySelector("[data-close]")?.addEventListener("click", () => dialog.close());

  return {
    async open(project, instance) {
      subject.textContent = `${project?.name || instance.app?.name || instance.title || "This app"} · ${instance.origin || "no origin"}`;
      body.replaceChildren(message("Loading…"));
      if (typeof dialog.showModal === "function") dialog.showModal();

      let result;
      try {
        result = await fetchHistory(instance.opaqueKey);
      } catch {
        body.replaceChildren(message("History is unavailable right now."));
        return;
      }

      // A 404 means the key went stale — the app's port changed since this snapshot was rendered.
      // The right response is to refresh the view, not to show the user an error.
      if (result?.ok === false) {
        dialog.close();
        onStale?.();
        return;
      }

      const events = result?.events || [];
      if (!events.length) {
        body.replaceChildren(message("No recorded events yet."));
        return;
      }
      body.replaceChildren(...events.map(historyRow));
    },
  };
}

export function historyRow(event) {
  return fill(tpl("tpl-history-row"), {
    when: relativeTime(event.at),
    type: TYPE_LABELS[event.type] || event.type,
    detail: detailText(event),
  });
}

function detailText(event) {
  const from = formatValue(event.from);
  const to = formatValue(event.to);
  const reason = event.reason ? ` (${event.reason.replace(/-/g, " ")})` : "";
  if (from && to) return `${from} → ${to}${reason}`;
  if (to) return `${to}${reason}`;
  if (from) return `was ${from}${reason}`;
  return reason.trim() || "—";
}

function formatValue(value) {
  if (value == null) return "";
  return typeof value === "number" ? String(value) : String(value);
}

function relativeTime(iso) {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function message(text) {
  const p = document.createElement("p");
  p.className = "no-links";
  p.textContent = text;
  return p;
}

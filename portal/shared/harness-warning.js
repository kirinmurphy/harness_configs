// Shared "install a supported harness" warning banner — the SAME banner the Agents (/config) page
// and the Tokens (/tokens) page render when no active harness is installed on this machine. Single
// source of truth for both the message text and the rendered <portal-notice> element; pages must
// not re-implement either.
//
// Relies on tpl-harness-warning from the shared widget-templates partial (injected into every page
// via {{WIDGET_TEMPLATES}}), so it works on any portal page without page-local markup.

import { activePresentedHarnesses, supportedHarnessNames } from "./harness-cohort.js";
import { portalTpl as tpl } from "./api.js";

// Message spec, for consumers that want the parts (e.g. a terminal printer). Null when the machine
// has at least one active harness — no banner in that case.
export function harnessWarningSpec(snap) {
  if (activePresentedHarnesses(snap).length > 0) return null;
  const supported = supportedHarnessNames(snap);
  const supportedList = supported ? ` (${supported})` : "";
  return {
    variant: "warning",
    title: "",
    body: `Install a supported harness ${supportedList} and run <b>roborepo harness refresh</b> to get started.`,
  };
}

// Ready-to-insert element for portal pages. Null when no banner is warranted.
export function harnessWarningElement(snap) {
  const spec = harnessWarningSpec(snap);
  if (!spec) return null;
  const panel = tpl("tpl-harness-warning");
  panel.setAttribute("variant", spec.variant);
  panel.querySelector("[data-slot=title]").textContent = spec.title;
  panel.querySelector("[data-slot=body]").innerHTML = spec.body;
  return panel;
}

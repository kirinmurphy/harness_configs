// All markup construction for the Config page. Every export takes plain data (plus callbacks for
// the handful of elements that need a listener) and returns a DOM node. Nothing here reads or
// writes app state directly, and nothing here imports the modal — app.js wires callbacks in.

import { portalTpl as tpl, portalFillSlots as fill } from "/portal/shared/api.js";
import { presentedHarnesses, supportedHarnessNames } from "/portal/shared/harness-cohort.js";
import {
  SECTION_TEMPLATE_ID,
  resolveDriftChip,
  harnessChipSpec,
  rulesChipSpec,
  tokenWarningEntries,
} from "./state.js";

// Applies a chip spec ({ tokens, level, detail, breakdown, legend }) to a <token-chip> element;
// hides the element when there is no spec (e.g. old snapshot without contextCost).
export function applyTokenChip(chipEl, spec) {
  if (!chipEl) return;
  if (!spec) {
    chipEl.hidden = true;
    return;
  }
  chipEl.hidden = false;
  chipEl.tokens = spec.tokens;
  chipEl.level = spec.level ?? null;
  chipEl.detail = spec.detail || null;
  chipEl.breakdown = spec.breakdown || [];
  chipEl.legend = spec.legend || null;
}

function applyWarningTokenChip(chipEl, spec) {
  if (!spec || !["medium", "high"].includes(spec.level)) {
    applyTokenChip(chipEl, null);
    return;
  }
  applyTokenChip(chipEl, spec);
}

// Builds a "Label: [chip]" pair for the popup cost row / row-level warning chips.
export function labeledTokenChip({ label, spec }) {
  const wrap = fill(tpl("tpl-labeled-token-chip"), { label: label + ":" });
  applyTokenChip(wrap.querySelector("[data-slot=chip]"), spec);
  return wrap;
}

function warningInfoIcon(info) {
  const wrap = fill(tpl("tpl-warning-info-icon"), { tip: info });
  const tip = wrap.querySelector("[data-slot=tip]");

  const show = () => {
    tip.hidden = false;
    wrap.setAttribute("aria-expanded", "true");
  };
  const hide = () => {
    tip.hidden = true;
    wrap.setAttribute("aria-expanded", "false");
  };
  wrap.addEventListener("mouseenter", show);
  wrap.addEventListener("mouseleave", hide);
  wrap.addEventListener("focus", show);
  wrap.addEventListener("blur", hide);
  wrap.addEventListener("click", () => (tip.hidden ? show() : hide()));
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
  return wrap;
}

function tokenWarningItem({ name, suffix, spec, info }) {
  const row = fill(tpl("tpl-token-warning-item"), { name, suffix: suffix || "" });
  if (info) row.querySelector("[data-slot=info]").append(warningInfoIcon(info));
  applyTokenChip(row.querySelector("[data-slot=chip]"), spec);
  return row;
}

function wireDefaultButton(btn, ruleKey, rulePath, label, rules, onDefaultClick) {
  btn.dataset.ruleKey = ruleKey;
  btn.dataset.rulePath = rulePath;
  btn.textContent = label;
  const entry = rules[ruleKey];
  btn.disabled = !entry?.html;
  btn.addEventListener("click", () => onDefaultClick(label, rulePath, entry));
}

export function modalDefaults(rules, harnesses, onDefaultClick) {
  const defaults = tpl("tpl-modal-defaults");
  for (const btn of defaults.querySelectorAll("[data-rule-key]")) {
    wireDefaultButton(btn, btn.dataset.ruleKey, btn.dataset.rulePath, btn.textContent.trim(), rules, onDefaultClick);
  }
  const slot = defaults.querySelector("[data-slot=\"per-harness\"]");
  for (const harness of harnesses || []) {
    const btn = tpl("tpl-modal-defaults-harness-button");
    wireDefaultButton(btn, harness.id, `globals/rules/${harness.id}`, `${harness.displayName} specifics`, rules, onDefaultClick);
    slot.append(btn);
  }
  return defaults;
}

function bucketControl({ current, compact, onSelect }) {
  const node = document.createElement("bucket-control");
  node.current = current;
  node.compact = !!compact;
  node.onSelect = onSelect;
  return node;
}

// Shows/hides a data-slot element by selector; when `show` is truthy and `text` is given, fills
// its textContent too. Centralizes the "conditional slot" idiom used across the behavior/
// arbitrary-command row templates, where several optional pieces (badges, notes, buttons) only
// appear when the item's data warrants them.
function toggleSlot(node, name, show, text) {
  const slot = node.querySelector(`[data-slot="${name}"]`);
  slot.hidden = !show;
  if (show && text != null) slot.textContent = text;
  return slot;
}

// One named behavior: label, a deny/ask/allow segmented control, and — only when the live value
// differs from the manifest default — a "custom" badge with a one-click revert. Confirms before
// moving OUT of deny (the "loosening" action), same reasoning the old profile selector used for
// switching to a looser profile.
export function behaviorRow(item, { onApplyBucket }) {
  const row = tpl("tpl-permission-row");
  const wrap = tpl("tpl-behavior-row");
  const err = wrap.querySelector('[data-slot="err"]');

  fill(wrap, { label: item.label });
  toggleSlot(wrap, "codex-only", item.codexOnly);
  toggleSlot(wrap, "description", item.description, item.description);
  toggleSlot(wrap, "no-codex-ask", item.noCodexAsk && !item.codexOnly);
  toggleSlot(wrap, "default-bucket", item.overridden, "default: " + item.defaultBucket);
  toggleSlot(wrap, "override-badge", item.overridden);
  const reset = toggleSlot(wrap, "reset", item.overridden);
  if (item.overridden) {
    reset.addEventListener("click", () => onApplyBucket({ behaviorId: item.id, bucket: "default" }, err));
  }

  wrap.querySelector('[data-slot="bucket-control"]').replaceWith(bucketControl({
    current: item.bucket,
    onSelect: async (b) => {
      if (item.bucket === "deny" && b !== "deny") {
        const ok = window.confirm(
          "Moving \"" + item.label + "\" out of deny loosens safety. Apply anyway?",
        );
        if (!ok) return;
      }
      await onApplyBucket({ behaviorId: item.id, bucket: b }, err);
    },
  }));

  fill(row, { content: wrap });
  return row;
}

// Arbitrary (non-named) commands: an editable list plus an "add command" input. Each row is the
// same bucket control as behaviorRow; "remove" reverts to default, which for a manifest-default
// command means falling back to its allow-by-default state, and for a purely personal addition
// means it stops being tracked at all.
function arbitraryItemRow(c, { onApplyBucket }) {
  const line = tpl("tpl-arbitrary-item");
  const err = line.querySelector('[data-slot="err"]');
  fill(line, { label: c.label });
  toggleSlot(line, "no-codex-ask", c.noCodexAsk);

  line.querySelector('[data-slot="bucket-control"]').replaceWith(bucketControl({
    current: c.bucket,
    compact: true,
    onSelect: async (b) => {
      if (c.bucket === "deny" && b !== "deny") {
        const ok = window.confirm("Moving \"" + c.label + "\" out of deny loosens safety. Apply anyway?");
        if (!ok) return;
      }
      await onApplyBucket({ tokens: c.label.split(" "), bucket: b }, err);
    },
  }));

  const reset = toggleSlot(line, "reset", c.overridden, c.defaultBucket ? "reset" : "remove");
  if (c.overridden) {
    reset.addEventListener("click", () => onApplyBucket({ tokens: c.label.split(" "), bucket: "default" }, err));
  }
  return line;
}

export function arbitraryListRow(item, { onApplyBucket }) {
  const row = tpl("tpl-permission-row");
  const wrap = tpl("tpl-arbitrary-list-row");
  fill(wrap, { label: item.label });
  toggleSlot(wrap, "description", item.description, item.description);

  const list = wrap.querySelector('[data-slot="items"]');
  list.replaceChildren(
    ...(item.items || []).map((c) => arbitraryItemRow(c, { onApplyBucket })),
  );

  const input = wrap.querySelector('[data-slot="input"]');
  const addErr = wrap.querySelector('[data-slot="add-err"]');
  wrap.querySelector('[data-slot="add-btn"]').addEventListener("click", async () => {
    const tokens = input.value.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return;
    const ok = await onApplyBucket({ tokens, bucket: "ask" }, addErr);
    if (ok) input.value = "";
  });

  fill(row, { content: wrap });
  return row;
}

export function permissionsSection(section, callbacks) {
  const panel = tpl("tpl-permissions-section");
  panel.querySelector('[data-slot="rows"]').replaceChildren(
    ...section.items.map((item) => permissionRow(item, callbacks)),
  );
  return panel;
}

function permissionRow(item, callbacks) {
  if (item.kind === "behavior") return behaviorRow(item, callbacks);
  if (item.kind === "arbitrary-list") return arbitraryListRow(item, callbacks);
  const row = tpl("tpl-permission-row");
  row.querySelector('[data-slot="content"]').remove();
  return row;
}

function configItemElement(item, actions) {
  const node = document.createElement("config-item");
  node.item = item;
  node.actions = actions;
  return node;
}

export function standardSection(section, { onInspectClick, onToggle, contextCost }) {
  const templateId = SECTION_TEMPLATE_ID[section.category];
  if (!templateId) return null;
  const panel = tpl(templateId);
  panel.classList.toggle("wide", !!section.wide);

  panel.querySelector('[data-slot="items"]').replaceChildren(
    ...section.items.map((item) => configItemElement(item, { onInspect: onInspectClick, onToggle, contextCost })),
  );
  return panel;
}

export function contextWarnings(snap) {
  const entries = tokenWarningEntries(snap);
  if (!entries.length) return null;
  const panel = tpl("tpl-context-warnings");
  const hasHigh = entries.some((entry) => entry.spec.level === "high");
  // <portal-notice> owns the callout chrome now; escalate to the alert (red) variant when any
  // element is in high token use, otherwise the default warning (amber) tint.
  panel.setAttribute("variant", hasHigh ? "alert" : "warning");
  panel.querySelector('[data-slot="title"]').textContent = hasHigh
    ? "The following elements have a high token use:"
    : "The following elements have elevated token use:";
  panel.querySelector('[data-slot="items"]').replaceChildren(...entries.map(tokenWarningItem));
  return panel;
}

function wireInspectButton(btn, kind, id, harness, label, onInspectClick) {
  btn.textContent = label;
  btn.addEventListener("click", () => onInspectClick({ kind, id, harness, label }));
}

function configUsageCell(harness, snap) {
  const cell = tpl("tpl-config-usage-cell");
  applyTokenChip(cell.querySelector("[data-slot=chip]"), harnessChipSpec(snap.contextCost, harness.id));
  return cell;
}

function configRulesCell(harness, snap, onInspectClick) {
  const cell = tpl("tpl-config-rules-cell");
  wireInspectButton(cell.querySelector("[data-slot=button]"), "live-rules", "agent-rules", harness.id, harness.rulesFile, onInspectClick);
  applyWarningTokenChip(cell.querySelector("[data-slot=chip]"), rulesChipSpec(snap.contextCost, harness.id));
  return cell;
}

function configConfigCell(harness, snap, onInspectClick) {
  const cell = tpl("tpl-config-config-cell");
  wireInspectButton(cell.querySelector("[data-slot=button]"), "config-file", `${harness.id}-settings`, undefined, harness.settingsFile, onInspectClick);
  const chip = cell.querySelector("[data-slot=drift]");
  const spec = resolveDriftChip(snap.rootConfig, harness.id);
  if (spec) {
    chip.hidden = false;
    chip.className = "drift-chip " + spec.cls;
    chip.textContent = spec.label;
    chip.title = spec.title;
  }
  return cell;
}

function configHooksCell(harness, onInspectClick) {
  const cell = tpl("tpl-config-hooks-cell");
  wireInspectButton(cell.querySelector("[data-slot=button]"), "harness-hooks", "hooks", harness.id, harness.hooksFile, onInspectClick);
  return cell;
}

// Names the supported providers from the registered catalog rather than a hardcoded list, so a
// newly registered provider appears here without a markup edit.
function configFilesEmpty(snap) {
  const panel = tpl("tpl-config-files-empty");
  const slot = panel.querySelector("[data-slot=supported]");
  if (slot) slot.textContent = supportedHarnessNames(snap);
  return panel;
}

export function configFiles(snap, { onInspectClick }) {
  const harnesses = presentedHarnesses(snap);
  if (harnesses.length === 0) return configFilesEmpty(snap);
  const panel = tpl("tpl-config-files");
  panel.querySelector(".config-grid").style.setProperty("--provider-count", harnesses.length);
  const head = panel.querySelector("[data-slot=head]");
  const rows = {
    usage: panel.querySelector("[data-slot=row-usage]"),
    rules: panel.querySelector("[data-slot=row-rules]"),
    config: panel.querySelector("[data-slot=row-config]"),
    hooks: panel.querySelector("[data-slot=row-hooks]"),
  };
  for (const harness of harnesses) {
    head.append(fill(tpl("tpl-config-header-cell"), { label: harness.displayName }));
    rows.usage.append(configUsageCell(harness, snap));
    rows.rules.append(configRulesCell(harness, snap, onInspectClick));
    rows.config.append(configConfigCell(harness, snap, onInspectClick));
    rows.hooks.append(configHooksCell(harness, onInspectClick));
  }
  return panel;
}

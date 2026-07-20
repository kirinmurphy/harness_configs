// All markup construction for the Config page. Every export takes plain data (plus callbacks for
// the handful of elements that need a listener) and returns a DOM node. Nothing here reads or
// writes app state directly, and nothing here imports the modal — app.js wires callbacks in.

import { portalTpl as tpl, portalFillSlots as fill } from "/portal/shared/api.js";
import {
  SECTION_TEMPLATE_ID,
  resolveDriftChip,
  harnessChipSpec,
  rulesChipSpec,
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

// Builds a "Label: [chip]" pair for the popup cost row / row-level warning chips.
export function labeledTokenChip({ label, spec }) {
  const wrap = document.createElement("span");
  wrap.className = "cost-row-item";
  const labelEl = document.createElement("span");
  labelEl.className = "cost-row-label";
  labelEl.textContent = label + ":";
  const chip = document.createElement("token-chip");
  applyTokenChip(chip, spec);
  wrap.append(labelEl, chip);
  return wrap;
}

export function modalDefaults(rules, onDefaultClick) {
  const defaults = tpl("tpl-modal-defaults");
  for (const btn of defaults.querySelectorAll("[data-rule-key]")) {
    const entry = rules[btn.dataset.ruleKey];
    btn.disabled = !entry?.html;
    btn.addEventListener("click", () =>
      onDefaultClick(btn.textContent, btn.dataset.rulePath, entry),
    );
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

// One-row summary bar: per-harness startup token chips with a contributing-amounts tooltip.
// One chip per harness — a chat runs in one harness, so no combined total is shown.
export function contextSummary(snap) {
  const cost = snap.contextCost;
  if (!cost) return null;
  const bar = tpl("tpl-context-summary");
  for (const chip of bar.querySelectorAll("[data-context-startup]")) {
    applyTokenChip(chip, harnessChipSpec(cost, chip.dataset.contextStartup));
  }
  return bar;
}

export function configFiles(snap, { onInspectClick }) {
  const panel = tpl("tpl-config-files");
  for (const chip of panel.querySelectorAll("[data-cost^=\"rules-\"]")) {
    applyTokenChip(chip, rulesChipSpec(snap.contextCost, chip.dataset.cost.slice("rules-".length)));
  }
  for (const btn of panel.querySelectorAll("[data-config-kind]")) {
    const kind = btn.dataset.configKind;
    const id = btn.dataset.configId;
    const harness = btn.dataset.configHarness;
    btn.addEventListener("click", () =>
      onInspectClick({ kind, id, harness, label: btn.textContent }),
    );
  }
  for (const chip of panel.querySelectorAll("[data-drift-harness]")) {
    const spec = resolveDriftChip(snap.rootConfig, chip.dataset.driftHarness);
    if (!spec) {
      chip.hidden = true;
      continue;
    }
    chip.hidden = false;
    chip.className = "drift-chip " + spec.cls;
    chip.textContent = spec.label;
    chip.title = spec.title;
  }
  return panel;
}

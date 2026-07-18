// All markup construction for the Config page. Every export takes plain data (plus callbacks for
// the handful of elements that need a listener) and returns a DOM node. Nothing here reads or
// writes app state directly, and nothing here imports the modal — app.js wires callbacks in.

import { portalEl as el, portalTpl as tpl, portalFillSlots as fill } from "/portal/shared/api.js";
import { SECTION_TEMPLATE_ID, resolveDriftChip } from "./state.js";

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

// One named behavior: label, a deny/ask/allow segmented control, and — only when the live value
// differs from the manifest default — a "custom" badge with a one-click revert. Confirms before
// moving OUT of deny (the "loosening" action), same reasoning the old profile selector used for
// switching to a looser profile.
export function behaviorRow(item, { onApplyBucket }) {
  const row = tpl("tpl-permission-row");
  const wrap = el("div", { class: "behavior-row" });
  const head = el("div", { class: "behavior-head" });
  const label = el("span", { class: "behavior-label" }, item.label);
  head.appendChild(label);
  if (item.codexOnly) head.appendChild(el("span", { class: "codex-note" }, "Codex only"));
  const err = el("div", { class: "item-err" });

  head.appendChild(bucketControl({
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

  if (item.overridden) {
    const badgeEl = el("span", { class: "override-badge" }, "⚡ custom");
    const reset = el("button", { class: "reset-link" }, "reset");
    reset.type = "button";
    reset.addEventListener("click", () => onApplyBucket({ behaviorId: item.id, bucket: "default" }, err));
    head.appendChild(badgeEl);
    head.appendChild(reset);
  }
  wrap.appendChild(head);
  if (item.description) wrap.appendChild(el("div", { class: "behavior-desc" }, item.description));
  if (item.overridden) wrap.appendChild(el("div", { class: "behavior-default" }, "default: " + item.defaultBucket));
  if (item.noCodexAsk && !item.codexOnly) {
    wrap.appendChild(el("div", { class: "codex-note" }, "Codex has no per-command ask — runs without a prompt there unless another setting forces approval."));
  }
  wrap.appendChild(err);

  fill(row, { content: wrap });
  return row;
}

// Arbitrary (non-named) commands: an editable list plus an "add command" input. Each row is the
// same bucket control as behaviorRow; "remove" reverts to default, which for a manifest-default
// command means falling back to its allow-by-default state, and for a purely personal addition
// means it stops being tracked at all.
export function arbitraryListRow(item, { onApplyBucket }) {
  const row = tpl("tpl-permission-row");
  const wrap = el("div", { class: "arbitrary-list" });
  wrap.appendChild(el("div", { class: "arbitrary-head" }, item.label));
  if (item.description) wrap.appendChild(el("div", { class: "arbitrary-desc" }, item.description));

  const list = el("div", { class: "arbitrary-items" });
  const renderItems = () => {
    list.replaceChildren(
      ...(item.items || []).map((c) => {
        const line = el("div", { class: "arbitrary-item" });
        line.appendChild(el("span", { class: "arbitrary-label" }, c.label));
        const err = el("span", { class: "item-err" });
        line.appendChild(bucketControl({
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
        if (c.overridden) {
          const remove = el("button", { class: "reset-link" }, c.defaultBucket ? "reset" : "remove");
          remove.type = "button";
          remove.addEventListener("click", () => onApplyBucket({ tokens: c.label.split(" "), bucket: "default" }, err));
          line.appendChild(remove);
        }
        if (c.noCodexAsk) line.appendChild(el("span", { class: "codex-note" }, "no per-command ask on Codex"));
        line.appendChild(err);
        return line;
      }),
    );
  };
  renderItems();
  wrap.appendChild(list);

  const addRow = el("div", { class: "arbitrary-add" });
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "add a command, e.g. docker run";
  input.className = "arbitrary-input";
  const addBtn = el("button", { class: "arbitrary-add-btn" }, "add as ask");
  addBtn.type = "button";
  const addErr = el("span", { class: "item-err" });
  addBtn.addEventListener("click", async () => {
    const tokens = input.value.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return;
    const ok = await onApplyBucket({ tokens, bucket: "ask" }, addErr);
    if (ok) input.value = "";
  });
  addRow.appendChild(input);
  addRow.appendChild(addBtn);
  addRow.appendChild(addErr);
  wrap.appendChild(addRow);

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

export function standardSection(section, { onInspectClick, onToggle }) {
  const templateId = SECTION_TEMPLATE_ID[section.category];
  if (!templateId) return null;
  const panel = tpl(templateId);
  panel.classList.toggle("wide", !!section.wide);

  panel.querySelector('[data-slot="items"]').replaceChildren(
    ...section.items.map((item) => configItemElement(item, { onInspect: onInspectClick, onToggle })),
  );
  return panel;
}

export function configFiles(snap, { onInspectClick }) {
  const panel = tpl("tpl-config-files");
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

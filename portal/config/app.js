// --------------------------------------------------------------------------- behavior view
//
// The user-facing section model is computed ONCE, server-side, in buildBehaviorView() (config.mjs)
// and shipped in the snapshot as snap.behaviorView. The client renders it directly — there is no
// client-side reimplementation to drift from the server. Items carry web fields (toggle, inspect,
// urls, badges) and terminal fields (hint); each renderer reads what it needs.

import { portalEl as el, portalGetJson, portalPostJson, portalSetUpdatedAt, portalHideLoading, portalTpl as tpl } from "/portal/shared/api.js";

// --------------------------------------------------------------------------- render helpers

function slot(root, name) {
  return root.querySelector(`[data-slot="${name}"]`);
}

function setOptionalText(node, value) {
  node.textContent = value || "";
  node.hidden = !value;
}

function dot(on) {
  return el("span", { class: "dot " + (on ? "on" : "off") });
}

function badge(text) {
  const isCmd = text.startsWith("/");
  return el("span", { class: "badge " + (isCmd ? "badge-cmd" : "badge-skill") }, text);
}

function setModalContent(data) {
  const node = document.getElementById("modal-content");
  if (data?.html) {
    node.innerHTML = data.html;
  } else {
    node.textContent = data?.content || "(empty)";
  }
}

function clearModalDefaults() {
  const footer = document.getElementById("modal-footer");
  footer.hidden = true;
  footer.replaceChildren();
}

function attachModalDefaults() {
  const footer = document.getElementById("modal-footer");
  const rules = lastSnapshot?.globals?.rules || {};
  const defaults = tpl("tpl-modal-defaults");
  for (const btn of defaults.querySelectorAll("[data-rule-key]")) {
    const entry = rules[btn.dataset.ruleKey];
    btn.disabled = !entry?.html;
    btn.addEventListener("click", () =>
      openSnapshotModal(btn.textContent, btn.dataset.rulePath, entry),
    );
  }
  footer.replaceChildren(defaults);
  footer.hidden = false;
}

// ---- source-inspect modal: fetch the full file that DEFINES a tool and show it in a popup. ----
function closeModal() {
  document.getElementById("modal").classList.remove("open");
}
async function openSourceModal(inspect) {
  const backdrop = document.getElementById("modal");
  document.getElementById("modal-title").textContent =
    inspect.label || inspect.id;
  document.getElementById("modal-path").textContent = "loading…";
  document.getElementById("modal-content").innerHTML = "";
  clearModalDefaults();
  backdrop.classList.add("open");
  try {
    const qs = new URLSearchParams({ kind: inspect.kind, id: inspect.id });
    if (inspect.harness) qs.set("harness", inspect.harness);
    const data = await fetch("/api/config/source?" + qs.toString()).then((r) =>
      r.json(),
    );
    if (!data.ok) {
      document.getElementById("modal-path").textContent = "";
      document.getElementById("modal-content").textContent =
        "error: " + (data.error || "failed to load");
      return;
    }
    document.getElementById("modal-title").textContent =
      data.title || inspect.label;
    document.getElementById("modal-path").textContent = data.path || "";
    setModalContent(data);
    if (inspect.kind === "live-rules") attachModalDefaults();
  } catch (e) {
    document.getElementById("modal-path").textContent = "";
    document.getElementById("modal-content").textContent =
      "error: " + e.message;
  }
}

function openSnapshotModal(title, pathText, data) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-path").textContent = pathText || "";
  setModalContent(data);
  clearModalDefaults();
  document.getElementById("modal").classList.add("open");
}
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

const TOGGLE_ENDPOINT = {
  package: "/api/config/packages",
  skill: "/api/config/skills",
};
const SECTION_TEMPLATE_ID = {
  "Token Optimization": "tpl-section-token-optimization",
  Commands: "tpl-section-commands",
  "Code Conventions": "tpl-section-code-conventions",
  "Chat-Time Output": "tpl-section-chat-time-output",
};

// One switch per mutable item. Optimistic-disable while the POST is in flight; on success the
// poll re-render (driven by the returned snapshot, applied immediately) reflects the new state.
function toggleSwitch(item, statusSlot) {
  const wrap = tpl("tpl-toggle");
  const input = wrap.querySelector("input");
  input.checked = !!item.active;
  input.setAttribute("aria-label", item.label);

  input.addEventListener("change", async () => {
    const enabled = input.checked;
    input.disabled = true;
    statusSlot.className = "item-status";
    statusSlot.textContent = "applying…";
    try {
      const data = await portalPostJson(TOGGLE_ENDPOINT[item.toggle], { id: item.id, enabled });
      statusSlot.textContent = "saved";
      if (data.config) applySnapshot(data.config); // re-render from the authoritative post-mutation snapshot
    } catch (e) {
      input.checked = !enabled; // revert
      statusSlot.className = "item-status error";
      statusSlot.textContent = e.message;
    } finally {
      input.disabled = false;
    }
  });
  return wrap;
}

const BUCKETS = ["deny", "ask", "allow"];

// POST a bucket change for either a named behavior (behaviorId) or an arbitrary command
// (tokens), re-rendering from the returned snapshot on success. Shared by behaviorRow and the
// arbitrary-command list so both paths hit the exact same endpoint contract.
async function applyBucket(payload, errSlot) {
  errSlot.textContent = "";
  try {
    const data = await portalPostJson("/api/config/permissions", payload);
    if (data.config) applySnapshot(data.config);
    return true;
  } catch (e) {
    errSlot.textContent = e.message;
    return false;
  }
}

// One named behavior: label, a deny/ask/allow segmented control, and — only when the live value
// differs from the manifest default — a "custom" badge with a one-click revert. Confirms before
// moving OUT of deny (the "loosening" action), same reasoning the old profile selector used for
// switching to a looser profile.
function behaviorRow(item) {
  const row = tpl("tpl-permission-row");
  const wrap = el("div", { class: "behavior-row" });
  const head = el("div", { class: "behavior-head" });
  const label = el("span", { class: "behavior-label" }, item.label);
  head.appendChild(label);
  if (item.codexOnly) head.appendChild(el("span", { class: "codex-note" }, "Codex only"));
  const err = el("div", { class: "item-err" });

  const buckets = el("div", { class: "bucket-group" });
  for (const b of BUCKETS) {
    const btn = el("button", { class: "bucket-btn bucket-" + b }, b);
    btn.type = "button";
    btn.classList.toggle("current", b === item.bucket);
    btn.disabled = b === item.bucket;
    btn.addEventListener("click", async () => {
      if (item.bucket === "deny" && b !== "deny") {
        const ok = window.confirm(
          "Moving \"" + item.label + "\" out of deny loosens safety. Apply anyway?",
        );
        if (!ok) return;
      }
      await applyBucket({ behaviorId: item.id, bucket: b }, err);
    });
    buckets.appendChild(btn);
  }
  head.appendChild(buckets);

  if (item.overridden) {
    const badge = el("span", { class: "override-badge" }, "⚡ custom");
    const reset = el("button", { class: "reset-link" }, "reset");
    reset.type = "button";
    reset.addEventListener("click", () => applyBucket({ behaviorId: item.id, bucket: "default" }, err));
    head.appendChild(badge);
    head.appendChild(reset);
  }
  wrap.appendChild(head);
  if (item.description) wrap.appendChild(el("div", { class: "behavior-desc" }, item.description));
  if (item.overridden) wrap.appendChild(el("div", { class: "behavior-default" }, "default: " + item.defaultBucket));
  if (item.noCodexAsk && !item.codexOnly) {
    wrap.appendChild(el("div", { class: "codex-note" }, "Codex has no per-command ask — runs without a prompt there unless another setting forces approval."));
  }
  wrap.appendChild(err);

  const content = slot(row, "content");
  content.replaceWith(wrap);
  return row;
}

// Arbitrary (non-named) commands: an editable list plus an "add command" input. Each row is the
// same bucket control as behaviorRow; "remove" reverts to default, which for a manifest-default
// command means falling back to its allow-by-default state, and for a purely personal addition
// means it stops being tracked at all.
function arbitraryListRow(item) {
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
        const buckets = el("div", { class: "bucket-group bucket-group-compact" });
        for (const b of BUCKETS) {
          const btn = el("button", { class: "bucket-btn bucket-" + b }, b);
          btn.type = "button";
          btn.classList.toggle("current", b === c.bucket);
          btn.disabled = b === c.bucket;
          btn.addEventListener("click", async () => {
            if (c.bucket === "deny" && b !== "deny") {
              const ok = window.confirm("Moving \"" + c.label + "\" out of deny loosens safety. Apply anyway?");
              if (!ok) return;
            }
            await applyBucket({ tokens: c.label.split(" "), bucket: b }, err);
          });
          buckets.appendChild(btn);
        }
        line.appendChild(buckets);
        if (c.overridden) {
          const remove = el("button", { class: "reset-link" }, c.defaultBucket ? "reset" : "remove");
          remove.type = "button";
          remove.addEventListener("click", () => applyBucket({ tokens: c.label.split(" "), bucket: "default" }, err));
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
    const ok = await applyBucket({ tokens, bucket: "ask" }, addErr);
    if (ok) input.value = "";
  });
  addRow.appendChild(input);
  addRow.appendChild(addBtn);
  addRow.appendChild(addErr);
  wrap.appendChild(addRow);

  const content = slot(row, "content");
  content.replaceWith(wrap);
  return row;
}

// --------------------------------------------------------------------------- section renderers

function renderPermissionsSection(section) {
  const panel = tpl("tpl-permissions-section");
  slot(panel, "rows").replaceChildren(
    ...section.items.map((item) => permissionRow(item)),
  );
  return panel;
}

function permissionRow(item) {
  if (item.kind === "behavior") return behaviorRow(item);
  if (item.kind === "arbitrary-list") return arbitraryListRow(item);
  const row = tpl("tpl-permission-row");
  slot(row, "content").remove();
  return row;
}

function renderStandardSection(section) {
  const templateId = SECTION_TEMPLATE_ID[section.category];
  if (!templateId) return null;
  const panel = tpl(templateId);
  panel.classList.toggle("wide", !!section.wide);

  const itemRows = [];
  for (const item of section.items) {
    const row = tpl("tpl-config-item");
    slot(row, "dot").replaceWith(dot(item.active));
    // Inspectable items (skills/commands/chat-time rules) get a clickable label that opens the
    // source popup. The label still reflects active/dim state.
    const labelCls =
      "item-label" +
      (item.active ? "" : " dim") +
      (item.inspect ? " clickable" : "");
    const labelEl = slot(row, "label");
    labelEl.className = labelCls;
    labelEl.textContent = item.label;
    if (item.inspect) {
      labelEl.title = "view source";
      labelEl.addEventListener("click", () => openSourceModal(item.inspect));
    }
    // Info URL (GitHub / docs / PyPI): a single inline icon on the label row, opening the FIRST
    // urls[] entry. Items with more than one URL only expose that first one via the portal — any
    // additional related links must be reachable from that page instead (e.g. its README).
    if (item.urls && item.urls.length) {
      const link = el("a", { class: "item-link-icon", title: item.urls[0].url }, "↗");
      link.href = item.urls[0].url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      slot(row, "label").insertAdjacentElement("afterend", link);
    }
    slot(row, "badges").replaceChildren(
      ...(item.badges || []).map((b) => badge(b)),
    );
    setOptionalText(slot(row, "description"), item.description);
    setOptionalText(slot(row, "hint"), item.hint);
    const errSlot = slot(row, "status");
    const toggleSlot = slot(row, "toggle");
    if (item.toggle) toggleSlot.replaceWith(toggleSwitch(item, errSlot));
    else toggleSlot.remove();
    itemRows.push(row);
  }
  slot(panel, "items").replaceChildren(...itemRows);
  return panel;
}

function renderSection(section) {
  if (section.kind === "permissions") return renderPermissionsSection(section);
  return renderStandardSection(section);
}

// Root-config drift chip shown beside settings.json / config.toml. Driven by snap.rootConfig, which
// the server computes once (buildRootConfigView in config.mjs) so terminal and web agree. "in-sync"
// and "not-installed" are the quiet default — no chip — so the chip only appears when there is
// something the user might want to act on (drift, a staged update, or an untracked file).
const DRIFT_CHIP = {
  drifted: { label: "drifted", cls: "drift-warn", title: "Changed since roborepo's last write. Run `roborepo update` to reconcile." },
  "staged-pending": { label: "update staged", cls: "drift-info", title: "A new baseline is staged beside this file, waiting for you to reconcile it." },
  unwritten: { label: "untracked", cls: "drift-muted", title: "No recorded roborepo write yet (pre-dates drift tracking, or not installed via roborepo)." },
};

function renderConfigFiles(snap) {
  const panel = tpl("tpl-config-files");
  for (const btn of panel.querySelectorAll("[data-config-kind]")) {
    const kind = btn.dataset.configKind;
    const id = btn.dataset.configId;
    const harness = btn.dataset.configHarness;
    btn.addEventListener("click", () =>
      openSourceModal({ kind, id, harness, label: btn.textContent }),
    );
  }
  const driftByHarness = new Map((snap.rootConfig || []).map((r) => [r.harness, r]));
  for (const chip of panel.querySelectorAll("[data-drift-harness]")) {
    const row = driftByHarness.get(chip.dataset.driftHarness);
    const spec = row && DRIFT_CHIP[row.state];
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

function render(snap) {
  const main = document.getElementById("main");
  // Section model comes straight from the server snapshot (buildBehaviorView), no client fork.
  const view = snap.behaviorView || [];
  main.replaceChildren(
    renderConfigFiles(snap),
    ...view.map((section) => renderSection(section)).filter(Boolean),
  );
}

// --------------------------------------------------------------------------- poll

let last = null;
let lastSnapshot = null;
function applySnapshot(snap) {
  lastSnapshot = snap;
  const sig = JSON.stringify(snap);
  if (sig !== last) {
    last = sig;
    render(snap);
  }
  portalSetUpdatedAt();
}
async function load() {
  try {
    applySnapshot(await portalGetJson("/api/config"));
  } catch (e) {
    console.error(e);
  } finally {
    portalHideLoading();
  }
}

const POLL_INTERVAL_MS = 10000;

load();
setInterval(load, POLL_INTERVAL_MS);
// Theme toggle + nav live in the shared /portal/shared/theme.js. The config page has no
// canvas to redraw, so it needs no "roborepo:themechange" listener.

// --------------------------------------------------------------------------- behavior view
//
// The user-facing section model is computed ONCE, server-side, in buildBehaviorView() (config.mjs)
// and shipped in the snapshot as snap.behaviorView. The client renders it directly — there is no
// client-side reimplementation to drift from the server. Items carry web fields (toggle, inspect,
// urls, badges) and terminal fields (hint); each renderer reads what it needs.

// --------------------------------------------------------------------------- render helpers

function el(tag, cls, ...children) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}

function tpl(id) {
  return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

function slot(root, name) {
  return root.querySelector(`[data-slot="${name}"]`);
}

function setOptionalText(node, value) {
  node.textContent = value || "";
  node.hidden = !value;
}

function textFromTemplate(id, text, cls) {
  const node = tpl(id);
  if (cls) node.className = cls;
  node.textContent = text;
  return node;
}

function dot(on) {
  return el("span", "dot " + (on ? "on" : "off"));
}

function badge(text) {
  const isCmd = text.startsWith("/");
  return el("span", "badge " + (isCmd ? "badge-cmd" : "badge-skill"), text);
}

function setModalContent(data) {
  const node = document.getElementById("modal-content");
  if (data?.html) {
    node.innerHTML = data.html;
  } else {
    node.textContent = data?.content || "(empty)";
  }
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
    document.getElementById("status").textContent =
      "applying " + item.label + "…";
    try {
      const res = await fetch(TOGGLE_ENDPOINT[item.toggle], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, enabled }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        input.checked = !enabled; // revert
        statusSlot.className = "item-status error";
        statusSlot.textContent = data.error || data.message || "failed";
        document.getElementById("status").textContent =
          "error: " + statusSlot.textContent;
      } else if (data.config) {
        statusSlot.textContent = "saved";
        applySnapshot(data.config); // re-render from the authoritative post-mutation snapshot
        document.getElementById("status").textContent =
          "saved " + item.label + " " + new Date().toLocaleTimeString();
      } else {
        statusSlot.textContent = "saved";
        document.getElementById("status").textContent =
          "saved " + item.label + " " + new Date().toLocaleTimeString();
      }
    } catch (e) {
      input.checked = !enabled;
      statusSlot.className = "item-status error";
      statusSlot.textContent = e.message;
      document.getElementById("status").textContent = "error: " + e.message;
    } finally {
      input.disabled = false;
    }
  });
  return wrap;
}

// Permission profile selector with a Global / This-project scope switch. Project scope writes the
// current repo's .claude/.codex (a per-project override of the global default — last-wins, not
// merged). Looser profiles (workspace / networked) require an explicit confirm; the server enforces
// the same rule (409 needsConfirm) so it holds even if the client is bypassed.
function profileSelector(item) {
  const box = tpl("tpl-profile-selector");
  let scope = "global"; // which scope the buttons currently target

  slot(box, "global-profile").textContent = item.globalProfile || "—";
  slot(box, "no-project-profile").hidden = !!item.projectProfile;
  slot(box, "project-profile").hidden = !item.projectProfile;
  slot(box, "project-profile-value").textContent = item.projectProfile || "";

  const scopeButtons = [...box.querySelectorAll("[data-scope]")];
  const choices = slot(box, "choices");
  const err = slot(box, "error");
  for (const btn of scopeButtons) {
    btn.addEventListener("click", () => {
      scope = btn.dataset.scope;
      rerender();
    });
  }

  function currentFor(sc) {
    return sc === "project" ? item.projectProfile : item.globalProfile;
  }

  async function apply(profile, looser) {
    if (looser) {
      const ok = window.confirm(
        "Switching " +
          scope +
          " to '" +
          profile +
          "' loosens safety:\\n\\n" +
          (profile === "workspace"
            ? "the agent stops asking before blocked actions."
            : profile === "networked"
              ? "the agent's sandbox gets internet access."
              : "") +
          "\\nApply anyway?",
      );
      if (!ok) return;
    }
    err.textContent = "";
    try {
      const res = await fetch("/api/config/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, confirmedLooser: looser, scope }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        err.textContent = data.error || data.message || "failed";
        return;
      }
      if (data.config) applySnapshot(data.config);
    } catch (e) {
      err.textContent = e.message;
    }
  }

  function rerender() {
    for (const btn of scopeButtons) {
      btn.classList.toggle("on", btn.dataset.scope === scope);
    }
    const cur = currentFor(scope);
    choices.replaceChildren(
      ...(item.options || []).map((opt) => {
        const isCur = opt.id === cur;
        const btn = tpl("tpl-profile-choice");
        btn.classList.toggle("current", isCur);
        btn.classList.toggle("looser", !!opt.looser);
        btn.textContent = opt.id + (opt.looser ? " ⚠" : "");
        btn.title = opt.description || "";
        btn.disabled = isCur;
        btn.addEventListener("click", () => apply(opt.id, opt.looser));
        return btn;
      }),
    );
  }

  rerender();
  return box;
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
  const row = tpl("tpl-permission-row");
  const content = slot(row, "content");

  if (item.kind === "profile") {
    content.replaceWith(profileSelector(item));
    return row;
  }
  if (item.kind === "info") {
    const info = tpl("tpl-permission-info");
    slot(info, "label").textContent = item.label;
    setOptionalText(slot(info, "value"), item.value);
    content.replaceWith(info);
    return row;
  }
  if (item.kind === "expandable") {
    const expandable = tpl("tpl-permission-expandable");
    const list = slot(expandable, "detail");
    const btn = expandable.querySelector(".expand-btn");
    slot(expandable, "label").textContent = item.label;
    list.replaceChildren(
      ...(item.detail || []).map((d) => textFromTemplate("tpl-list-item", d)),
    );
    const closedLabel = btn.querySelector('[data-expand-label="closed"]');
    const openLabel = btn.querySelector('[data-expand-label="open"]');
    btn.addEventListener("click", () => {
      const open = list.classList.toggle("open");
      closedLabel.hidden = open;
      openLabel.hidden = !open;
    });
    content.replaceWith(expandable);
    return row;
  }
  content.remove();
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
    slot(row, "badges").replaceChildren(
      ...(item.badges || []).map((b) => badge(b)),
    );
    setOptionalText(slot(row, "description"), item.description);
    setOptionalText(slot(row, "hint"), item.hint);
    // Info URLs (GitHub / docs / PyPI) as inline links.
    const urlRow = slot(row, "urls");
    if (item.urls && item.urls.length) {
      urlRow.replaceChildren(
        ...item.urls.map((u) => {
          const a = el("a", "url-link", u.url);
          a.href = u.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          return a;
        }),
      );
    } else {
      urlRow.hidden = true;
    }
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

// Globals: harness-agnostic rules plus live Claude/Codex rules. Shown first so the baseline every
// harness gets is visible before the per-feature toggles.
function renderGlobals(snap) {
  const g = snap.globals || {};
  const rules = g.rules || {};
  const liveRules = g.liveRules || {};
  const panel = tpl("tpl-globals");
  const installed = [
    ["codex", liveRules.codex],
    ["claude", liveRules.claude],
  ].filter(([, v]) => v?.installed);
  const available = installed.map(([key]) => key);
  const bothInstalled = available.length > 1;
  let selected =
    selectedLiveHarness && available.includes(selectedLiveHarness)
      ? selectedLiveHarness
      : null;

  const switchRow = panel.querySelector(".globals-switches");
  const liveMissing = slot(panel, "live-missing");
  const liveInstalled = slot(panel, "live-installed");
  const livePath = slot(panel, "live-path");
  const fileBody = slot(panel, "live-body");

  function paintLive() {
    const live = selected ? liveRules[selected] : null;
    liveMissing.hidden = !!live?.installed;
    liveInstalled.hidden = !live?.installed;
    if (!live?.installed) {
      fileBody.replaceChildren(tpl("tpl-md-missing"));
    } else {
      livePath.textContent = live.path;
      if (live.html) fileBody.innerHTML = live.html;
      else fileBody.replaceChildren(tpl("tpl-md-empty"));
    }
    if (bothInstalled) {
      for (const btn of switchRow.children)
        btn.classList.toggle("on", btn.dataset.key === selected);
    }
  }

  if (bothInstalled) {
    for (const btn of switchRow.querySelectorAll("[data-key]")) {
      btn.addEventListener("click", () => {
        selectedLiveHarness = btn.dataset.key;
        render(lastSnapshot);
      });
    }
  } else {
    switchRow.remove();
  }
  paintLive();

  for (const btn of panel.querySelectorAll("[data-rule-key]")) {
    const entry = rules[btn.dataset.ruleKey];
    btn.disabled = !entry?.html;
    btn.addEventListener("click", () =>
      openSnapshotModal(btn.textContent, btn.dataset.rulePath, entry),
    );
  }

  return panel;
}

function renderHooks() {
  const panel = tpl("tpl-hooks");
  for (const btn of panel.querySelectorAll("[data-hook-harness]")) {
    const harness = btn.dataset.hookHarness;
    btn.addEventListener("click", () =>
      openSourceModal({
        kind: "harness-hooks",
        id: "hooks",
        harness,
        label: btn.textContent,
      }),
    );
  }
  return panel;
}

function render(snap) {
  const main = document.getElementById("main");
  // Section model comes straight from the server snapshot (buildBehaviorView), no client fork.
  const view = snap.behaviorView || [];
  main.replaceChildren(
    renderGlobals(snap),
    renderHooks(),
    ...view.map((section) => renderSection(section)).filter(Boolean),
  );
}

// --------------------------------------------------------------------------- poll

let last = null;
let lastSnapshot = null;
let selectedLiveHarness = null;
function applySnapshot(snap) {
  lastSnapshot = snap;
  const sig = JSON.stringify(snap);
  if (sig !== last) {
    last = sig;
    render(snap);
  }
  document.getElementById("status").textContent =
    "updated " + new Date().toLocaleTimeString();
}
async function load() {
  try {
    applySnapshot(await fetch("/api/config").then((r) => r.json()));
  } catch (e) {
    document.getElementById("status").textContent = "error: " + e.message;
  }
}

load();
setInterval(load, 10000);

// Config state dashboard. Organized by user-facing behavior (matching README § Global Behavior),
// not by internal technical categories (packages / bundles). Zero dependencies, dark theme.

export function configHtml() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>roborepo config</title>
<style>
  :root { color-scheme: dark; --bg:#0e1116; --panel:#161b22; --line:#2d333b; --ink:#c9d1d9; --dim:#8b949e; --accent:#58a6ff; --ok:#3fb950; --off:#484f58; --warn:#e3b341; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--bg); color:var(--ink); }
  header { padding:14px 20px; border-bottom:1px solid var(--line); display:flex; gap:20px; align-items:center; }
  header h1 { font-size:15px; margin:0; font-weight:600; }
  nav { display:flex; gap:2px; margin-left:auto; }
  nav a { color:var(--dim); font-size:12px; text-decoration:none; padding:3px 10px; border-radius:5px; border:1px solid transparent; }
  nav a:hover { color:var(--ink); border-color:var(--line); }
  nav a.active { color:var(--ink); background:var(--panel); border-color:var(--line); }
  #status { color:var(--dim); font-size:11px; }
  main { padding:20px; display:grid; gap:16px; max-width:960px; grid-template-columns:1fr; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:16px; }
  .panel.wide { grid-column:1/-1; }
  .panel-head { margin:0 0 4px; }
  .panel-head h2 { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); margin:0; font-weight:600; display:inline; }
  .panel-desc { font-size:11px; color:var(--off); margin:0 0 12px; }
  .item { display:flex; align-items:flex-start; gap:10px; padding:8px 0; border-top:1px solid var(--line); }
  .item:first-of-type { border-top:none; }
  .dot { flex:none; width:8px; height:8px; border-radius:50%; margin-top:6px; }
  .dot.on { background:var(--ok); }
  .dot.off { background:var(--off); }
  .item-body { min-width:0; flex:1; }
  .item-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .item-label { color:var(--ink); font-size:13px; line-height:1.4; }
  .item-label.dim { color:var(--dim); }
  .item-desc { color:var(--dim); font-size:11px; margin-top:2px; line-height:1.4; }
  .item-hint { color:var(--accent); font-size:11px; margin-top:3px; }
  .item-status { color:var(--ok); font-size:11px; margin-top:3px; }
  .item-status.error { color:#f85149; }
  .item-status:empty { display:none; }
  /* badges */
  .badge { display:inline-block; font-size:10px; padding:1px 5px; border-radius:3px; border:1px solid; line-height:1.4; white-space:nowrap; }
  .badge-skill { color:#79c0ff; border-color:#1f6feb; background:#0d1b2e; }
  .badge-cmd  { color:#7ee787; border-color:#238636; background:#0d2214; }
  /* toggle switch */
  .switch { flex:none; position:relative; display:inline-flex; align-items:center; cursor:pointer; margin-top:2px; }
  .switch input { position:absolute; opacity:0; width:0; height:0; }
  .switch-track { width:34px; height:18px; border-radius:9px; background:var(--off); transition:background .15s; display:inline-block; }
  .switch-knob { position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:#fff; transition:transform .15s; }
  .switch input:checked + .switch-track { background:var(--ok); }
  .switch input:checked + .switch-track .switch-knob { transform:translateX(16px); }
  .switch input:disabled + .switch-track { opacity:.5; }
  .item-err { color:#f85149; font-size:11px; margin-top:3px; }
  .item-err:empty { display:none; }
  /* permission profile selector */
  .profile-box { width:100%; }
  .profile-choices { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
  .profile-btn { font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--bg); border:1px solid var(--line); color:var(--ink); padding:4px 10px; border-radius:5px; cursor:pointer; }
  .profile-btn:hover:not(:disabled) { border-color:var(--accent); color:var(--accent); }
  .profile-btn.current { border-color:var(--ok); color:var(--ok); cursor:default; }
  .profile-btn.looser { color:var(--warn); border-color:#5a4a1a; }
  .profile-btn.looser:hover:not(:disabled) { border-color:var(--warn); }
  .profile-btn:disabled { opacity:.7; }
  .scope-row { display:flex; gap:0; margin-top:8px; }
  .scope-btn { font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--bg); border:1px solid var(--line); color:var(--dim); padding:3px 12px; cursor:pointer; }
  .scope-btn:first-child { border-radius:5px 0 0 5px; }
  .scope-btn:last-child { border-radius:0 5px 5px 0; border-left:none; }
  .scope-btn.on { background:var(--panel); color:var(--accent); border-color:var(--accent); }
  /* permissions section */
  .perm-row { padding:8px 0; border-top:1px solid var(--line); font-size:12px; }
  .perm-row:first-of-type { border-top:none; }
  .perm-profile { display:flex; align-items:baseline; gap:10px; }
  .perm-name { color:var(--ink); font-weight:600; }
  .perm-desc { color:var(--dim); }
  .perm-label { color:var(--dim); font-size:11px; margin-bottom:4px; }
  .perm-value { color:var(--ink); }
  .expand-btn { font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace; background:none; border:1px solid var(--line); color:var(--dim); padding:2px 7px; border-radius:4px; cursor:pointer; margin-top:4px; }
  .expand-btn:hover { color:var(--ink); border-color:var(--dim); }
  .expand-list { display:none; margin-top:6px; column-count:2; column-gap:16px; font-size:11px; color:var(--dim); }
  .expand-list.open { display:block; }
  .expand-list li { list-style:none; padding:1px 0; }
  .panel-footnote { font-size:11px; color:var(--off); margin:10px 0 0; border-top:1px solid var(--line); padding-top:8px; }
  /* install panel */
  .install-kv { display:grid; grid-template-columns:auto 1fr; gap:4px 14px; font-size:12px; }
  .install-kv .k { color:var(--dim); }
  .install-kv .v { color:var(--ink); }
  .install-kv .ok { color:var(--ok); }
  .install-kv .off { color:var(--off); }
  /* info-url link badges */
  .url-row { display:flex; flex-wrap:wrap; gap:6px; margin-top:4px; }
  .url-link { font-size:10px; padding:1px 6px; border-radius:3px; border:1px solid var(--line); color:var(--accent); text-decoration:none; }
  .url-link:hover { border-color:var(--accent); }
  /* clickable (inspectable) item label */
  .item-label.clickable { cursor:pointer; text-decoration:underline dotted var(--off); text-underline-offset:3px; }
  .item-label.clickable:hover { color:var(--accent); }
  /* globals live file */
  .globals-shell { display:grid; gap:10px; }
  .globals-switches { display:flex; flex-wrap:wrap; gap:0; }
  .globals-switch { font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--bg); border:1px solid var(--line); color:var(--dim); padding:3px 12px; cursor:pointer; }
  .globals-switch:first-child { border-radius:5px 0 0 5px; }
  .globals-switch:last-child { border-radius:0 5px 5px 0; border-left:none; }
  .globals-switch.on { background:var(--panel); color:var(--accent); border-color:var(--accent); }
  .globals-live { background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:10px; max-height:44vh; overflow:auto; }
  .globals-live .markdown { font-size:12px; line-height:1.6; color:var(--ink); }
  .globals-live .markdown > :first-child { margin-top:0; }
  .globals-live .markdown > :last-child { margin-bottom:0; }
  .markdown h1, .markdown h2, .markdown h3, .markdown h4, .markdown h5, .markdown h6 { margin:0.8em 0 0.35em; line-height:1.2; color:var(--ink); }
  .markdown h1 { font-size:1.2em; }
  .markdown h2 { font-size:1.05em; }
  .markdown h3 { font-size:0.98em; }
  .markdown p { margin:0.45em 0; }
  .markdown ul, .markdown ol { margin:0.45em 0; padding-left:1.4em; }
  .markdown li { margin:0.2em 0; }
  .markdown blockquote { margin:0.6em 0; padding:0.2em 0 0.2em 0.9em; border-left:3px solid var(--line); color:var(--dim); }
  .markdown pre { margin:0.65em 0; padding:0.8em; overflow:auto; background:#0b0f14; border:1px solid var(--line); border-radius:6px; }
  .markdown code { font:inherit; color:#d2a8ff; background:rgba(255,255,255,.04); padding:0.08em 0.3em; border-radius:4px; }
  .markdown pre code { display:block; padding:0; background:none; color:var(--ink); }
  .markdown hr { border:none; border-top:1px solid var(--line); margin:0.8em 0; }
  .markdown a { color:var(--accent); text-decoration:none; }
  .markdown a:hover { text-decoration:underline; }
  .markdown .md-meta { margin:0.25em 0; color:var(--dim); font-size:11px; }
  .markdown .md-meta code { color:var(--warn); background:none; padding:0; }
  .globals-defaults { display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:11px; color:var(--dim); }
  .globals-defaults strong { color:var(--ink); font-weight:600; }
  .globals-defaults .btn-row { display:flex; flex-wrap:wrap; gap:6px; }
  .globals-default { font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; background:var(--bg); border:1px solid var(--line); color:var(--ink); padding:3px 10px; border-radius:5px; cursor:pointer; }
  .globals-default:hover { border-color:var(--accent); color:var(--accent); }
  .globals-default:disabled { color:var(--dim); cursor:default; opacity:.6; }
  /* modal */
  .modal-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.6); display:none; align-items:center; justify-content:center; padding:24px; z-index:50; }
  .modal-backdrop.open { display:flex; }
  .modal { background:var(--panel); border:1px solid var(--line); border-radius:8px; max-width:900px; width:100%; max-height:85vh; display:flex; flex-direction:column; }
  .modal-head { padding:12px 16px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:12px; }
  .modal-title { font-size:13px; color:var(--ink); font-weight:600; }
  .modal-path { font-size:11px; color:var(--off); }
  .modal-close { margin-left:auto; background:none; border:1px solid var(--line); color:var(--dim); border-radius:5px; padding:3px 9px; cursor:pointer; }
  .modal-close:hover { color:var(--ink); border-color:var(--dim); }
  .modal-body { padding:14px 16px; overflow:auto; }
</style>
</head>
<body>
<header>
  <h1>roborepo</h1>
  <span id="status">loading…</span>
  <nav>
    <a href="/">Telemetry</a>
    <a href="/config" class="active">Config</a>
  </nav>
</header>
<main id="main"></main>
<div class="modal-backdrop" id="modal">
  <div class="modal">
    <div class="modal-head">
      <span class="modal-title" id="modal-title"></span>
      <span class="modal-path" id="modal-path"></span>
      <button class="modal-close" id="modal-close">close ✕</button>
    </div>
    <div class="modal-body"><div class="markdown" id="modal-content"></div></div>
  </div>
</div>
<script>
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

function dot(on) { return el("span", "dot " + (on ? "on" : "off")); }

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
function closeModal() { document.getElementById("modal").classList.remove("open"); }
async function openSourceModal(inspect) {
  const backdrop = document.getElementById("modal");
  document.getElementById("modal-title").textContent = inspect.label || inspect.id;
  document.getElementById("modal-path").textContent = "loading…";
  document.getElementById("modal-content").innerHTML = "";
  backdrop.classList.add("open");
  try {
    const qs = new URLSearchParams({ kind: inspect.kind, id: inspect.id });
    if (inspect.harness) qs.set("harness", inspect.harness);
    const data = await fetch("/api/config/source?" + qs.toString()).then((r) => r.json());
    if (!data.ok) {
      document.getElementById("modal-path").textContent = "";
      document.getElementById("modal-content").textContent = "error: " + (data.error || "failed to load");
      return;
    }
    document.getElementById("modal-title").textContent = data.title || inspect.label;
    document.getElementById("modal-path").textContent = data.path || "";
    setModalContent(data);
  } catch (e) {
    document.getElementById("modal-path").textContent = "";
    document.getElementById("modal-content").textContent = "error: " + e.message;
  }
}

function openSnapshotModal(title, pathText, data) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-path").textContent = pathText || "";
  setModalContent(data);
  document.getElementById("modal").classList.add("open");
}
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

const TOGGLE_ENDPOINT = { package: "/api/config/packages", skill: "/api/config/skills" };

// One switch per mutable item. Optimistic-disable while the POST is in flight; on success the
// poll re-render (driven by the returned snapshot, applied immediately) reflects the new state.
function toggleSwitch(item, statusSlot) {
  const wrap = el("label", "switch");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!item.active;
  input.setAttribute("aria-label", item.label);
  const knob = el("span", "switch-track", el("span", "switch-knob"));
  wrap.appendChild(input);
  wrap.appendChild(knob);

  input.addEventListener("change", async () => {
    const enabled = input.checked;
    input.disabled = true;
    statusSlot.className = "item-status";
    statusSlot.textContent = "applying…";
    document.getElementById("status").textContent = "applying " + item.label + "…";
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
        document.getElementById("status").textContent = "error: " + statusSlot.textContent;
      } else if (data.config) {
        statusSlot.textContent = "saved";
        applySnapshot(data.config); // re-render from the authoritative post-mutation snapshot
        document.getElementById("status").textContent = "saved " + item.label + " " + new Date().toLocaleTimeString();
      } else {
        statusSlot.textContent = "saved";
        document.getElementById("status").textContent = "saved " + item.label + " " + new Date().toLocaleTimeString();
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
  const box = el("div", "profile-box");
  let scope = "global"; // which scope the buttons currently target

  const head = el("div", "perm-profile");
  head.appendChild(el("span", "perm-name", "global: " + (item.globalProfile || "—")));
  head.appendChild(el("span", "perm-desc",
    item.projectProfile ? "this project overrides → " + item.projectProfile : "no project override"));
  box.appendChild(head);

  // Scope switch.
  const scopeRow = el("div", "scope-row");
  const mkScopeBtn = (val, label) => {
    const b = el("button", "scope-btn" + (val === scope ? " on" : ""), label);
    b.addEventListener("click", () => { scope = val; rerender(); });
    return b;
  };
  const choices = el("div", "profile-choices");
  const err = el("div", "item-err");

  function currentFor(sc) {
    return sc === "project" ? item.projectProfile : item.globalProfile;
  }

  async function apply(profile, looser) {
    if (looser) {
      const ok = window.confirm(
        "Switching " + scope + " to '" + profile + "' loosens safety:\\n\\n" +
        (profile === "workspace" ? "the agent stops asking before blocked actions." :
         profile === "networked" ? "the agent's sandbox gets internet access." : "") +
        "\\nApply anyway?");
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
      if (!res.ok || !data.ok) { err.textContent = data.error || data.message || "failed"; return; }
      if (data.config) applySnapshot(data.config);
    } catch (e) { err.textContent = e.message; }
  }

  function rerender() {
    scopeRow.innerHTML = "";
    scopeRow.appendChild(mkScopeBtn("global", "Global"));
    scopeRow.appendChild(mkScopeBtn("project", "This project"));
    choices.innerHTML = "";
    const cur = currentFor(scope);
    for (const opt of (item.options || [])) {
      const isCur = opt.id === cur;
      const btn = el("button", "profile-btn" + (isCur ? " current" : "") + (opt.looser ? " looser" : ""),
        opt.id + (opt.looser ? " ⚠" : ""));
      btn.title = opt.description || "";
      btn.disabled = isCur;
      btn.addEventListener("click", () => apply(opt.id, opt.looser));
      choices.appendChild(btn);
    }
  }

  rerender();
  box.appendChild(scopeRow);
  box.appendChild(choices);
  box.appendChild(err);
  return box;
}

// --------------------------------------------------------------------------- section renderers

function renderPermissionsSection(section) {
  const panel = el("div", "panel");
  panel.appendChild(el("div", "panel-head", el("h2", null, section.category)));

  for (const item of section.items) {
    const row = document.createElement("div");
    row.className = "perm-row";

    if (item.kind === "profile") {
      row.appendChild(profileSelector(item));
    } else if (item.kind === "info") {
      row.appendChild(el("div", "perm-label", item.label));
      if (item.value) row.appendChild(el("div", "perm-value", item.value));
    } else if (item.kind === "expandable") {
      row.appendChild(el("div", "perm-label", item.label));
      const btn = el("button", "expand-btn", "show all ▸");
      const list = document.createElement("ul");
      list.className = "expand-list";
      for (const d of (item.detail || [])) {
        list.appendChild(el("li", null, d));
      }
      btn.addEventListener("click", () => {
        const open = list.classList.toggle("open");
        btn.textContent = open ? "hide ▴" : "show all ▸";
      });
      row.appendChild(btn);
      row.appendChild(list);
    }
    panel.appendChild(row);
  }
  return panel;
}

function renderStandardSection(section) {
  const panel = el("div", "panel" + (section.wide ? " wide" : ""));
  const head = el("div", "panel-head");
  head.appendChild(el("h2", null, section.category));
  panel.appendChild(head);
  if (section.description) panel.appendChild(el("p", "panel-desc", section.description));

  for (const item of section.items) {
    const row = el("div", "item");
    row.appendChild(dot(item.active));
    const body = el("div", "item-body");
    const top = el("div", "item-row");
    // Inspectable items (skills/commands/chat-time rules) get a clickable label that opens the
    // source popup. The label still reflects active/dim state.
    const labelCls = "item-label" + (item.active ? "" : " dim") + (item.inspect ? " clickable" : "");
    const labelEl = el("span", labelCls, item.label);
    if (item.inspect) {
      labelEl.title = "view source";
      labelEl.addEventListener("click", () => openSourceModal(item.inspect));
    }
    top.appendChild(labelEl);
    for (const b of (item.badges || [])) top.appendChild(badge(b));
    body.appendChild(top);
    if (item.description) body.appendChild(el("div", "item-desc", item.description));
    if (item.hint) body.appendChild(el("div", "item-hint", "→ " + item.hint));
    // Info URLs (GitHub / docs / PyPI) as small link badges.
    if (item.urls && item.urls.length) {
      const urlRow = el("div", "url-row");
      for (const u of item.urls) {
        const a = el("a", "url-link", u.label || u.url);
        a.href = u.url; a.target = "_blank"; a.rel = "noopener noreferrer";
        urlRow.appendChild(a);
      }
      body.appendChild(urlRow);
    }
    const errSlot = el("div", "item-status");
    body.appendChild(errSlot);
    row.appendChild(body);
    if (item.toggle) row.appendChild(toggleSwitch(item, errSlot));
    panel.appendChild(row);
  }
  if (section.footnote) {
    const note = el("p", "panel-footnote", "* " + section.footnote);
    panel.appendChild(note);
  }
  return panel;
}

function renderSection(section) {
  if (section.kind === "permissions") return renderPermissionsSection(section);
  return renderStandardSection(section);
}

// Globals: harness-agnostic rules + global settings (agnostic + claude + codex). Shown first, above
// Token Optimization, so the baseline every harness gets is visible before the per-feature toggles.
function renderGlobals(snap) {
  const g = snap.globals || {};
  const rules = g.rules || {};
  const liveRules = g.liveRules || {};
  const settings = g.settings || {};
  const panel = el("div", "panel wide");
  const head = el("div", "panel-head");
  head.appendChild(el("h2", null, "Globals"));
  panel.appendChild(head);
  panel.appendChild(el("p", "panel-desc", "Live rules files plus the baseline slices that feed them."));

  const liveRow = el("div", "globals-shell");
  const installed = [
    ["claude", liveRules.claude],
    ["codex", liveRules.codex],
  ].filter(([, v]) => v?.installed);
  const available = installed.map(([key]) => key);
  const bothInstalled = available.length > 1;
  let selected = selectedLiveHarness && available.includes(selectedLiveHarness)
    ? selectedLiveHarness
    : (available[0] || null);

  const switchRow = el("div", "globals-switches");
  const fileLabel = el("div", "perm-label");
  const fileFrame = el("div", "globals-live");
  const fileBody = el("div", "markdown");

  function paintLive() {
    const live = selected ? liveRules[selected] : null;
    if (!live?.installed) {
      fileLabel.textContent = "No live rules file";
      fileBody.innerHTML = '<p class="md-meta">No live rules file found.</p>';
    } else {
      fileLabel.textContent = "Live " + live.path;
      fileBody.innerHTML = live.html || '<p class="md-meta">(empty)</p>';
    }
    if (bothInstalled) {
      for (const btn of switchRow.children) btn.classList.toggle("on", btn.dataset.key === selected);
    }
  }

  if (bothInstalled) {
    for (const [key, label] of [["claude", "Claude"], ["codex", "Codex"]]) {
      const b = el("button", "globals-switch" + (key === selected ? " on" : ""), label);
      b.dataset.key = key;
      b.addEventListener("click", () => {
        selectedLiveHarness = key;
        render(lastSnapshot);
      });
      switchRow.appendChild(b);
    }
    liveRow.appendChild(switchRow);
  }
  liveRow.appendChild(fileLabel);
  fileFrame.appendChild(fileBody);
  liveRow.appendChild(fileFrame);
  panel.appendChild(liveRow);
  paintLive();

  const defaults = el("div", "globals-defaults");
  defaults.appendChild(el("strong", null, "Roborepo defaults:"));
  const defaultButtons = el("div", "btn-row");
  for (const [key, label] of [
    ["shared", "Global baseline"],
    ["claude", "Claude baseline"],
    ["codex", "Codex baseline"],
    ["packages", "Tool Add-Ons"],
  ]) {
    const entry = rules[key];
    const btn = el("button", "globals-default", label);
    btn.disabled = !entry?.html;
    const pathText = key === "shared"
      ? "globals/rules/shared"
      : key === "claude"
        ? "globals/rules/claude"
        : key === "codex"
          ? "globals/rules/codex"
          : "globals/packages/*/rules.md";
    btn.addEventListener("click", () => openSnapshotModal(label, pathText, entry));
    defaultButtons.appendChild(btn);
  }
  defaults.appendChild(defaultButtons);
  panel.appendChild(defaults);

  // Global settings KV.
  panel.appendChild(el("p", "perm-label", "Global settings"));
  const kv = el("div", "install-kv");
  const row = (k, vText, cls) => { kv.appendChild(el("span", "k", k)); kv.appendChild(el("span", cls ? "v " + cls : "v", vText)); };
  row("active profile", settings.activeProfile || "—");
  row("project override", settings.projectProfile || "none");
  row("profiles", (settings.profiles || []).join(", ") || "—");
  row("caveman plugin", settings.plugins?.caveman ? "enabled" : "disabled", settings.plugins?.caveman ? "ok" : "off");
  const hookEvents = Object.keys(settings.hooks || {});
  row("hooks", hookEvents.length ? hookEvents.join(", ") : "none");
  panel.appendChild(kv);
  return panel;
}

function renderInstall(snap) {
  const panel = el("div", "panel wide");
  panel.appendChild(el("div", "panel-head", el("h2", null, "Install")));

  const kv = el("div", "install-kv");
  const row = (k, vText, cls) => {
    kv.appendChild(el("span", "k", k));
    kv.appendChild(el("span", cls ? "v " + cls : "v", vText));
  };

  const mode = snap.install?.mode;
  row("mode", mode || "not installed  (shim / manual config)");
  if (snap.install?.updatedAt) row("updated", new Date(snap.install.updatedAt).toLocaleString());
  if (snap.onboardedAt)        row("onboarded", new Date(snap.onboardedAt).toLocaleString());

  const telOn = snap.telemetry?.enabled;
  row("telemetry", telOn ? "enabled" : "disabled", telOn ? "ok" : "off");

  panel.appendChild(kv);
  return panel;
}

function render(snap) {
  const main = document.getElementById("main");
  main.innerHTML = "";
  main.appendChild(renderGlobals(snap));
  // Section model comes straight from the server snapshot (buildBehaviorView), no client fork.
  const view = snap.behaviorView || [];
  for (const section of view) main.appendChild(renderSection(section));
  main.appendChild(renderInstall(snap));
}

// --------------------------------------------------------------------------- poll

let last = null;
let lastSnapshot = null;
let selectedLiveHarness = null;
function applySnapshot(snap) {
  lastSnapshot = snap;
  const sig = JSON.stringify(snap);
  if (sig !== last) { last = sig; render(snap); }
  document.getElementById("status").textContent = "updated " + new Date().toLocaleTimeString();
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
</script>
</body>
</html>`;
}

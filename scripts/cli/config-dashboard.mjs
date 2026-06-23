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
<script>
// --------------------------------------------------------------------------- behavior view

// Mirrors buildBehaviorView() in config.mjs — derives the user-facing sections from raw snapshot.
function behaviorView(snap) {
  const pkg = (id) => (snap.packages || []).find((p) => p.id === id);
  const bundle = (id) => (snap.bundles || []).find((b) => b.id === id);
  const tel = snap.telemetry || {};
  const perms = snap.agentPermissions || null;
  return [
    {
      category: "Token Optimization", wide: false,
      items: [
        { id:"jcodemunch", label:"jcodemunch",     desc:"Code indexer — find code via symbol search instead of reading files", active: pkg("jcodemunch")?.enabled ?? false, toggle:"package" },
        { id:"jdocmunch",  label:"jdocmunch",      desc:"Docs indexer — query sections instead of reading whole files",        active: pkg("jdocmunch")?.enabled  ?? false, toggle:"package" },
        { id:"caveman",    label:"Caveman plugin", desc:"Keeps agent output terse to reduce token use",                        active: pkg("caveman")?.enabled ?? snap.plugins?.caveman ?? false, toggle:"package", hint: (pkg("caveman")?.enabled ?? snap.plugins?.caveman) ? null : "enables on the harness's next launch" },
        { id:"telemetry",  label:"Telemetry",      desc:"Capture and visualize token usage across harnesses",                  active: pkg("telemetry")?.enabled ?? !!tel.enabled, toggle:"package" },
      ],
    },
    {
      category: "Commands", wide: false,
      desc: "Named slash-command workflows you start intentionally.",
      items: (snap.tools || [])
        .filter((t) => t.command && t.id !== "roborepo-support")
        .map((t) => ({
          id: t.id, label: "/" + t.command, desc: t.description, active: t.installed,
          badges: ["/" + t.command, "skill"], toggle: "skill",
        })),
    },
    {
      category: "Code Conventions", wide: false,
      desc: "Skills auto-loaded when relevant — shape output without an explicit command.",
      footnote: "roborepo-support — help skill for this repo, always loaded.",
      items: (snap.tools || [])
        .filter((t) => !t.command && t.id !== "roborepo-support")
        .map((t) => ({
          id: t.id, label: t.label, desc: t.description, active: t.installed,
          badges: ["skill"], toggle: "skill",
        })),
    },
    {
      category: "Chat-Time Output", wide: false,
      desc: "Inline chat notes the agent adds while responding — no files written, no workflow started.",
      items: [
        { id:"convention-capture", label:"Convention capture", desc:"Surfaces newly confirmed conventions inline (\u{1F4CC} Capture candidate)", active: pkg("convention-capture")?.enabled ?? false, toggle:"package" },
        { id:"impact-awareness",   label:"Impact awareness",   desc:"Flags how a proposed change collides with existing functionality (\u{1F9ED} Impact)", active: pkg("impact-awareness")?.enabled ?? false, toggle:"package" },
        { id:"skill-visibility",   label:"Skill visibility",   desc:"Reports which skills shaped a response (\u{1F9E9} Skills loaded)", active: pkg("skill-visibility")?.enabled ?? false, toggle:"package" },
      ],
    },
    {
      category: "Permissions", wide: false,
      kind: "permissions",
      items: [
        {
          id: "profile",
          label: snap.activeProfile || perms?.default_profile || "interactive",
          desc: perms?.profiles?.[snap.activeProfile || perms?.default_profile]?.description || null,
          kind: "profile",
          active: snap.activeProfile || perms?.default_profile || "interactive",
          globalProfile: snap.activeProfile || perms?.default_profile || null,
          projectProfile: snap.projectProfile || null,
          options: (snap.profiles || []).map((id) => ({
            id,
            desc: perms?.profiles?.[id]?.description || null,
            looser: id === "workspace" || id === "networked",
          })),
        },
        {
          id: "deny",
          label: (perms?.commands?.deny?.length || 0) + " blocked",
          value: (perms?.commands?.deny || []).map((c) => c.join(" ")).join(" · "),
          kind: "info",
        },
        {
          id: "allow",
          label: (perms?.commands?.allow?.length || 0) + " pre-approved",
          kind: "expandable",
          detail: (perms?.commands?.allow || []).map((c) => c.join(" ")),
        },
      ],
    },
  ];
}

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

const TOGGLE_ENDPOINT = { package: "/api/config/packages", skill: "/api/config/skills" };

// One switch per mutable item. Optimistic-disable while the POST is in flight; on success the
// poll re-render (driven by the returned snapshot, applied immediately) reflects the new state.
function toggleSwitch(item, errSlot) {
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
    errSlot.textContent = "";
    try {
      const res = await fetch(TOGGLE_ENDPOINT[item.toggle], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, enabled }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        input.checked = !enabled; // revert
        errSlot.textContent = data.error || data.message || "failed";
      } else if (data.config) {
        applySnapshot(data.config); // re-render from the authoritative post-mutation snapshot
      }
    } catch (e) {
      input.checked = !enabled;
      errSlot.textContent = e.message;
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
      btn.title = opt.desc || "";
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
  if (section.desc) panel.appendChild(el("p", "panel-desc", section.desc));

  for (const item of section.items) {
    const row = el("div", "item");
    row.appendChild(dot(item.active));
    const body = el("div", "item-body");
    const top = el("div", "item-row");
    top.appendChild(el("span", "item-label" + (item.active ? "" : " dim"), item.label));
    for (const b of (item.badges || [])) top.appendChild(badge(b));
    body.appendChild(top);
    if (item.desc) body.appendChild(el("div", "item-desc", item.desc));
    if (item.hint) body.appendChild(el("div", "item-hint", "→ " + item.hint));
    const errSlot = el("div", "item-err");
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
  const view = behaviorView(snap);
  for (const section of view) main.appendChild(renderSection(section));
  main.appendChild(renderInstall(snap));
}

// --------------------------------------------------------------------------- poll

let last = null;
function applySnapshot(snap) {
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

// Shared browser API layer for every portal page: manifest access, JSON fetch helpers, the
// mutation-token contract, clipboard, "updated at" status, and a small DOM builder. Pages import
// from here instead of reimplementing fetch/token/clipboard plumbing per page.

export function portalConfig() {
  if (!window.ROBOREPO_PORTAL) throw new Error("portal manifest missing");
  return window.ROBOREPO_PORTAL;
}

export async function portalGetJson(path) {
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || "request failed");
  return data;
}

export async function portalPostJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Roborepo-Portal-Token": portalConfig().token,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || data.message || "request failed");
  return data;
}

export async function portalCopyText(text, onCopied) {
  try {
    await navigator.clipboard.writeText(text);
    onCopied?.();
  } catch {
    // clipboard blocked (permissions/insecure context); nothing more to do locally
  }
}

export function portalSetUpdatedAt(date = new Date()) {
  const node = document.getElementById("portal-updated");
  if (!node) return;
  const value = date instanceof Date ? date : new Date(date);
  node.textContent = Number.isNaN(value.getTime())
    ? "updated unknown"
    : "updated " + value.toLocaleTimeString();
}

// Hides the full-page loading overlay after a page's first data fetch resolves (success or
// handled error) — never called again after that, so later polls don't re-show it.
export function portalHideLoading() {
  document.getElementById("page-loading")?.classList.add("hidden");
}

// Clones a <template>'s first child by id — the shared render pattern for dynamically-injected
// markup, so pages keep an HTML anchor for new elements instead of building raw strings.
export function portalTpl(id) {
  return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

// Fills a cloned template's [data-slot] elements in one call. Each `fills` key matches a
// data-slot name; string/number values become that slot's textContent, a Node replaces the slot
// element outright (e.g. swapping in a button with its own listener), and `{attr: {...}}` sets
// attributes on the slot without touching its content. Slot names not present in `fills` are left
// untouched, so callers can pre-fill some slots via the DOM and the rest here.
export function portalFillSlots(node, fills) {
  for (const [name, value] of Object.entries(fills)) {
    const slot = node.querySelector(`[data-slot="${name}"]`);
    if (!slot || value == null) continue;
    if (value instanceof Node) slot.replaceWith(value);
    else if (typeof value === "object") for (const [attr, v] of Object.entries(value)) slot.setAttribute(attr, v);
    else slot.textContent = String(value);
  }
  return node;
}

export function portalEl(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "value") node.value = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

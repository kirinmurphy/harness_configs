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

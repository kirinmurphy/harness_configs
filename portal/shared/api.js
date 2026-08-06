// Shared browser API layer for every portal page: manifest access, JSON fetch helpers, the
// mutation-token contract, clipboard, "updated at" status, and the template-clone/slot-fill
// helpers. Pages import from here instead of reimplementing fetch/token/clipboard plumbing per page.

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
  if (!res.ok || data.ok === false) {
    // Structured errors (see plan-docs' domainError / portal-routes-plans' sendDomainError)
    // arrive as { error: { code, message, resolution, details } }; older/unmigrated routes still
    // send a flat string. Preserve whichever shape came back instead of collapsing both to a
    // plain message, so callers can branch on err.code (e.g. STALE_PLAN) without parsing text.
    const isStructured = data.error && typeof data.error === "object";
    const err = new Error(isStructured ? data.error.message : data.error || data.message || "request failed");
    err.status = res.status;
    if (isStructured) {
      err.code = data.error.code;
      err.resolution = data.error.resolution;
      err.details = data.error.details;
      // Readiness failures add structured findings and a server-generated repair prompt. Mirrors
      // the key list in portal-routes-plans' sendDomainError — both sides whitelist explicitly.
      err.findings = data.error.findings;
      err.repair = data.error.repair;
    }
    throw err;
  }
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

// Default cap for portalMiddleEllipsis. A single shared constant rather than a magic number
// scattered across call sites, so every truncated label on the site stays visually consistent and
// there's one place to retune it.
export const PORTAL_MIDDLE_ELLIPSIS_MAX_LENGTH = 28;

// Truncates in the middle rather than the end: for repo/path-shaped strings the tail is often the
// most identifying part (e.g. "supabase/studio" vs "supabase/postgres"), so an end-truncated label
// collapses distinct values to the same visible text.
export function portalMiddleEllipsis(value, maxLength = PORTAL_MIDDLE_ELLIPSIS_MAX_LENGTH) {
  if (typeof value !== "string" || value.length <= maxLength) return value;
  const keep = maxLength - 1;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
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
// untouched, so callers can pre-fill some slots via the DOM and the rest here. A template whose
// single root element carries its own data-slot (no wrapper) is matched too — querySelector alone
// only searches descendants, so the root has to be checked separately.
export function portalFillSlots(node, fills) {
  for (const [name, value] of Object.entries(fills)) {
    const slot = node.matches?.(`[data-slot="${name}"]`) ? node : node.querySelector(`[data-slot="${name}"]`);
    if (!slot || value == null) continue;
    if (value instanceof Node) slot.replaceWith(value);
    else if (typeof value === "object") for (const [attr, v] of Object.entries(value)) slot.setAttribute(attr, v);
    else slot.textContent = String(value);
  }
  return node;
}

// The dialog width scale, mirroring the `dialog[data-dialog-size]` rules in shared/base.css. Markup
// sets the size directly (`data-dialog-size="lg"`); this export is for the cases where a controller
// has to choose one at runtime, so the names stay in one place instead of being retyped as string
// literals. Changing a width means editing the matching --dialog-* custom property in base.css.
export const DIALOG_SIZES = Object.freeze({
  sm: "sm",
  md: "md",
  lg: "lg",
  xl: "xl",
});

export function portalSetDialogSize(dialogEl, size) {
  if (!DIALOG_SIZES[size]) throw new Error(`unknown dialog size: ${size}`);
  dialogEl.dataset.dialogSize = size;
}

// Wires "click on the dialog's own backdrop area closes it" — every page-singleton <dialog>
// controller (createInfoModal, createConfigModal, createDetailModal, createSkillDetailModal)
// needs this exact listener; centralized here so it's written once.
export function portalWireBackdropClose(dialogEl, onClose) {
  dialogEl.addEventListener("click", (event) => {
    if (event.target === dialogEl) onClose();
  });
}

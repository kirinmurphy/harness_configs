// Shared hover/focus tooltip for any element carrying a `data-tip` attribute. One singleton bubble is
// appended to <body> and positioned with JS so it never crosses the viewport edges — the same
// boundary-aware behavior as the dropdown popovers (unlike a CSS ::after tooltip, which happily
// renders off-screen). Import once per page; it wires delegated listeners itself.
//
// Why JS and not a native element: there is no native, cross-browser, *styleable* tooltip. The
// `title` attribute auto-positions but can't be styled; the Popover API renders in the top layer but
// you still position it yourself; CSS anchor-positioning (position-try-fallbacks) does flip/shift
// automatically but is not yet broadly supported. So a tiny JS positioner is the reliable path.

const MARGIN = 8; // keep this far inside the viewport
const GAP = 8; // space between trigger and bubble

let bubble = null;

function ensureBubble() {
  if (bubble) return bubble;
  bubble = document.createElement("div");
  bubble.className = "portal-tooltip";
  bubble.setAttribute("role", "tooltip");
  bubble.hidden = true;
  document.body.appendChild(bubble);
  return bubble;
}

function position(el) {
  const tip = ensureBubble();
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Measure at full width first, then clamp. max-width is enforced by CSS.
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;

  // Prefer above the trigger; flip below if there isn't room above.
  const above = r.top - GAP - th - MARGIN >= 0 || r.top > vh - r.bottom;
  let top = above ? r.top - GAP - th : r.bottom + GAP;
  // Clamp vertically so it never leaves the viewport even after the flip decision.
  top = Math.max(MARGIN, Math.min(top, vh - th - MARGIN));

  // Center horizontally on the trigger, then clamp both edges inside the viewport.
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(MARGIN, Math.min(left, vw - tw - MARGIN));

  tip.style.top = `${Math.round(top)}px`;
  tip.style.left = `${Math.round(left)}px`;
}

function show(el) {
  const text = el.getAttribute("data-tip");
  if (!text) return;
  const tip = ensureBubble();
  tip.textContent = text;
  tip.hidden = false;
  // Position after it's laid out so offsetWidth/Height are real.
  position(el);
}

function hide() {
  if (bubble) bubble.hidden = true;
}

function install() {
  // Delegated so it covers elements added after load (insight rows are rendered per repaint).
  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (el) show(el);
  });
  document.addEventListener("pointerout", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (el && !el.contains(e.relatedTarget)) hide();
  });
  // Keyboard accessibility: focus/blur mirror hover.
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest?.("[data-tip]");
    if (el) show(el);
  });
  document.addEventListener("focusout", hide);
  // Anything that shifts layout out from under an open tip should dismiss it.
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
}

install();

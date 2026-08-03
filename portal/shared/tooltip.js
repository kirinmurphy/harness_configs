// Shared hover/focus tooltip for any element carrying a `data-tip` (plain text) or `data-tip-html`
// (rich content, sourced from a sibling <template>) attribute. One singleton bubble is appended to
// <body> and positioned with JS so it never crosses the viewport edges — the same boundary-aware
// behavior as the dropdown popovers (unlike a CSS ::after tooltip, which happily renders
// off-screen). Import once per page; it wires delegated listeners itself.
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

// Picks whichever side (above/below, left/right) has the most room rather than a fixed
// preference, then clamps inside the viewport. If neither vertical side can fit the content at
// its natural height, the roomier side wins and the bubble gets a capped max-height + internal
// scroll instead of overflowing the screen.
function position(el) {
  const tip = ensureBubble();
  tip.style.maxHeight = "";
  tip.style.overflowY = "";
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;

  const spaceBelow = vh - r.bottom - GAP - MARGIN;
  const spaceAbove = r.top - GAP - MARGIN;
  const below = spaceBelow >= th || spaceBelow >= spaceAbove;
  const availableVertical = Math.max(below ? spaceBelow : spaceAbove, 0);

  // A tooltip must never scroll. The bubble is pointer-events:none, so a scrollbar here is
  // unreachable by definition — content past the fold is not "scrollable", it is invisible, and a
  // tooltip that silently hides half its content is worse than one that is merely tall.
  //
  // So when the preferred side cannot fit the content, the bubble is allowed to use the full
  // viewport height instead of being capped to that side, and is then clamped into view below.
  // Being tall is fine: this is a transient overlay with nothing beside it competing for space.
  if (th > availableVertical) {
    tip.style.maxHeight = `${vh - MARGIN * 2}px`;
  }

  // Re-measure: the max-height above can change the height when it forces content to re-wrap.
  const finalHeight = tip.offsetHeight;
  // Anchor to the preferred side, then clamp so the whole bubble stays on screen. Clamping rather
  // than capping is what lets a tall tooltip slide up into view instead of being truncated.
  const preferredTop = below ? r.bottom + GAP : r.top - GAP - finalHeight;
  const top = Math.max(MARGIN, Math.min(preferredTop, vh - finalHeight - MARGIN));
  tip.style.top = `${Math.round(top)}px`;

  const spaceRight = vw - r.left - MARGIN;
  const spaceLeft = r.right - MARGIN;
  const alignLeft = spaceRight >= tw || spaceRight >= spaceLeft;

  let left = alignLeft ? r.left : r.right - tw;
  left = Math.max(MARGIN, Math.min(left, vw - tw - MARGIN));
  tip.style.left = `${Math.round(left)}px`;
}

function show(el) {
  const tip = ensureBubble();
  const templateSelector = el.getAttribute("data-tip-html");
  if (templateSelector) {
    const template = el.querySelector(templateSelector) || document.querySelector(templateSelector);
    if (!template) return;
    tip.replaceChildren(template.content.cloneNode(true));
    tip.classList.add("portal-tooltip--rich");
  } else {
    const text = el.getAttribute("data-tip");
    if (!text) return;
    tip.textContent = text;
    tip.classList.remove("portal-tooltip--rich");
  }
  tip.hidden = false;
  // Position after it's laid out so offsetWidth/Height are real.
  position(el);
}

function hide() {
  if (bubble) bubble.hidden = true;
}

const TRIGGER_SELECTOR = "[data-tip], [data-tip-html]";

function install() {
  // Delegated so it covers elements added after load (insight rows are rendered per repaint).
  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest?.(TRIGGER_SELECTOR);
    if (el) show(el);
  });
  document.addEventListener("pointerout", (e) => {
    const el = e.target.closest?.(TRIGGER_SELECTOR);
    if (el && !el.contains(e.relatedTarget)) hide();
  });
  // Keyboard accessibility: focus/blur mirror hover.
  document.addEventListener("focusin", (e) => {
    const el = e.target.closest?.(TRIGGER_SELECTOR);
    if (el) show(el);
  });
  document.addEventListener("focusout", hide);
  // Anything that shifts layout out from under an open tip should dismiss it.
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
}

install();

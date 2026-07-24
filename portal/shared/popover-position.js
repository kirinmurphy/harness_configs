// Shared fixed-popover positioner for the anchored menus (menu-button.js, option-dropdown.js). The
// old per-component logic only chose above/below by a fixed threshold — if the panel was taller than
// the room on the chosen side, it rendered partially off-screen with no way to reach the clipped
// items. This instead clamps the panel's max-height so its far edge always stays on-screen and lets
// it scroll internally past that (overflow-y is set on the panel by CSS).
//
// panel must be position:fixed. trigger is the element the panel anchors to. Opens on whichever
// vertical side has more room, clamped to that room; horizontally aligns to the nearer viewport edge.

const GAP = 4; // px between trigger and panel
const VIEWPORT_MARGIN = 8; // keep the panel's far edge this far inside the viewport

export function positionPopoverPanel(panel, trigger) {
  const rect = trigger.getBoundingClientRect();
  const vh = window.innerHeight;
  const vw = window.innerWidth;

  // Room available on each side of the trigger, minus the gap and a small viewport margin.
  const roomBelow = vh - rect.bottom - GAP - VIEWPORT_MARGIN;
  const roomAbove = rect.top - GAP - VIEWPORT_MARGIN;
  const openAbove = roomBelow < roomAbove;
  const available = Math.max(openAbove ? roomAbove : roomBelow, 0);

  // Clamp the panel height to the room on the chosen side so the far edge stays on-screen; the panel
  // scrolls internally past that (CSS gives it overflow-y:auto). Recomputed on every open, so a
  // previous open on a cramped side never sticks.
  panel.style.maxHeight = available + "px";

  if (openAbove) {
    panel.style.top = "auto";
    panel.style.bottom = vh - rect.top + GAP + "px";
  } else {
    panel.style.bottom = "auto";
    panel.style.top = rect.bottom + GAP + "px";
  }

  const rightAligned = rect.left + rect.width / 2 > vw / 2;
  if (rightAligned) {
    panel.style.right = vw - rect.right + "px";
    panel.style.left = "auto";
  } else {
    panel.style.left = rect.left + "px";
    panel.style.right = "auto";
  }
}

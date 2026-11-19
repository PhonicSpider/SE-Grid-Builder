// Tooltips for anything with a `data-tooltip="..."` attribute.
//
// One tooltip box is drawn on top of the whole page and moved next to
// whichever element the mouse is over. (An earlier version drew the tooltip
// inside the element with CSS; the side panel clipped it, so text near the
// panel's edge slid behind the 3D view.) Positioning happens here so the box
// can always be kept inside the window.

/** Short pause before showing, so tooltips do not flash while moving across buttons. */
const SHOW_DELAY_MS = 350;
/** Space kept between the tooltip, the element and the window edge. */
const GAP_PIXELS = 8;

export function setUpTooltips(): void {
  const bubble = document.createElement("div");
  bubble.id = "tooltip";
  bubble.setAttribute("role", "tooltip");
  bubble.hidden = true;
  document.body.append(bubble);

  let currentTarget: Element | null = null;
  let showTimer: number | undefined;

  function hide(): void {
    window.clearTimeout(showTimer);
    currentTarget = null;
    bubble.hidden = true;
  }

  function place(target: Element): void {
    bubble.textContent = (target as HTMLElement).dataset.tooltip ?? "";
    bubble.hidden = false;

    const targetBox = target.getBoundingClientRect();
    const bubbleBox = bubble.getBoundingClientRect();

    // Below the element, lined up with its left edge...
    let left = targetBox.left;
    let top = targetBox.bottom + GAP_PIXELS;

    // ...but pushed back inside the window if it would run off an edge.
    left = Math.min(left, window.innerWidth - bubbleBox.width - GAP_PIXELS);
    left = Math.max(GAP_PIXELS, left);
    if (top + bubbleBox.height > window.innerHeight - GAP_PIXELS) {
      top = targetBox.top - bubbleBox.height - GAP_PIXELS; // flip above the element
    }
    bubble.style.left = `${left}px`;
    bubble.style.top = `${Math.max(GAP_PIXELS, top)}px`;
  }

  document.addEventListener("pointerover", (event) => {
    const target = (event.target as Element).closest("[data-tooltip]");
    if (target === currentTarget) return;
    hide();
    if (!target) return;
    currentTarget = target;
    showTimer = window.setTimeout(() => place(target), SHOW_DELAY_MS);
  });

  // Anything the player does hides the tooltip, so it never lingers over what they are using.
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("keydown", hide, true);
  window.addEventListener("blur", hide);
  document.addEventListener("scroll", hide, true);
}

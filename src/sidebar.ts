// Makes the side panel resizable: drag the thin bar between the panel and the
// 3D view, or focus it and use the left and right arrow keys. Double-click
// resets the width. The chosen width is remembered between runs.

const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 260;
/** The panel may never take more than this share of the window, so the 3D view stays usable. */
const MAX_WIDTH_SHARE = 0.7;
const KEYBOARD_STEP = 24;
const STORAGE_KEY = "se-grid-builder.panel-width";

function clampWidth(width: number): number {
  const largest = Math.max(MIN_WIDTH, Math.floor(window.innerWidth * MAX_WIDTH_SHARE));
  return Math.min(largest, Math.max(MIN_WIDTH, Math.round(width)));
}

function readSavedWidth(): number {
  // Browser storage can be unavailable, so every use is wrapped.
  try {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(width: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // Not remembering the width is harmless.
  }
}

export function setUpSidebarResizer(panel: HTMLElement, handle: HTMLElement): void {
  let width = clampWidth(readSavedWidth());

  function apply(newWidth: number, remember: boolean): void {
    width = clampWidth(newWidth);
    // The stylesheet reads this variable for the panel's width.
    document.documentElement.style.setProperty("--panel-width", `${width}px`);
    handle.setAttribute("aria-valuenow", String(width));
    if (remember) saveWidth(width);
  }

  handle.setAttribute("aria-valuemin", String(MIN_WIDTH));
  apply(width, false);

  // Drag with the mouse or a finger. Capturing the pointer keeps the drag
  // working even when the cursor leaves the thin bar.
  handle.addEventListener("pointerdown", (event) => {
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing");
  });
  handle.addEventListener("pointermove", (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    apply(event.clientX - panel.getBoundingClientRect().left, false);
  });
  const finishDrag = (event: PointerEvent) => {
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    document.body.classList.remove("resizing");
    saveWidth(width);
  };
  handle.addEventListener("pointerup", finishDrag);
  handle.addEventListener("pointercancel", finishDrag);

  handle.addEventListener("dblclick", () => apply(DEFAULT_WIDTH, true));

  handle.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") apply(width - KEYBOARD_STEP, true);
    else if (event.key === "ArrowRight") apply(width + KEYBOARD_STEP, true);
    else if (event.key === "Home") apply(DEFAULT_WIDTH, true);
    else return;
    event.preventDefault();
  });

  // If the window shrinks, make sure the panel still fits.
  window.addEventListener("resize", () => apply(width, false));
}

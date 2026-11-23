// The two places a block's variants are shown:
//   - VariantStrip: a row of icons centered at the bottom of the 3D view, for
//     the selected block's group (click one to switch to it).
//   - VariantPopup: a small box beside the cursor while hovering a block tile
//     in the menu, listing what is in that tile's group.
// Both draw the game's own icons, loaded on demand.

import type { BlockInfo } from "./catalog";
import { loadGameIcon } from "./blockIcons";

/** Name shown for a block. */
function nameOf(block: BlockInfo): string {
  return block.display_name || block.subtype_id || block.type_id;
}

/** A small square picture of a block's icon; the picture fills in once it has loaded. */
function makeIcon(block: BlockInfo): HTMLImageElement {
  const picture = document.createElement("img");
  picture.alt = "";
  picture.draggable = false;
  void loadGameIcon(block.icon).then((address) => {
    if (address) picture.src = address;
  });
  return picture;
}

export class VariantStrip {
  constructor(
    private container: HTMLElement,
    private onPick: (block: BlockInfo) => void,
  ) {
    this.container.hidden = true;
  }

  /** Shows the variants with the selected one highlighted. Hidden unless there are at least two. */
  show(variants: BlockInfo[], selected: BlockInfo | null): void {
    if (!selected || variants.length < 2) {
      this.container.hidden = true;
      this.container.replaceChildren();
      return;
    }
    const buttons = variants.map((block) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "variant-button";
      button.dataset.tooltip = nameOf(block);
      button.setAttribute("aria-label", nameOf(block));
      button.setAttribute("aria-pressed", String(block === selected));
      button.classList.toggle("selected", block === selected);
      button.append(makeIcon(block));
      button.addEventListener("click", () => this.onPick(block));
      return button;
    });
    this.container.replaceChildren(...buttons);
    this.container.hidden = false;
  }
}

/** How long the pointer rests on a tile before the pop-up appears. */
const POPUP_DELAY_MS = 250;
/** Distance kept between the cursor, the pop-up and the window edge. */
const POPUP_GAP_PIXELS = 16;

export class VariantPopup {
  private box: HTMLDivElement;
  private timer: number | undefined;

  constructor() {
    this.box = document.createElement("div");
    this.box.id = "variant-popup";
    this.box.hidden = true;
    document.body.append(this.box);
    // Anything the player does closes it, like the ordinary tooltips.
    document.addEventListener("pointerdown", () => this.hide(), true);
    document.addEventListener("scroll", () => this.hide(), true);
    window.addEventListener("blur", () => this.hide());
  }

  /**
   * Starts showing the pop-up for a tile once the pointer rests on it.
   * `position()` gives the latest pointer position, so the box appears where the cursor ended up.
   */
  showSoon(variants: BlockInfo[], position: () => { x: number; y: number }): void {
    this.hide();
    this.timer = window.setTimeout(() => this.place(variants, position()), POPUP_DELAY_MS);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.box.hidden = true;
  }

  private place(variants: BlockInfo[], pointer: { x: number; y: number }): void {
    const title = document.createElement("div");
    title.className = "variant-popup-title";
    title.textContent = `${nameOf(variants[0])} · ${variants.length} shapes`;

    const row = document.createElement("div");
    row.className = "variant-popup-row";
    for (const block of variants) {
      const cell = document.createElement("div");
      cell.className = "variant-popup-cell";
      cell.title = nameOf(block);
      cell.append(makeIcon(block));
      row.append(cell);
    }
    this.box.replaceChildren(title, row);
    this.box.hidden = false;

    // To the right of the cursor, kept inside the window (flipped to the left near the right edge).
    const size = this.box.getBoundingClientRect();
    let left = pointer.x + POPUP_GAP_PIXELS;
    if (left + size.width > window.innerWidth - POPUP_GAP_PIXELS) left = pointer.x - size.width - POPUP_GAP_PIXELS;
    const top = Math.min(pointer.y, window.innerHeight - size.height - POPUP_GAP_PIXELS);
    this.box.style.left = `${Math.max(POPUP_GAP_PIXELS, left)}px`;
    this.box.style.top = `${Math.max(POPUP_GAP_PIXELS, top)}px`;
  }
}

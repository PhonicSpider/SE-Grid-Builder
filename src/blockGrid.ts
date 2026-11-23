// The block menu: a grid of picture tiles, each showing the game's icon for the
// block with its name on it. Like the game, a block and its shape variants
// (slopes, corners, ...) share ONE tile; hovering it lists the shapes.
//
// The grid refills the available width, so it reflows when the side panel is
// resized (that is done with CSS: `grid-template-columns: repeat(auto-fill, ...)`).
// Icons load only when a tile scrolls into view.

import type { BlockInfo } from "./catalog";
import type { BlockTile } from "./blockGroups";
import { loadGameIcon } from "./blockIcons";
import { VariantPopup } from "./variantViews";

export class BlockGrid {
  private tiles: Array<{ tile: BlockTile; element: HTMLButtonElement }> = [];
  private visibilityWatcher: IntersectionObserver;
  private popup = new VariantPopup();

  constructor(
    private container: HTMLElement,
    private onSelect: (block: BlockInfo) => void,
  ) {
    // Fires when a tile comes near the visible area. `root` is the scrolling
    // grid itself, and `rootMargin` starts loading a little before it shows.
    this.visibilityWatcher = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.visibilityWatcher.unobserve(entry.target);
          void this.fillIcon(entry.target as HTMLButtonElement);
        }
      },
      { root: container, rootMargin: "240px" },
    );
  }

  /** Replaces the tiles with the given ones, in the order given. */
  show(tiles: BlockTile[], selected: BlockInfo | null): void {
    this.visibilityWatcher.disconnect();
    this.popup.hide();
    this.tiles = tiles.map((tile) => ({ tile, element: this.makeTile(tile) }));
    this.container.replaceChildren(...this.tiles.map((entry) => entry.element));
    this.container.scrollTop = 0;
    this.markSelected(selected);
    for (const entry of this.tiles) this.visibilityWatcher.observe(entry.element);
  }

  /** Highlights the tile holding the selected block (or none). */
  markSelected(selected: BlockInfo | null): void {
    for (const { tile, element } of this.tiles) {
      const isSelected = selected !== null && tile.variants.includes(selected);
      element.classList.toggle("selected", isSelected);
      element.setAttribute("aria-pressed", String(isSelected));
    }
  }

  private makeTile(entry: BlockTile): HTMLButtonElement {
    const block = entry.block;
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "tile";
    if (entry.variants.length > 1) {
      // A group: hovering lists its shapes in a pop-up beside the cursor.
      let pointer = { x: 0, y: 0 };
      tile.addEventListener("pointerenter", (event) => {
        pointer = { x: event.clientX, y: event.clientY };
        this.popup.showSoon(entry.variants, () => pointer);
      });
      tile.addEventListener("pointermove", (event) => {
        pointer = { x: event.clientX, y: event.clientY };
      });
      tile.addEventListener("pointerleave", () => this.popup.hide());
    } else {
      // Hovering shows the exact internal name, useful when searching.
      tile.dataset.tooltip = `${block.display_name || block.subtype_id}\n${block.subtype_id || block.type_id} · ${block.size.join("×")}`;
    }

    const picture = document.createElement("img");
    picture.alt = "";
    picture.draggable = false;

    const label = document.createElement("span");
    label.className = "tile-name";
    label.textContent = block.display_name || block.subtype_id || block.type_id;

    tile.append(picture, label);
    tile.addEventListener("click", () => this.onSelect(block));
    return tile;
  }

  private async fillIcon(tile: HTMLButtonElement): Promise<void> {
    const entry = this.tiles.find((candidate) => candidate.element === tile);
    if (!entry) return;
    const address = await loadGameIcon(entry.tile.block.icon);
    const picture = tile.querySelector("img");
    if (address && picture) {
      picture.src = address;
      tile.classList.add("has-icon");
    }
  }
}

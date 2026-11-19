// The block menu: a grid of picture tiles, each showing the game's icon for the
// block with its name on it.
//
// The grid refills the available width, so it reflows when the side panel is
// resized (that is done with CSS: `grid-template-columns: repeat(auto-fill, ...)`).
// Icons load only when a tile scrolls into view.

import type { BlockInfo } from "./catalog";
import { loadGameIcon } from "./blockIcons";

export class BlockGrid {
  private tiles: Array<{ block: BlockInfo; element: HTMLButtonElement }> = [];
  private visibilityWatcher: IntersectionObserver;

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

  /** Replaces the tiles with the given blocks, in the order given. */
  show(blocks: BlockInfo[], selected: BlockInfo | null): void {
    this.visibilityWatcher.disconnect();
    this.tiles = blocks.map((block) => ({ block, element: this.makeTile(block) }));
    this.container.replaceChildren(...this.tiles.map((tile) => tile.element));
    this.container.scrollTop = 0;
    this.markSelected(selected);
    for (const tile of this.tiles) this.visibilityWatcher.observe(tile.element);
  }

  /** Highlights the tile of the selected block (or none). */
  markSelected(selected: BlockInfo | null): void {
    for (const tile of this.tiles) {
      tile.element.classList.toggle("selected", tile.block === selected);
      tile.element.setAttribute("aria-pressed", String(tile.block === selected));
    }
  }

  private makeTile(block: BlockInfo): HTMLButtonElement {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "tile";
    // Hovering shows the exact internal name, useful when searching.
    tile.dataset.tooltip = `${block.display_name || block.subtype_id}\n${block.subtype_id || block.type_id} · ${block.size.join("×")}`;

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
    const address = await loadGameIcon(entry.block.icon);
    const picture = tile.querySelector("img");
    if (address && picture) {
      picture.src = address;
      tile.classList.add("has-icon");
    }
  }
}

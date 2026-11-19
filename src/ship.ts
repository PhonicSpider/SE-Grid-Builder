// The ship being built: which blocks sit in which grid cells, and undo.
//
// A ship lives on a grid of cells. Every block has a "position" (the lowest
// corner cell it covers, called `Min` in the game's file) and an orientation.
// A block bigger than one cell covers several cells. No two blocks may share a
// cell, and a ship uses either the Large grid or the Small grid, never both.

import type { BlockInfo } from "./catalog";
import type { PaintColor } from "./color";
import { footprint, type Orientation, type Vector } from "./orientation";

export type GridSize = "Large" | "Small";

export interface PlacedBlock {
  id: number;
  info: BlockInfo;
  position: Vector;
  orientation: Orientation;
  color: PaintColor;
  /** Armor skin subtype such as "Battered_Armor", or null for no skin. */
  skin: string | null;
}

/** A block to place, before it has an id (used when a whole ship is loaded at once). */
export type NewBlock = Omit<PlacedBlock, "id">;

/** What a repaint changes. Leave a part out to keep the block's current value. */
export interface PaintChange {
  color?: PaintColor;
  skin?: string | null;
}

/** Turns a cell into a text key so it can be used in a Map. */
function cellKey(cell: Vector): string {
  return `${cell[0]},${cell[1]},${cell[2]}`;
}

export class Ship {
  gridSize: GridSize = "Large";

  /** Called after every change so the viewport and menu can refresh. */
  onChange: () => void = () => {};

  private blocksById = new Map<number, PlacedBlock>();
  private blockIdByCell = new Map<string, number>();
  private nextId = 1;
  // Each undo step is a function that reverses one earlier change.
  private undoSteps: Array<() => void> = [];
  // While a group is open, undo steps collect here instead of in `undoSteps`.
  private openGroup: Array<() => void> | null = null;

  get count(): number {
    return this.blocksById.size;
  }

  list(): PlacedBlock[] {
    return [...this.blocksById.values()];
  }

  blockById(id: number): PlacedBlock | undefined {
    return this.blocksById.get(id);
  }

  blockAtCell(cell: Vector): PlacedBlock | undefined {
    const id = this.blockIdByCell.get(cellKey(cell));
    return id === undefined ? undefined : this.blocksById.get(id);
  }

  /** Every cell a block would cover if placed here. */
  cellsCovered(info: BlockInfo, position: Vector, orientation: Orientation): Vector[] {
    const [width, height, depth] = footprint(info.size, orientation);
    const cells: Vector[] = [];
    for (let xOffset = 0; xOffset < width; xOffset++) {
      for (let yOffset = 0; yOffset < height; yOffset++) {
        for (let zOffset = 0; zOffset < depth; zOffset++) {
          cells.push([position[0] + xOffset, position[1] + yOffset, position[2] + zOffset]);
        }
      }
    }
    return cells;
  }

  canPlace(info: BlockInfo, position: Vector, orientation: Orientation): boolean {
    if (info.cube_size !== this.gridSize) return false;
    return this.cellsCovered(info, position, orientation).every(
      (cell) => !this.blockIdByCell.has(cellKey(cell)),
    );
  }

  /** Adds a block. Returns it, or null when the spot is not allowed. */
  place(
    info: BlockInfo,
    position: Vector,
    orientation: Orientation,
    color: PaintColor,
    skin: string | null = null,
  ): PlacedBlock | null {
    if (!this.canPlace(info, position, orientation)) return null;

    const block: PlacedBlock = { id: this.nextId++, info, position, orientation, color, skin };
    this.insert(block);
    this.recordUndo(() => this.delete(block.id));
    this.notifyChange();
    return block;
  }

  remove(id: number): void {
    const block = this.blocksById.get(id);
    if (!block) return;
    this.delete(id);
    this.recordUndo(() => this.insert(block)); // put the same block back
    this.notifyChange();
  }

  /** Repaints a block's color and/or skin. */
  paint(id: number, change: PaintChange): void {
    const block = this.blocksById.get(id);
    if (!block) return;
    const previousColor = block.color;
    const previousSkin = block.skin;
    if (change.color !== undefined) block.color = change.color;
    if (change.skin !== undefined) block.skin = change.skin;
    this.recordUndo(() => {
      block.color = previousColor;
      block.skin = previousSkin;
    });
    this.notifyChange();
  }

  /**
   * Runs several changes (a whole filled floor, say) as ONE undo step, with one
   * refresh at the end instead of one per block. Used by the drag-to-fill tools.
   */
  runAsOneStep(action: () => void): void {
    if (this.openGroup) {
      action(); // already inside a group: join it
      return;
    }
    this.openGroup = [];
    try {
      action();
    } finally {
      const steps = this.openGroup;
      this.openGroup = null;
      if (steps.length > 0) {
        // Undo in the reverse of the order things happened.
        this.undoSteps.push(() => {
          for (const step of [...steps].reverse()) step();
        });
      }
      this.notifyChange();
    }
  }

  /** Reverses the most recent change. Returns false when there is nothing to undo. */
  undo(): boolean {
    const step = this.undoSteps.pop();
    if (!step) return false;
    step();
    this.onChange();
    return true;
  }

  /**
   * Replaces the whole ship (and its grid size) with the given blocks, as ONE
   * undo step: Ctrl+Z brings the old ship back, grid size included. Blocks that
   * overlap an earlier one, or whose size does not fit the grid, are skipped.
   */
  replaceAll(gridSize: GridSize, blocks: NewBlock[]): { placed: number; didNotFit: number } {
    const previousBlocks = this.list();
    const previousGridSize = this.gridSize;

    this.blocksById.clear();
    this.blockIdByCell.clear();
    this.gridSize = gridSize;

    let placed = 0;
    let didNotFit = 0;
    for (const entry of blocks) {
      if (!this.canPlace(entry.info, entry.position, entry.orientation)) {
        didNotFit++;
        continue;
      }
      this.insert({ ...entry, id: this.nextId++ });
      placed++;
    }

    this.undoSteps.push(() => {
      for (const block of this.list()) this.delete(block.id);
      for (const block of previousBlocks) this.insert(block);
      this.gridSize = previousGridSize;
    });
    this.notifyChange();
    return { placed, didNotFit };
  }

  /** The grid size can only change while the ship is empty. */
  setGridSize(size: GridSize): boolean {
    if (this.count > 0) return false;
    this.gridSize = size;
    this.onChange();
    return true;
  }

  clear(): void {
    this.blocksById.clear();
    this.blockIdByCell.clear();
    this.undoSteps = [];
    this.onChange();
  }

  /** Remembers how to reverse a change: in the open group, or as its own step. */
  private recordUndo(step: () => void): void {
    (this.openGroup ?? this.undoSteps).push(step);
  }

  /** Refreshes the screen, except while a group is open (it refreshes once at the end). */
  private notifyChange(): void {
    if (!this.openGroup) this.onChange();
  }

  // The two helpers below change the data without recording undo steps.
  private insert(block: PlacedBlock): void {
    this.blocksById.set(block.id, block);
    for (const cell of this.cellsCovered(block.info, block.position, block.orientation)) {
      this.blockIdByCell.set(cellKey(cell), block.id);
    }
  }

  private delete(id: number): void {
    const block = this.blocksById.get(id);
    if (!block) return;
    for (const cell of this.cellsCovered(block.info, block.position, block.orientation)) {
      this.blockIdByCell.delete(cellKey(cell));
    }
    this.blocksById.delete(id);
  }
}

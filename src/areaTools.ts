// The math behind Shift + drag (floors) and Ctrl + drag (walls): which cells a dragged rectangle covers and where
// blocks go to fill it. Pure functions with no drawing, so they are easy to test.
//
// A dragged area is FLAT and ONE block deep: it lies on a single layer of the
// grid. `axis` says which way the layer faces (0 = x, 1 = y, 2 = z) and `layer`
// is the layer's number along that axis. A floor is a layer across y (axis 1);
// a wall is a layer across x or z. The rectangle spreads along the other two
// axes, called "first" and "second" below.

import type { Vector } from "./orientation";

/**
 * For a layer across axis 0 (x), 1 (y) or 2 (z), the two axes the rectangle
 * spreads along. A floor is across y, so it spreads along x and z.
 */
export const IN_PLANE_AXES: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [0, 2],
  [0, 1],
];

/** What a modifier-drag makes: Shift gives a floor, Ctrl gives a wall. */
export type AreaShape = "floor" | "wall";

/**
 * Which way the dragged layer faces (0 = x, 1 = y, 2 = z).
 *
 * A floor always lies across y, wherever on the ship the drag started. A wall
 * stands across x or z: it follows the face that was clicked when that face is
 * a side face. When the click was on a top, bottom or floor face (which would
 * otherwise give a floor), it picks the wall that faces the camera most, so the
 * wall is the one the player can see.
 *
 * `viewDirection` is the way the camera looks, as [x, y, z].
 */
export function dragAxisFor(shape: AreaShape, faceAxis: number, viewDirection: Vector): number {
  if (shape === "floor") return 1;
  if (faceAxis !== 1) return faceAxis;
  return Math.abs(viewDirection[0]) >= Math.abs(viewDirection[2]) ? 0 : 2;
}

/** The corners of a dragged rectangle, in cells along the two in-plane axes. */
export interface AreaBounds {
  minFirst: number;
  maxFirst: number;
  minSecond: number;
  maxSecond: number;
}

/** The rectangle between where the drag started and where it is now (either may be the lower corner). */
export function boundsOfDrag(anchor: readonly [number, number], current: readonly [number, number]): AreaBounds {
  return {
    minFirst: Math.min(anchor[0], current[0]),
    maxFirst: Math.max(anchor[0], current[0]),
    minSecond: Math.min(anchor[1], current[1]),
    maxSecond: Math.max(anchor[1], current[1]),
  };
}

/** Builds a cell position from a layer number and two in-plane numbers. */
function cellAt(axis: number, layer: number, first: number, second: number): Vector {
  const [firstAxis, secondAxis] = IN_PLANE_AXES[axis];
  const cell: Vector = [0, 0, 0];
  cell[axis] = layer;
  cell[firstAxis] = first;
  cell[secondAxis] = second;
  return cell;
}

/** Every cell of the rectangle. */
export function cellsInLayer(axis: number, layer: number, bounds: AreaBounds): Vector[] {
  const cells: Vector[] = [];
  for (let first = bounds.minFirst; first <= bounds.maxFirst; first++) {
    for (let second = bounds.minSecond; second <= bounds.maxSecond; second++) {
      cells.push(cellAt(axis, layer, first, second));
    }
  }
  return cells;
}

/**
 * Where blocks go to fill the rectangle, laid out edge to edge.
 *
 * `blockSize` is how many cells the block covers along each world axis (after
 * rotating). A block bigger than one cell steps by its own size, so a 3x3x3
 * block fills a 9x6 area with 3 x 2 blocks. At least one block is always tried,
 * even if the rectangle is smaller than the block, so a plain click still places one.
 *
 * Returns each block's lowest corner, and the total size of the filled box.
 */
export function fillLayout(
  axis: number,
  layer: number,
  bounds: AreaBounds,
  blockSize: Vector,
): { positions: Vector[]; size: Vector } {
  const [firstAxis, secondAxis] = IN_PLANE_AXES[axis];
  const columns = Math.max(1, Math.floor((bounds.maxFirst - bounds.minFirst + 1) / blockSize[firstAxis]));
  const rows = Math.max(1, Math.floor((bounds.maxSecond - bounds.minSecond + 1) / blockSize[secondAxis]));

  const positions: Vector[] = [];
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      positions.push(
        cellAt(axis, layer, bounds.minFirst + column * blockSize[firstAxis], bounds.minSecond + row * blockSize[secondAxis]),
      );
    }
  }

  const size: Vector = [0, 0, 0];
  size[axis] = blockSize[axis];
  size[firstAxis] = columns * blockSize[firstAxis];
  size[secondAxis] = rows * blockSize[secondAxis];
  return { positions, size };
}

// Where a block's 3D model goes in the scene.
//
// The game draws a model with its origin at the middle of the block's cells,
// in the block's own axes, in meters, shifted by the definition's
// "ModelOffset". (Checked on all 1,426 block models: 98% fit inside their
// block and are centered on that origin.) The scene counts in grid cells, so
// the model is also scaled from meters to cells.

import type { BlockInfo } from "./catalog";
import { footprint, orientationAxes, type Orientation, type Vector } from "./orientation";

/** How long one grid cell is, in meters. */
const CELL_METERS: Record<string, number> = { Large: 2.5, Small: 0.5 };

export interface BlockPlacement {
  /** The middle of the block in grid cells. */
  center: Vector;
  /** Where the block's own x (right), y (up) and z (back) axes point in the world. */
  right: Vector;
  up: Vector;
  backward: Vector;
  /** Multiply meters by this to get grid cells. */
  cellsPerMeter: number;
  /** The definition's model offset, in meters, in the block's own axes. */
  offsetMeters: Vector;
}

export function placementOf(info: BlockInfo, position: Vector, orientation: Orientation): BlockPlacement {
  const [width, height, depth] = footprint(info.size, orientation);
  const cellMeters = CELL_METERS[info.cube_size] ?? CELL_METERS.Large;
  const { right, up, backward } = orientationAxes(orientation);
  return {
    center: [position[0] + width / 2, position[1] + height / 2, position[2] + depth / 2],
    right,
    up,
    backward,
    cellsPerMeter: 1 / cellMeters,
    offsetMeters: info.model_offset,
  };
}

/**
 * The 4x4 matrix (16 numbers, column by column, as three.js wants them) that
 * turns model coordinates in meters into scene coordinates in cells.
 */
export function placementMatrix(placement: BlockPlacement): number[] {
  const { right, up, backward, cellsPerMeter, offsetMeters, center } = placement;
  // The offset is in the block's own axes, so turn it into the world first.
  const shift: Vector = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    shift[axis] =
      (right[axis] * offsetMeters[0] + up[axis] * offsetMeters[1] + backward[axis] * offsetMeters[2]) * cellsPerMeter;
  }
  return [
    right[0] * cellsPerMeter, right[1] * cellsPerMeter, right[2] * cellsPerMeter, 0,
    up[0] * cellsPerMeter, up[1] * cellsPerMeter, up[2] * cellsPerMeter, 0,
    backward[0] * cellsPerMeter, backward[1] * cellsPerMeter, backward[2] * cellsPerMeter, 0,
    center[0] + shift[0], center[1] + shift[1], center[2] + shift[2], 1,
  ];
}

import { describe, expect, it } from "vitest";
import type { BlockInfo } from "./catalog";
import { originOnFace, placementMatrix, placementOf } from "./blockPlacement";
import { DEFAULT_ORIENTATION, rotatePitch, rotateRoll, rotateYaw, type Orientation } from "./orientation";

function block(size: [number, number, number], cubeSize = "Large", offset: [number, number, number] = [0, 0, 0]): BlockInfo {
  return {
    type_id: "CubeBlock",
    subtype_id: "Test",
    display_name: "Test",
    categories: [],
    category_positions: [],
    definition_order: 0,
    grid_position: null,
    variant_group: null,
    variant_position: 0,
    cube_size: cubeSize,
    size,
    icon: null,
    shown_in_game_menu: true,
    model: "Models\\Test.mwm",
    model_offset: offset,
    cube_topology: null,
    side_models: [],
  };
}

/** All 24 orientations, found by turning, tipping and rolling from the default. */
function allOrientations(): Orientation[] {
  const seen = new Map<string, Orientation>();
  const queue = [DEFAULT_ORIENTATION];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const key = `${current.forward}/${current.up}`;
    if (seen.has(key)) continue;
    seen.set(key, current);
    queue.push(rotateYaw(current), rotatePitch(current), rotateRoll(current));
  }
  return [...seen.values()];
}

describe("placementOf", () => {
  it("puts a 1x1x1 large block's model in the middle of its cell, 2.5 m per cell", () => {
    const placement = placementOf(block([1, 1, 1]), [0, 0, 0], DEFAULT_ORIENTATION);
    expect(placement.center).toEqual([0.5, 0.5, 0.5]);
    expect(placement.cellsPerMeter).toBeCloseTo(0.4);
  });

  it("uses 0.5 m cells for the small grid", () => {
    expect(placementOf(block([1, 1, 1], "Small"), [0, 0, 0], DEFAULT_ORIENTATION).cellsPerMeter).toBeCloseTo(2);
  });

  it("centres a big block on its whole footprint, and follows the rotated footprint", () => {
    expect(placementOf(block([3, 3, 3]), [10, 0, -3], DEFAULT_ORIENTATION).center).toEqual([11.5, 1.5, -1.5]);
    // 2 wide, 1 high, 3 deep, turned a quarter: now 3 wide and 2 deep.
    expect(placementOf(block([2, 1, 3]), [0, 0, 0], rotateYaw(DEFAULT_ORIENTATION)).center).toEqual([1.5, 0.5, 1]);
  });
});

describe("placementMatrix", () => {
  it("is a plain scale and move for the default orientation", () => {
    const matrix = placementMatrix(placementOf(block([1, 1, 1]), [2, 0, 0], DEFAULT_ORIENTATION));
    // `+ 0` turns a harmless negative zero into a plain zero, which the comparison needs.
    expect(matrix.slice(0, 3).map((value) => value + 0)).toEqual([0.4, 0, 0]); // x axis, scaled to cells
    expect(matrix.slice(12, 15)).toEqual([2.5, 0.5, 0.5]); // moved to the cell's middle
  });

  it("shifts the model by its offset in the block's own axes, then in cells", () => {
    // The game's offset (0, 2.5, 0) m is one cell up for a large block.
    const upright = placementMatrix(placementOf(block([1, 1, 1], "Large", [0, 2.5, 0]), [0, 0, 0], DEFAULT_ORIENTATION));
    expect(upright.slice(12, 15)).toEqual([0.5, 1.5, 0.5]);
    // Turned a quarter, "up" is still up, so the shift is still vertical.
    const turned = placementMatrix(
      placementOf(block([1, 1, 1], "Large", [0, 2.5, 0]), [0, 0, 0], rotateYaw(DEFAULT_ORIENTATION)),
    );
    expect(turned.slice(12, 15)).toEqual([0.5, 1.5, 0.5]);
  });

  it("never mirrors a model: every orientation is a proper rotation (determinant +1)", () => {
    const orientations = allOrientations();
    expect(orientations).toHaveLength(24);
    for (const orientation of orientations) {
      const matrix = placementMatrix({ ...placementOf(block([1, 1, 1]), [0, 0, 0], orientation), cellsPerMeter: 1 });
      const [rx, ry, rz, , ux, uy, uz, , bx, by, bz] = matrix;
      // determinant of the 3x3 rotation part
      const determinant = rx * (uy * bz - uz * by) - ry * (ux * bz - uz * bx) + rz * (ux * by - uy * bx);
      expect(determinant).toBeCloseTo(1);
    }
  });
});

describe("originOnFace", () => {
  it("leaves a one-cell block on the cell next to the face", () => {
    expect(originOnFace([4, 2, 7], 0, 1, [1, 1, 1])).toEqual([4, 2, 7]);
    expect(originOnFace([4, 2, 7], 0, -1, [1, 1, 1])).toEqual([4, 2, 7]);
  });

  it("grows a big block away from a face that points to higher numbers", () => {
    // Clicked the +x face of a block, so the cell next door is x = 5; the
    // 3-wide block must start there and fill x = 5, 6, 7.
    expect(originOnFace([5, 0, 0], 0, 1, [3, 1, 1])).toEqual([5, 0, 0]);
  });

  it("moves a big block back from a face that points to lower numbers", () => {
    // Clicked the -x face, so the cell next door is x = 2. The block must
    // fill x = 0, 1, 2 instead of growing back into the block at x = 3.
    expect(originOnFace([2, 0, 0], 0, -1, [3, 1, 1])).toEqual([0, 0, 0]);
    expect(originOnFace([4, 6, 0], 1, -1, [1, 3, 1])).toEqual([4, 4, 0]);
  });

  it("centers a big block on the cell under the cursor along the other axes", () => {
    // A 3x3x3 block placed on the top face: x and z are centered, y is not.
    expect(originOnFace([10, 4, 10], 1, 1, [3, 3, 3])).toEqual([9, 4, 9]);
    // An even size cannot be centered exactly; it leans one cell toward lower numbers.
    expect(originOnFace([10, 4, 10], 1, 1, [2, 1, 2])).toEqual([10, 4, 10]);
    expect(originOnFace([10, 4, 10], 1, 1, [4, 1, 4])).toEqual([9, 4, 9]);
  });
});

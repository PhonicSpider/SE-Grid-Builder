import { describe, expect, it } from "vitest";
import { boundsOfDrag, cellsInLayer, dragAxisFor, fillLayout } from "./areaTools";

describe("dragAxisFor", () => {
  it("a floor is always across y, whatever face was clicked", () => {
    for (const faceAxis of [0, 1, 2]) expect(dragAxisFor("floor", faceAxis, [1, -1, 0])).toBe(1);
  });

  it("a wall follows a clicked side face", () => {
    expect(dragAxisFor("wall", 0, [0, -1, 1])).toBe(0);
    expect(dragAxisFor("wall", 2, [1, -1, 0])).toBe(2);
  });

  it("a wall started on a top face faces the camera along x or z", () => {
    expect(dragAxisFor("wall", 1, [0.9, -0.5, 0.1])).toBe(0); // looking mostly along x
    expect(dragAxisFor("wall", 1, [0.1, -0.5, -0.9])).toBe(2); // looking mostly along z
  });
});

describe("boundsOfDrag", () => {
  it("finds the corners whichever way the drag goes", () => {
    expect(boundsOfDrag([2, 5], [6, 1])).toEqual({ minFirst: 2, maxFirst: 6, minSecond: 1, maxSecond: 5 });
    expect(boundsOfDrag([6, 1], [2, 5])).toEqual({ minFirst: 2, maxFirst: 6, minSecond: 1, maxSecond: 5 });
  });

  it("a click without movement is a one-cell area", () => {
    expect(boundsOfDrag([3, 3], [3, 3])).toEqual({ minFirst: 3, maxFirst: 3, minSecond: 3, maxSecond: 3 });
  });
});

describe("cellsInLayer", () => {
  it("lists a floor (a layer across y) with y fixed", () => {
    const cells = cellsInLayer(1, 4, { minFirst: 0, maxFirst: 2, minSecond: 10, maxSecond: 11 });
    expect(cells).toHaveLength(6);
    expect(cells.every((cell) => cell[1] === 4)).toBe(true);
    expect(cells).toContainEqual([2, 4, 11]);
  });

  it("lists a wall across x with x fixed; the area spreads along y and z", () => {
    const cells = cellsInLayer(0, -2, { minFirst: 0, maxFirst: 1, minSecond: 5, maxSecond: 5 });
    expect(cells).toEqual([[-2, 0, 5], [-2, 1, 5]]);
  });

  it("lists a wall across z with z fixed; the area spreads along x and y", () => {
    const cells = cellsInLayer(2, 7, { minFirst: 3, maxFirst: 3, minSecond: 0, maxSecond: 1 });
    expect(cells).toEqual([[3, 0, 7], [3, 1, 7]]);
  });
});

describe("fillLayout", () => {
  it("fills a 5 by 4 floor with 20 single blocks", () => {
    const { positions, size } = fillLayout(1, 0, { minFirst: 0, maxFirst: 4, minSecond: 0, maxSecond: 3 }, [1, 1, 1]);
    expect(positions).toHaveLength(20);
    expect(size).toEqual([5, 1, 4]);
  });

  it("steps by the block's own size: 3x3x3 blocks over a 9 by 6 floor make 3 by 2 blocks", () => {
    const { positions, size } = fillLayout(1, 2, { minFirst: 0, maxFirst: 8, minSecond: 0, maxSecond: 5 }, [3, 3, 3]);
    expect(positions).toHaveLength(6);
    expect(size).toEqual([9, 3, 6]);
    expect(positions).toContainEqual([6, 2, 3]);
  });

  it("always tries one block, even in an area smaller than the block", () => {
    const { positions, size } = fillLayout(1, 0, { minFirst: 5, maxFirst: 5, minSecond: 5, maxSecond: 5 }, [3, 3, 3]);
    expect(positions).toEqual([[5, 0, 5]]);
    expect(size).toEqual([3, 3, 3]);
  });

  it("leaves leftover cells empty rather than placing a block that would overhang", () => {
    // A 4-wide strip fits one 3-wide block, not two.
    const { positions } = fillLayout(1, 0, { minFirst: 0, maxFirst: 3, minSecond: 0, maxSecond: 2 }, [3, 1, 3]);
    expect(positions).toEqual([[0, 0, 0]]);
  });

  it("lays long blocks edge to edge with no overlap", () => {
    const blockSize: [number, number, number] = [2, 1, 1];
    const { positions } = fillLayout(1, 0, { minFirst: 0, maxFirst: 5, minSecond: 0, maxSecond: 2 }, blockSize);
    expect(positions).toHaveLength(9); // 3 across, 3 down
    const covered = new Set<string>();
    for (const [x, y, z] of positions) {
      for (let cell = 0; cell < blockSize[0]; cell++) {
        const key = `${x + cell},${y},${z}`;
        expect(covered.has(key)).toBe(false); // no cell is used twice
        covered.add(key);
      }
    }
    expect(covered.size).toBe(18);
  });

  it("works on a wall too", () => {
    // A wall across z (axis 2) spreads along x and y.
    const { positions, size } = fillLayout(2, 9, { minFirst: 0, maxFirst: 2, minSecond: 0, maxSecond: 1 }, [1, 1, 1]);
    expect(positions).toHaveLength(6);
    expect(positions.every((position) => position[2] === 9)).toBe(true);
    expect(size).toEqual([3, 2, 1]);
  });
});

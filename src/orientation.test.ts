import { describe, expect, it } from "vitest";
import { DEFAULT_ORIENTATION, footprint, rotatePitch, rotateRoll, rotateYaw, type Orientation } from "./orientation";

/** Every distinct orientation reachable by repeated turns, tips and rolls. */
function reachableOrientations(): Set<string> {
  const seen = new Set<string>();
  const queue: Orientation[] = [DEFAULT_ORIENTATION];
  while (queue.length > 0) {
    const current = queue.pop()!;
    const key = `${current.forward}/${current.up}`;
    if (seen.has(key)) continue;
    seen.add(key);
    queue.push(rotateYaw(current), rotatePitch(current), rotateRoll(current));
  }
  return seen;
}

describe("orientation", () => {
  it("reaches exactly the 24 valid orientations", () => {
    expect(reachableOrientations().size).toBe(24);
  });

  it("never points forward and up along the same axis", () => {
    const axisOf = (name: string) =>
      ({ Left: "x", Right: "x", Up: "y", Down: "y", Forward: "z", Backward: "z" })[name];
    for (const key of reachableOrientations()) {
      const [forward, up] = key.split("/");
      expect(axisOf(forward)).not.toBe(axisOf(up));
    }
  });

  it("four turns return to the start", () => {
    let orientation = DEFAULT_ORIENTATION;
    for (let turn = 0; turn < 4; turn++) orientation = rotateYaw(orientation);
    expect(orientation).toEqual(DEFAULT_ORIENTATION);
  });
});

// Real data from the game: "SSB Test Ship_2", saved by Space Engineers on 2026-11-18
// after blocks were placed in assorted directions. Block sizes come from the
// game's own definitions; every block below sits in the position the game saved.
describe("footprint against the game's own save", () => {
  const cases: Array<[string, [number, number, number], Orientation, [number, number, number]]> = [
    ["Large Refinery, front up", [2, 4, 2], { forward: "Up", up: "Backward" }, [2, 2, 4]],
    ["Oxygen Generator, front down", [1, 2, 1], { forward: "Down", up: "Forward" }, [1, 1, 2]],
    ["Stator, front up", [1, 2, 1], { forward: "Up", up: "Backward" }, [1, 1, 2]],
    ["Landing Gear, backward", [1, 2, 3], { forward: "Backward", up: "Up" }, [1, 2, 3]],
    ["Drill, default", [1, 1, 3], DEFAULT_ORIENTATION, [1, 1, 3]],
  ];

  for (const [name, size, orientation, expected] of cases) {
    it(`${name}`, () => {
      expect(footprint(size, orientation)).toEqual(expected);
    });
  }

  it("two refineries placed end to end by the game leave no gap and no overlap", () => {
    // The game saved them at z = 3 and z = 7. Each covers 4 cells along z.
    const [, , depth] = footprint([2, 4, 2], { forward: "Up", up: "Backward" });
    expect(7 - 3).toBe(depth);
  });
});

describe("footprint", () => {
  it("keeps the size when facing the default way", () => {
    expect(footprint([2, 3, 4], DEFAULT_ORIENTATION)).toEqual([2, 3, 4]);
  });

  it("swaps width and depth after a quarter turn", () => {
    expect(footprint([2, 3, 4], rotateYaw(DEFAULT_ORIENTATION))).toEqual([4, 3, 2]);
  });

  it("keeps the same number of cells in every orientation", () => {
    for (const key of reachableOrientations()) {
      const [forward, up] = key.split("/") as [Orientation["forward"], Orientation["up"]];
      const [width, height, depth] = footprint([2, 3, 4], { forward, up });
      expect(width * height * depth).toBe(24);
    }
  });
});

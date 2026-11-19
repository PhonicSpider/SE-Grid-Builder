import { describe, expect, it } from "vitest";
import type { BlockInfo } from "./catalog";
import { fadeStateFor, viewGroupOf } from "./viewGroups";

function block(overrides: Partial<BlockInfo>): BlockInfo {
  return {
    type_id: "CubeBlock",
    subtype_id: "Test",
    display_name: "Test",
    categories: [],
    category_positions: [],
    cube_size: "Large",
    size: [1, 1, 1],
    icon: null,
    shown_in_game_menu: true,
    model: null,
    model_offset: [0, 0, 0],
    cube_topology: null,
    side_models: [],
    ...overrides,
  };
}

describe("viewGroupOf", () => {
  it("treats blocks built from side plates as armor, even when not in the menu", () => {
    expect(viewGroupOf(block({ cube_topology: "Slope", shown_in_game_menu: false }))).toBe("armor");
  });

  it("treats blocks in an armor category as armor", () => {
    expect(viewGroupOf(block({ categories: ["Section1_Position2_Armorblocks"] }))).toBe("armor");
  });

  it("treats every plain CubeBlock as structure: beams, windows, trusses and the like", () => {
    // Real examples: GridBeamBlock and a window are plain CubeBlocks with their own models.
    expect(viewGroupOf(block({ subtype_id: "LargeGridBeamBlock", model: "Models\\Cubes\\Large\\GridBeam.mwm" }))).toBe("armor");
    expect(viewGroupOf(block({ type_id: "MyObjectBuilder_CubeBlock", subtype_id: "LargeWindowSquare", model: "x.mwm" }))).toBe("armor");
  });

  it("leaves machinery in the other group", () => {
    expect(viewGroupOf(block({ type_id: "Reactor", model: "Models\\Reactor.mwm", categories: ["Power"] }))).toBe("other");
  });
});

describe("fadeStateFor", () => {
  it("is plain and solid at full opacity", () => {
    expect(fadeStateFor(1)).toEqual({ visible: true, transparent: false, depthWrite: true, opacity: 1 });
  });

  it("blends and stops writing depth when partly faded", () => {
    expect(fadeStateFor(0.3)).toEqual({ visible: true, transparent: true, depthWrite: false, opacity: 0.3 });
  });

  it("is not drawn at zero", () => {
    expect(fadeStateFor(0).visible).toBe(false);
  });

  it("clamps bad values", () => {
    expect(fadeStateFor(5).opacity).toBe(1);
    expect(fadeStateFor(-2).opacity).toBe(0);
    expect(fadeStateFor(Number.NaN).opacity).toBe(1);
  });
});

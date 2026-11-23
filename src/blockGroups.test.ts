import { describe, expect, it } from "vitest";
import { groupBlocks, variantsOf } from "./blockGroups";
import type { BlockInfo } from "./catalog";

function block(subtype: string, overrides: Partial<BlockInfo> = {}): BlockInfo {
  return {
    type_id: "CubeBlock",
    subtype_id: subtype,
    display_name: subtype,
    categories: [],
    category_positions: [],
    definition_order: 0,
    grid_position: null,
    variant_group: null,
    variant_position: 0,
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

describe("groupBlocks", () => {
  it("makes one tile for a group, led by its first block", () => {
    const tiles = groupBlocks([
      block("Slope", { variant_group: "G", variant_position: 1 }),
      block("Cube", { variant_group: "G", variant_position: 0 }),
    ]);
    expect(tiles).toHaveLength(1);
    expect(tiles[0].block.subtype_id).toBe("Cube");
    expect(tiles[0].variants.map((entry) => entry.subtype_id)).toEqual(["Cube", "Slope"]);
  });

  it("keeps blocks without a group as their own tiles", () => {
    expect(groupBlocks([block("A"), block("B")])).toHaveLength(2);
  });

  it("does not mix grid sizes in one group", () => {
    const tiles = groupBlocks([
      block("Large", { variant_group: "G" }),
      block("Small", { variant_group: "G", cube_size: "Small" }),
    ]);
    expect(tiles).toHaveLength(2);
  });

  it("takes the lowest grid position of the group", () => {
    const tiles = groupBlocks([
      block("Cube", { variant_group: "G", variant_position: 0 }),
      block("Slope", { variant_group: "G", variant_position: 1, grid_position: 4 }),
    ]);
    expect(tiles[0].gridPosition).toBe(4);
  });
});

describe("variantsOf", () => {
  it("lists the group's blocks in order, or just the block if it stands alone", () => {
    const cube = block("Cube", { variant_group: "G", variant_position: 0 });
    const slope = block("Slope", { variant_group: "G", variant_position: 1 });
    const alone = block("Alone");
    const all = [slope, cube, alone];
    expect(variantsOf(slope, all)).toEqual([cube, slope]);
    expect(variantsOf(alone, all)).toEqual([alone]);
  });
});

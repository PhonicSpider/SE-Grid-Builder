import { describe, expect, it } from "vitest";
import { groupBlocks } from "./blockGroups";
import { sortLikeTheGame as sortTiles } from "./blockOrder";
import type { BlockInfo } from "./catalog";

function block(subtype: string, overrides: Partial<BlockInfo> = {}): BlockInfo {
  return {
    type_id: "CubeBlock",
    subtype_id: subtype,
    display_name: subtype,
    categories: ["Power"],
    category_positions: [0],
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

const names = (blocks: BlockInfo[]) => blocks.map((entry) => entry.subtype_id);
/** Sorts blocks as tiles of their own, and returns the tile blocks in order. */
const sortLikeTheGame = (blocks: BlockInfo[], categoryKey: string, categoryOrder: string[]): BlockInfo[] =>
  sortTiles(groupBlocks(blocks), categoryKey, categoryOrder).map((tile) => tile.block);

describe("sortLikeTheGame", () => {
  it("puts blocks pinned in the grid first, in grid order", () => {
    const blocks = [
      block("Listed", { category_positions: [0] }),
      block("Heavy", { grid_position: 1 }),
      block("Light", { grid_position: 0 }),
    ];
    expect(names(sortLikeTheGame(blocks, "Power", ["Power"]))).toEqual(["Light", "Heavy", "Listed"]);
  });

  it("orders blocks sharing a grid cell by definition order", () => {
    const blocks = [
      block("Small", { grid_position: 3, definition_order: 9 }),
      block("Large", { grid_position: 3, definition_order: 2 }),
    ];
    expect(names(sortLikeTheGame(blocks, "", []))).toEqual(["Large", "Small"]);
  });

  it("orders unpinned blocks by the category list", () => {
    const blocks = [block("B", { category_positions: [5] }), block("A", { category_positions: [2] })];
    expect(names(sortLikeTheGame(blocks, "Power", ["Power"]))).toEqual(["A", "B"]);
  });

  it("puts hidden shape variants last, in file order", () => {
    const blocks = [
      block("SlopeB", { shown_in_game_menu: false, definition_order: 8 }),
      block("SlopeA", { shown_in_game_menu: false, definition_order: 3 }),
      block("Listed"),
    ];
    expect(names(sortLikeTheGame(blocks, "Power", ["Power"]))).toEqual(["Listed", "SlopeA", "SlopeB"]);
  });

  it("with no category chosen, follows the menu order of categories", () => {
    const blocks = [
      block("Weapon", { categories: ["Weapons"], category_positions: [0] }),
      block("Power", { categories: ["Power"], category_positions: [4] }),
    ];
    expect(names(sortLikeTheGame(blocks, "", ["Power", "Weapons"]))).toEqual(["Power", "Weapon"]);
  });
});

// The order blocks are listed in, matching the game's G-menu as closely as the
// game's files allow.
//
// The game keeps two kinds of order:
//   1. A grid layout (`BlockPositions.sbc`) that pins about 150 block groups to
//      fixed cells: Light Armor Block, Heavy Armor Block, Round Slope, ...
//   2. Each menu category's own list (`BlockCategories.sbc`) for everything else.
// Pinned blocks come first in grid order, then the rest in category order, then the
// shape variants the game hides from its menu (slopes, corners), in file order.

import type { BlockTile } from "./blockGroups";
import type { BlockInfo } from "./catalog";

/** Where the game lists a block inside one category (0 = first); blocks not in it sort last. */
export function positionInCategory(block: BlockInfo, categoryKey: string): number {
  const index = block.categories.indexOf(categoryKey);
  return index === -1 ? Number.MAX_SAFE_INTEGER : block.category_positions[index];
}

/**
 * Sorts menu tiles (in place) the way the game lists them.
 * `categoryKey` is the chosen menu category, or "" for all of them.
 * `categoryOrder` is the game's category keys in menu order (used for "all").
 */
export function sortLikeTheGame(tiles: BlockTile[], categoryKey: string, categoryOrder: string[]): BlockTile[] {
  /** Menu position of the first category listing the block, then its place inside it. */
  const listPosition = ({ block }: BlockTile): [number, number] => {
    if (categoryKey) return [0, positionInCategory(block, categoryKey)];
    let best: [number, number] = [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    block.categories.forEach((key, index) => {
      const menuIndex = categoryOrder.indexOf(key);
      if (menuIndex !== -1 && menuIndex < best[0]) best = [menuIndex, block.category_positions[index]];
    });
    return best;
  };

  /** 0 = pinned in the grid, 1 = in a category list, 2 = a hidden shape variant. */
  const tier = (tile: BlockTile): number => {
    if (tile.gridPosition !== null) return 0;
    return tile.block.shown_in_game_menu ? 1 : 2;
  };

  return tiles.sort((left, right) => {
    const tierDifference = tier(left) - tier(right);
    if (tierDifference !== 0) return tierDifference;
    if (tier(left) === 0) {
      return (
        (left.gridPosition as number) - (right.gridPosition as number) ||
        left.block.definition_order - right.block.definition_order
      );
    }
    if (tier(left) === 1) {
      const [leftMenu, leftPlace] = listPosition(left);
      const [rightMenu, rightPlace] = listPosition(right);
      return leftMenu - rightMenu || leftPlace - rightPlace || left.block.definition_order - right.block.definition_order;
    }
    return left.block.definition_order - right.block.definition_order;
  });
}

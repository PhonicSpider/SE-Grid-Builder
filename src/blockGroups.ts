// Block variant groups: the game shows ONE tile for a block and its shape
// variants (Light Armor Block with its slope, corner, ...). The player scrolls
// through the variants once the tile is on the toolbar. Here a group is a tile
// plus the list of blocks behind it.

import type { BlockInfo } from "./catalog";

/** One menu tile: the block shown on it and every block in its group (the tile's block first). */
export interface BlockTile {
  /** The block drawn on the tile, and the one selected by clicking it. */
  block: BlockInfo;
  /** All the blocks of the group for this grid size, in the game's order. Just the tile's block if it stands alone. */
  variants: BlockInfo[];
  /** Where the game's G-menu pins the group (lowest of its blocks), or null if unpinned. */
  gridPosition: number | null;
}

/** Two blocks share a tile when they have the same variant group and grid size. */
export function groupKey(block: BlockInfo): string | null {
  return block.variant_group === null ? null : `${block.variant_group}|${block.cube_size}`;
}

/**
 * Turns blocks into menu tiles. Blocks that share a variant group (and grid size)
 * become one tile; the rest each get their own. Tile order follows the first
 * block of each group in the input, so sort the result afterwards.
 */
export function groupBlocks(blocks: BlockInfo[]): BlockTile[] {
  const tiles: BlockTile[] = [];
  const byKey = new Map<string, BlockTile>();

  for (const block of blocks) {
    const key = groupKey(block);
    const existing = key === null ? undefined : byKey.get(key);
    if (existing) {
      existing.variants.push(block);
      continue;
    }
    const tile: BlockTile = { block, variants: [block], gridPosition: null };
    tiles.push(tile);
    if (key !== null) byKey.set(key, tile);
  }

  for (const tile of tiles) {
    tile.variants.sort((left, right) => left.variant_position - right.variant_position);
    tile.block = tile.variants[0];
    const pinned = tile.variants.map((entry) => entry.grid_position).filter((place): place is number => place !== null);
    tile.gridPosition = pinned.length > 0 ? Math.min(...pinned) : null;
  }
  return tiles;
}

/** The blocks in the same group as `block` (including it), in the game's order; just itself if it stands alone. */
export function variantsOf(block: BlockInfo, allBlocks: BlockInfo[]): BlockInfo[] {
  const key = groupKey(block);
  if (key === null) return [block];
  return allBlocks
    .filter((other) => groupKey(other) === key)
    .sort((left, right) => left.variant_position - right.variant_position);
}

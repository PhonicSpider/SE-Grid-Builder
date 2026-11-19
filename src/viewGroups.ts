// View groups: sets of blocks that the viewer can fade together.
//
// Today there is one fadable group, armor, so the player can see the machinery
// (conveyors, assemblers, weapons ...) through the hull without deleting any
// armor. More groups can be added to `VIEW_GROUPS` later without other changes.
//
// This file holds only plain logic (no 3D), so it can be tested on its own.

import type { BlockInfo } from "./catalog";

/** Which group a block belongs to when the viewer fades things. */
export type ViewGroup = "armor" | "other";

/**
 * The groups the player can fade, with the label shown beside the slider.
 * The "armor" group holds all the plain structure: armor, beams, windows,
 * trusses, stairs, floors, signs and the like (see `viewGroupOf`).
 */
export const VIEW_GROUPS: { group: ViewGroup; label: string }[] = [{ group: "armor", label: "Armor / structure" }];

/**
 * The "armor" group is every block that does nothing on its own, so the
 * machinery inside shows through when it fades:
 *   * blocks built from side plates (they have a cube topology),
 *   * blocks listed in a game category whose key mentions armor,
 *   * every block whose type is plain `CubeBlock`: the game gives that type to
 *     blocks with no function (grid beams, windows, trusses, catwalks, stairs,
 *     floors, symbols and signs, decoration).
 * Everything with its own type (conveyors, doors, turrets, thrusters ...) is "other".
 */
export function viewGroupOf(block: BlockInfo): ViewGroup {
  if (block.cube_topology !== null) return "armor";
  if (block.categories.some((key) => key.toLowerCase().includes("armor"))) return "armor";
  if (block.type_id.replace(/^MyObjectBuilder_/, "") === "CubeBlock") return "armor";
  return "other";
}

/** What a group's opacity (0 = gone, 1 = solid) means for drawing. */
export interface FadeState {
  /** False when the blocks should not be drawn at all (saves drawing work). */
  visible: boolean;
  /** True when the materials must blend with what is behind them. */
  transparent: boolean;
  /** Faded blocks must not write depth, or they would hide the parts behind them. */
  depthWrite: boolean;
  /** The opacity to give the materials, kept inside 0 to 1. */
  opacity: number;
}

/** Turns a slider value into drawing settings. Values outside 0 to 1 are clamped. */
export function fadeStateFor(opacity: number): FadeState {
  const clamped = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
  return {
    visible: clamped > 0,
    transparent: clamped < 1,
    depthWrite: clamped >= 1,
    opacity: clamped,
  };
}

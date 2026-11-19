// Imports a blueprint (`bp.sbc`) someone made into the editor.
//
// Rust reads the XML (src-tauri/src/blueprint_import.rs) and returns the main
// grid's blocks. This file matches each block to the player's own block list,
// moves the ship to the origin, and builds the placements. Blocks the player's
// game does not have (mod blocks, usually) are left out and counted.
//
// The matching and planning are plain functions so they can be tested without
// the game.

import { invoke } from "@tauri-apps/api/core";
import { isDesktopApp, type BlockInfo } from "./catalog";
import type { PaintColor } from "./color";
import type { DirectionName, Vector } from "./orientation";
import type { GridSize, NewBlock, Ship } from "./ship";

/** Mirrors the Rust struct `ImportedBlock` field for field. */
export interface ImportedBlock {
  type_id: string;
  subtype_id: string;
  position: Vector;
  forward: string;
  up: string;
  color: PaintColor;
  skin_subtype_id: string | null;
}

/** Mirrors the Rust struct `ImportedBlueprint`. */
export interface ImportedBlueprint {
  name: string;
  grid_size: string;
  /** True when the blueprint's main grid is a station (static). */
  is_station: boolean;
  blocks: ImportedBlock[];
  other_grid_count: number;
  other_grid_blocks: number;
  unreadable_blocks: number;
}

const TYPE_PREFIX = "MyObjectBuilder_";

/** "MyObjectBuilder_Conveyor" and "Conveyor" are the same type. */
function bareType(typeId: string): string {
  return typeId.startsWith(TYPE_PREFIX) ? typeId.slice(TYPE_PREFIX.length) : typeId;
}

/**
 * Builds a function that finds the game's block for a (type, subtype) pair.
 *
 * An exact match on both is used first. A block whose type is not the one the
 * game lists (a type the game has since renamed) still matches when its
 * subtype belongs to exactly one block; an empty subtype never does.
 */
export function buildBlockLookup(blocks: BlockInfo[]): (typeId: string, subtypeId: string) => BlockInfo | null {
  const exact = new Map<string, BlockInfo>();
  const bySubtype = new Map<string, BlockInfo[]>();
  for (const block of blocks) {
    const key = `${bareType(block.type_id)}|${block.subtype_id}`;
    if (!exact.has(key)) exact.set(key, block);
    if (block.subtype_id) bySubtype.set(block.subtype_id, [...(bySubtype.get(block.subtype_id) ?? []), block]);
  }
  return (typeId, subtypeId) => {
    const found = exact.get(`${bareType(typeId)}|${subtypeId}`);
    if (found) return found;
    const sameSubtype = subtypeId ? bySubtype.get(subtypeId) : undefined;
    return sameSubtype?.length === 1 ? sameSubtype[0] : null;
  };
}

/** What importing a blueprint would place, and what had to be left out. */
export interface ImportPlan {
  gridSize: GridSize;
  entries: NewBlock[];
  /** Blueprint blocks the player's game has no definition for, by name, with how many of each. */
  unknownBlocks: Map<string, number>;
}

/**
 * Turns the blueprint's blocks into placements. The ship is moved so its lowest
 * corner is the origin (blueprints use coordinates anywhere, often negative).
 */
export function planImport(blueprint: ImportedBlueprint, lookup: (typeId: string, subtypeId: string) => BlockInfo | null): ImportPlan {
  const matched: { info: BlockInfo; block: ImportedBlock }[] = [];
  const unknownBlocks = new Map<string, number>();
  for (const block of blueprint.blocks) {
    const info = lookup(block.type_id, block.subtype_id);
    if (info) {
      matched.push({ info, block });
    } else {
      const name = block.subtype_id || block.type_id;
      unknownBlocks.set(name, (unknownBlocks.get(name) ?? 0) + 1);
    }
  }

  const lowest: Vector = [Infinity, Infinity, Infinity];
  for (const { block } of matched) {
    for (let axis = 0; axis < 3; axis++) lowest[axis] = Math.min(lowest[axis], block.position[axis]);
  }
  const entries: NewBlock[] = matched.map(({ info, block }) => ({
    info,
    position: [block.position[0] - lowest[0], block.position[1] - lowest[1], block.position[2] - lowest[2]],
    orientation: { forward: block.forward as DirectionName, up: block.up as DirectionName },
    color: block.color,
    skin: block.skin_subtype_id,
  }));
  return { gridSize: blueprint.grid_size === "Small" ? "Small" : "Large", entries, unknownBlocks };
}

/** The outcome of an import, for showing to the player. */
export interface ImportSummary {
  name: string;
  placed: number;
  /** Blocks in the file for the main grid. */
  total: number;
  notInGame: number;
  /** Names of the blocks the game does not have (up to a few, for the message). */
  unknownNames: string[];
  /** Blocks that overlapped another or did not fit the grid size. */
  didNotFit: number;
  otherGrids: number;
  otherGridBlocks: number;
  unreadable: number;
}

/** Puts a parsed blueprint into the ship, replacing what is there (one undo step brings it back). */
export function applyImport(ship: Ship, blueprint: ImportedBlueprint, blocks: BlockInfo[]): ImportSummary {
  const plan = planImport(blueprint, buildBlockLookup(blocks));
  // Never wipe the player's ship for an import that brings nothing in.
  const result = plan.entries.length > 0 ? ship.replaceAll(plan.gridSize, plan.entries) : { placed: 0, didNotFit: 0 };
  const notInGame = [...plan.unknownBlocks.values()].reduce((sum, count) => sum + count, 0);
  return {
    name: blueprint.name,
    placed: result.placed,
    total: blueprint.blocks.length,
    notInGame,
    unknownNames: [...plan.unknownBlocks.keys()],
    didNotFit: result.didNotFit,
    otherGrids: blueprint.other_grid_count,
    otherGridBlocks: blueprint.other_grid_blocks,
    unreadable: blueprint.unreadable_blocks,
  };
}

/** A short plain-English report of what the import did and did not bring in. */
export function describeImport(summary: ImportSummary): string {
  if (summary.placed === 0) {
    return "Nothing was imported: none of the blocks are in your game's block list. Your ship was left as it was.";
  }
  const parts = [`Imported ${summary.placed} of ${summary.total} blocks.`];
  if (summary.notInGame > 0) {
    const shown = summary.unknownNames.slice(0, 3).join(", ");
    const more = summary.unknownNames.length > 3 ? ` and ${summary.unknownNames.length - 3} more` : "";
    parts.push(`${summary.notInGame} not in your game's block list (mods?): ${shown}${more}.`);
  }
  if (summary.didNotFit > 0) parts.push(`${summary.didNotFit} did not fit.`);
  if (summary.unreadable > 0) parts.push(`${summary.unreadable} could not be read.`);
  if (summary.otherGrids > 0) {
    parts.push(`${summary.otherGrids} other grid${summary.otherGrids === 1 ? "" : "s"} (${summary.otherGridBlocks} blocks, such as rotor heads) not imported.`);
  }
  parts.push("Ctrl+Z undoes the import.");
  return parts.join(" ");
}

/** Asks Rust to read a blueprint's text. Only works in the desktop app. */
export async function readBlueprintText(xml: string): Promise<ImportedBlueprint> {
  if (!isDesktopApp()) throw new Error("Importing only works in the desktop app (run: npm run tauri dev).");
  return invoke<ImportedBlueprint>("import_se1_blueprint", { xml });
}

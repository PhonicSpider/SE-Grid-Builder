// Sends the finished ship to Rust, which writes the game's blueprint file.
//
// The field names below must match the Rust structs `BlueprintRequest`,
// `PlacedBlock` and `PaintColor` in src-tauri/src/blueprint.rs exactly.

import { invoke } from "@tauri-apps/api/core";
import { isDesktopApp } from "./catalog";
import type { Ship } from "./ship";

export interface ExportResult {
  ok: boolean;
  message: string;
  /** True when the only problem is that a blueprint with this name already exists. */
  nameAlreadyTaken: boolean;
}

/** `asStation` saves a static grid (a station or base) instead of a ship. */
export async function exportSe1Blueprint(
  ship: Ship,
  name: string,
  overwrite: boolean,
  asStation = false,
): Promise<ExportResult> {
  if (!isDesktopApp()) {
    return {
      ok: false,
      nameAlreadyTaken: false,
      message: "Exporting only works in the desktop app (run: npm run tauri dev).",
    };
  }

  const request = {
    name,
    grid_size: ship.gridSize,
    overwrite,
    is_station: asStation,
    blocks: ship.list().map((block) => ({
      type_id: block.info.type_id,
      subtype_id: block.info.subtype_id,
      position: block.position,
      forward: block.orientation.forward,
      up: block.orientation.up,
      color: block.color,
      skin_subtype_id: block.skin,
    })),
  };

  try {
    const savedPath = await invoke<string>("export_se1_blueprint", { request });
    return { ok: true, nameAlreadyTaken: false, message: `Saved ${asStation ? "station" : "ship"} to ${savedPath}` };
  } catch (error) {
    const message = String(error);
    return { ok: false, nameAlreadyTaken: message.includes("already exists"), message };
  }
}

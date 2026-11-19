// The block catalog: every block the player's Space Engineers 1 install knows.
//
// The real work happens in Rust (src-tauri/src/se1.rs), which reads the game's
// own files. This file only asks Rust for the result.

import { Channel, invoke } from "@tauri-apps/api/core";

/** Mirrors the Rust struct `BlockInfo` field for field (names match the JSON). */
export interface BlockInfo {
  type_id: string;
  subtype_id: string;
  display_name: string;
  /** Keys of the game categories this block is listed in (may be several, or none). */
  categories: string[];
  /** Same length as `categories`: where the game lists this block in each (0 = first). */
  category_positions: number[];
  cube_size: string; // "Large" or "Small"
  size: [number, number, number];
  icon: string | null;
  shown_in_game_menu: boolean;
  /** The block's 3D model path, or null for armor-style blocks built from side plates. */
  model: string | null;
  /** Shifts the model inside the block, in meters [x, y, z]. */
  model_offset: [number, number, number];
  /** The shape family of an armor-style block ("Box", "Slope", ...). */
  cube_topology: string | null;
  /** The side plates of an armor-style block, in the game's order. */
  side_models: string[];
}

/** One armor skin from the game's skin picker. Mirrors the Rust struct `SkinInfo`. */
export interface SkinInfo {
  subtype_id: string; // written to the blueprint, e.g. "Battered_Armor"
  display_name: string; // e.g. "Battered"
  icon: string | null;
  dlc: string[]; // DLC packs that own it (empty = free)
}

/** One entry of the game's block menu. Mirrors the Rust struct `CategoryInfo`. */
export interface CategoryInfo {
  key: string;
  display_name: string;
  /** "function" = what a block does (Armor, Power, ...); "dlc" = a DLC pack. */
  kind: "function" | "dlc";
}

/** Mirrors the Rust struct `Se1Catalog`. */
export interface Se1Catalog {
  install_path: string;
  /** The game's categories, in the game's own order. */
  categories: CategoryInfo[];
  /** Armor skins for the paint tool, in the game's file order. */
  skins: SkinInfo[];
  blocks: BlockInfo[];
  warnings: string[];
}

/** True when running inside the desktop app (Tauri), false in a plain browser. */
export function isDesktopApp(): boolean {
  // `typeof window` first: outside a browser (in tests) there is no `window` at all.
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** A report from Rust while the block list loads. Mirrors the Rust enum `LoadProgress`. */
export type LoadProgress =
  | { kind: "message"; text: string }
  | { kind: "blocks"; found: number; total: number };

/**
 * Loads the block list. `onProgress` is called with live reports while Rust
 * reads the game's files (this is what the loading screen shows).
 */
export async function loadSe1Catalog(onProgress: (progress: LoadProgress) => void = () => {}): Promise<Se1Catalog> {
  if (isDesktopApp()) {
    // A Channel receives the messages Rust sends while the command is running.
    const channel = new Channel<LoadProgress>();
    channel.onmessage = onProgress;
    return invoke<Se1Catalog>("load_se1_catalog", { onProgress: channel });
  }
  return sampleCatalog();
}

// A tiny stand-in list so the editor can be tried in a normal browser during
// development, where Rust (and therefore the real game files) is not available.
function sampleCatalog(): Se1Catalog {
  const ARMOR = "Section1_Position2_Armorblocks";
  const CONTROL = "Section1_Position3_Control";
  const LOGISTICS = "Section1_Position3_Logistics";
  const POWER = "Section1_Position3_Power";

  let sampleOrder = 0; // stands in for the game's list order
  const make = (
    subtype: string,
    name: string,
    categoryKey: string,
    cubeSize: string,
    size: [number, number, number],
    typeId = "CubeBlock",
    shownInGameMenu = true,
  ): BlockInfo => ({
    type_id: typeId,
    subtype_id: subtype,
    display_name: name,
    categories: [categoryKey],
    category_positions: [sampleOrder++],
    cube_size: cubeSize,
    size,
    icon: null,
    shown_in_game_menu: shownInGameMenu,
    model: null,
    model_offset: [0, 0, 0],
    cube_topology: null,
    side_models: [],
  });

  return {
    install_path: "(browser preview: sample blocks only)",
    warnings: [],
    skins: [
      { subtype_id: "Clean_Armor", display_name: "Clean", icon: null, dlc: [] },
      { subtype_id: "Battered_Armor", display_name: "Battered", icon: null, dlc: [] },
      { subtype_id: "Golden_Armor", display_name: "Golden", icon: null, dlc: ["DeluxeEdition"] },
    ],
    categories: [
      { key: ARMOR, display_name: "Armor Blocks", kind: "function" },
      { key: CONTROL, display_name: "Control", kind: "function" },
      { key: LOGISTICS, display_name: "Logistics", kind: "function" },
      { key: POWER, display_name: "Power", kind: "function" },
    ],
    blocks: [
      make("LargeBlockArmorBlock", "Light Armor Block", ARMOR, "Large", [1, 1, 1]),
      make("LargeBlockArmorSlope", "Light Armor Slope", ARMOR, "Large", [1, 1, 1], "CubeBlock", false),
      make("LargeBlockArmorCorner", "Light Armor Corner", ARMOR, "Large", [1, 1, 1], "CubeBlock", false),
      make("LargeHeavyBlockArmorBlock", "Heavy Armor Block", ARMOR, "Large", [1, 1, 1]),
      make("LargeBlockConveyor", "Conveyor Tube", LOGISTICS, "Large", [1, 1, 1], "Conveyor"),
      make("LargeBlockLargeGenerator", "Large Reactor", POWER, "Large", [3, 3, 3], "Reactor"),
      make("LargeBlockCockpit", "Cockpit", CONTROL, "Large", [2, 2, 3], "Cockpit"),
      make("SmallBlockArmorBlock", "Light Armor Block", ARMOR, "Small", [1, 1, 1]),
      make("SmallBlockArmorSlope", "Light Armor Slope", ARMOR, "Small", [1, 1, 1], "CubeBlock", false),
      make("SmallBlockSmallGenerator", "Small Reactor", POWER, "Small", [1, 1, 1], "Reactor"),
    ],
  };
}

// Loads the game's own icons (blocks and skins).
//
// The game stores icons as `.dds` images, which a browser cannot show. The Rust
// command `load_block_icon` decodes one to PNG and sends the bytes here; we turn
// them into a temporary image address the page can display.
//
// Icons are loaded on demand (only the ones scrolled into view) and remembered,
// since many blocks share one icon.

import { invoke } from "@tauri-apps/api/core";
import { isDesktopApp } from "./catalog";
import { createLimiter } from "./limiter";

/** How many icons may be decoding at the same moment. */
const MAX_AT_ONCE = 6;

const limit = createLimiter(MAX_AT_ONCE);
const cache = new Map<string, Promise<string | null>>();

async function fetchIcon(iconPath: string): Promise<string | null> {
  try {
    const png = await limit(() => invoke<ArrayBuffer>("load_block_icon", { iconPath }));
    return URL.createObjectURL(new Blob([png], { type: "image/png" }));
  } catch (error) {
    console.warn(`icon failed (${iconPath}):`, error);
    return null; // the tile just shows its name without a picture
  }
}

/** Returns an address for the game's icon image, or null if it cannot be loaded. */
export function loadGameIcon(iconPath: string | null): Promise<string | null> {
  if (!iconPath || !isDesktopApp()) return Promise.resolve(null); // a plain browser has no game files
  let result = cache.get(iconPath);
  if (!result) {
    result = fetchIcon(iconPath);
    cache.set(iconPath, result);
  }
  return result;
}

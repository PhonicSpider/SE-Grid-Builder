// Loads the pictures and shapes the editor will want soon, while the loading
// screen is up, so the block list and the first placements appear instantly.
//
// Everything here goes through the same loaders and caches the editor uses
// (`loadGameIcon`, `loadBlockModel`, `loadTexture`), so nothing is loaded
// twice: when the editor asks for an icon later, the answer is already there.

import type { Se1Catalog } from "./catalog";
import { isDesktopApp } from "./catalog";
import { loadGameIcon } from "./blockIcons";
import { countText, stageFraction, type LoadingScreen } from "./loadingScreen";
import { loadBlockModel, modelRequestFor } from "./modelLoader";
import { loadTexture } from "./textureLoader";

/**
 * Runs `work` on every item (the loaders limit how many run at once) and
 * calls `onDone(finished, total)` as each one finishes.
 */
async function forEachWithCount<Item>(
  items: Item[],
  work: (item: Item) => Promise<unknown>,
  onDone: (finished: number, total: number) => void,
): Promise<void> {
  let finished = 0;
  onDone(0, items.length);
  await Promise.all(
    items.map(async (item) => {
      await work(item);
      finished++;
      onDone(finished, items.length);
    }),
  );
}

/** Loads block icons, skin icons, armor shapes and their textures. */
export async function preloadAssets(catalog: Se1Catalog, screen: LoadingScreen, startFraction: number): Promise<void> {
  if (!isDesktopApp()) return; // a plain browser has no game files to load

  // The bar is shared: icons, then skins, then shapes, then textures.
  const room = 1 - startFraction;
  const iconsEnd = startFraction + room * 0.5;
  const skinsEnd = startFraction + room * 0.6;
  const shapesEnd = startFraction + room * 0.9;

  // 1. Block icons. Many blocks share one icon, so load each picture once.
  const iconPaths = [...new Set(catalog.blocks.map((block) => block.icon).filter((icon): icon is string => !!icon))];
  screen.say(`Decoding ${iconPaths.length} block icons from the game's textures...`);
  await forEachWithCount(iconPaths, loadGameIcon, (done, total) =>
    screen.progress(countText("Loaded", done, total, "block icons"), stageFraction(startFraction, iconsEnd, done, total)),
  );

  // 2. Armor skins.
  const skinIcons = catalog.skins.map((skin) => skin.icon).filter((icon): icon is string => !!icon);
  screen.say(`Loading ${skinIcons.length} armor skin pictures...`);
  await forEachWithCount(skinIcons, loadGameIcon, (done, total) =>
    screen.progress(countText("Loaded", done, total, "skin pictures"), stageFraction(iconsEnd, skinsEnd, done, total)),
  );

  // 3. Armor shapes (slopes, corners, ...), remembering the textures they use.
  const armorRequests = catalog.blocks
    .filter((block) => block.cube_topology !== null)
    .map((block) => modelRequestFor(block))
    .filter((request) => request !== null);
  screen.say(`Building ${armorRequests.length} armor shapes...`);
  const texturePaths = new Set<string>();
  await forEachWithCount(
    armorRequests,
    async (request) => {
      const model = await loadBlockModel(request, 0);
      for (const slot of model?.slots ?? []) if (!slot.glass && slot.texture) texturePaths.add(slot.texture);
    },
    (done, total) =>
      screen.progress(countText("Built", done, total, "armor shapes"), stageFraction(skinsEnd, shapesEnd, done, total)),
  );

  // 4. The surface textures those shapes use.
  screen.say(`Loading ${texturePaths.size} surface textures...`);
  await forEachWithCount([...texturePaths], loadTexture, (done, total) =>
    screen.progress(countText("Loaded", done, total, "textures"), stageFraction(shapesEnd, 1, done, total)),
  );
}

// App start-up: load the block list from the game, then build the editor.

import { invoke } from "@tauri-apps/api/core";
import { loadSe1Catalog } from "./catalog";
import { countText, LoadingScreen, stageFraction } from "./loadingScreen";
import { preloadAssets } from "./preload";
import { createEditorState } from "./editorState";
import { Ship } from "./ship";
import { setUpInterface } from "./ui";
import { setUpTooltips } from "./tooltip";
import { Viewport } from "./viewport";

/** Reading the block files owns the first 40% of the bar; the pictures, skins and shapes share the rest. */
const CATALOG_SHARE = 0.4;

/** The text Rust uses when the automatic search finds no game. */
const INSTALL_NOT_FOUND = "install not found";

window.addEventListener("DOMContentLoaded", () => {
  setUpTooltips();
  const screen = new LoadingScreen(document.getElementById("loading-screen")!);
  void start(screen);
});

/** Loads everything and opens the editor. Can run again after the player picks the game folder. */
async function start(screen: LoadingScreen): Promise<void> {
  const status = document.getElementById("catalog-status")!;
  const viewportContainer = document.getElementById("viewport")!;
  screen.reset();
  screen.say("Starting SE Grid Builder...");

  try {
    const catalog = await loadSe1Catalog((progress) => {
      if (progress.kind === "message") {
        screen.say(progress.text);
      } else {
        screen.progress(
          countText("Found", progress.found, progress.total, "blocks"),
          stageFraction(0, CATALOG_SHARE, progress.found, progress.total),
        );
      }
    });
    if (catalog.warnings.length > 0) console.warn("Block files that could not be read:", catalog.warnings);
    screen.say(`Found ${catalog.blocks.length} blocks in ${catalog.categories.length} menu categories.`);

    await preloadAssets(catalog, screen, CATALOG_SHARE);
    screen.say("Setting up the 3D view...");

    const ship = new Ship();
    const state = createEditorState();
    const viewport = new Viewport(viewportContainer, ship, state);
    setUpInterface(catalog, ship, state, viewport);
    await screen.finish();
  } catch (error) {
    status.textContent = `Could not load the game's block list: ${error}`;
    screen.fail(`Could not load the game's block list: ${error}`);
    if (String(error).includes(INSTALL_NOT_FOUND)) offerToLocateGame(screen);
  }
}

/** Shows a button that lets the player pick their game folder, then starts over. */
function offerToLocateGame(screen: LoadingScreen): void {
  screen.say("Searched Steam's folders and every drive's usual Steam locations.");
  screen.offerButton("Locate game folder...", async () => {
    try {
      // Opens a folder picker; null means the player closed it. A folder that
      // is not the game comes back as an error, which we show and let them retry.
      const chosen = await invoke<string | null>("choose_install_folder");
      if (chosen === null) return;
      screen.say(`Saved ${chosen} in your settings.`);
      void start(screen);
    } catch (error) {
      screen.say(String(error));
    }
  });
}

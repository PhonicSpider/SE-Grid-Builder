# Loading Screen

What you see while the app starts: a shell-style log, a counter line ("Found 812 / 1,240 blocks...") and a progress bar. It fades out when everything is ready.

## How the pieces fit
- **Rust** (`se1::load_catalog_with_progress`) calls a `report` function as it works. It sends `LoadProgress` values: `Message { text }` or `Blocks { found, total }`.
- **The pipe**: the command `load_se1_catalog` takes a Tauri `Channel`. Rust calls `channel.send(...)`; TypeScript receives each one in `channel.onmessage` while the command is still running.
- **`total`** is an estimate (a text count of `<Definition ` across the block files). The last report replaces it with the real count, so the counter ends on "N / N".
- **TypeScript** (`loadingScreen.ts`) draws the log and bar. `preload.ts` then loads block icons, skin pictures, armor shapes and their textures through the normal loaders, so the editor finds them already cached.
- The bar is shared: block files 0-40%, then icons, skins, shapes, textures.

## Limits
- It cannot show the Rust *compile* output of `npm run tauri dev`: no window exists until compiling finishes. A release build (`npm run tauri build`) has no compile wait.
- Only armor shapes are pre-built; other block models still load when first placed or shown.
- Not yet checked in the real desktop window.

Related: [[Architecture]], [[Textures]], [[Commands]]

## Finding the game
`se1::find_install` tries, in order:
1. **The saved choice**: `%APPDATA%\SE Grid Builder\settings.json` (`settings.rs`), if that folder still holds the game.
2. **Steam's own location** from the Windows registry (`winreg` crate), plus the two standard `C:` Steam folders.
3. **Every existing drive letter** for `SteamLibrary`, `Steam`, `Games\Steam`, `Games\SteamLibrary`, `Program Files (x86)\Steam` and `Program Files\Steam`.
4. Each Steam folder's `libraryfolders.vdf`, which lists further libraries.

If nothing is found, the loading screen shows **Locate game folder...**. The command `choose_install_folder` opens the Windows folder picker (`rfd` crate), accepts the game folder or a folder just above it, saves it, and start-up runs again. A wrong folder shows an error and lets the player retry.

Blueprints are not searched for: they always live in `%APPDATA%\SpaceEngineers\Blueprints\local`.

## Update check

The first thing the loading screen does is ask GitHub for a newer release (`src/updater.ts`, Tauri updater plugin).

- Endpoint: `https://github.com/PhonicSpider/SE-Grid-Builder/releases/latest/download/latest.json` (set in `tauri.conf.json`).
- If a newer version exists the screen shows **Update now** / **Not now**. Updating downloads with a progress bar, installs, then restarts.
- Offline, a timeout (8 s) or no update file published yet only logs a line and the app carries on.
- Updates are signed. The private key lives outside the repo at `~/.tauri/se-grid-builder.key` (lose it and installed copies can never update again). The public key is in `tauri.conf.json`.
- Each release must be built with `TAURI_SIGNING_PRIVATE_KEY_PATH` set, and the `.exe` setup, its `.sig` and a `latest.json` attached to the GitHub release.
- v1.0.0 has no updater inside it, so people on 1.0.0 must install a newer version by hand once.

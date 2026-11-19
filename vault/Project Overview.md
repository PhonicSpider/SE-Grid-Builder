# Project Overview

## Goal
Let a player build a ship or base in a 3D editor using the **game's real blocks**, paint it, and export it so it can be used in Space Engineers. The player picks which game (SE1 or SE2) and the app exports that game's format.

## What exists now
- Finds the player's SE1 install and reads all block definitions from it (about 1,570 blocks).
- Shows a searchable block menu, filtered by Large or Small grid and category.
- A 3D editor: place, remove and paint blocks, rotate them in all 24 orientations, undo.
- Exports `bp.sbc` straight into the game's blueprint folder.

## What it is not (yet)
- **Blocks are drawn as colored boxes**, not the real models. The real SE1 models are `.mwm` files with no public spec; SE2 models are `.fbx`/`.vrm`. See [[Roadmap and Open Questions]].
- **No SE2 export.** The format is not known. See [[SE2 Notes]].
- **Not on the Steam Workshop.** A standalone program cannot be a Workshop item. See [[Workshop and Licensing]].

## How it works in one paragraph
The Rust half of the app reads the game's files from the player's own install and writes the blueprint file. The TypeScript half draws the 3D view and the menu. They talk through two Tauri commands: `load_se1_catalog` and `export_se1_blueprint`. Details in [[Architecture]].

## Principles
- **Never copy the game's assets into the app.** Read them from the player's install at run time. (See [[Workshop and Licensing]] for why.)
- **Never overwrite a player's blueprint without asking.** Export refuses when the name exists.
- **Real data over guesses.** Formats were checked against real blueprints and real definition files, not remembered.

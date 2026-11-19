# SE Grid Builder

> **Not affiliated with Keen Software House or the Space Engineers games.** This is an independent fan project. It does not redistribute any game assets. The models, textures, icons and block data are read directly from your own installed copy of the game while the app runs, and nothing from the game is stored in this repository. Space Engineers and its content belong to Keen Software House.

A desktop app for building Space Engineers ships and stations one block at a time in 3D, painting them, and saving them as blueprints the game can load. It can also open blueprints other people made.

It reads blocks, icons, models and textures from your own copy of Space Engineers 1. Nothing from the game is included in this repository, so you need the game installed.

I started it as a way to learn the Rust coding language, while also building a tool to make building ships easier. This way you don't have to spend hours in creative or survival to design your ship.

## What it does

- Lists every block in your install, split by large and small grid and by the game's own menu categories, with search.
- Places blocks in a 3D view using the real models and textures, with the rotation controls the game uses.
- Builds in bulk: drag out lines, floors and walls (hold Shift for floors, Ctrl for walls).
- Paints blocks with the game's color picker and lets you pick an armor skin.
- Fades armor and other structure blocks so you can see the working parts inside a hull.
- Undo and redo.
- Exports a `.sbc` blueprint straight into the game's local blueprint folder, as either a ship or a station.
- Imports `.sbc` blueprints. Blocks from mods aren't in the game's block list, so they're skipped.

## Not done yet

- Space Engineers 2. I am still working out the file format and exporting/importing, so nothing is built for it.
    - You are able to Export as Space Engineers .SBC file and SE2 will import it anyway, so wasn't priority at the time.
- Paint colors the whole surface of a block. The game masks parts of some models, and I haven't worked out where the mask is yet.
- Skins are chosen and saved but not drawn in the viewport.
- Only the main grid of an imported blueprint is loaded. Subgrids are left out.
- I haven't tested an exported station in the game yet.
- Planned: a toggleable overlay showing conveyor and inventory connections, and hiding blocks by layer.

## Requirements

- Windows
- Space Engineers 1 installed through Steam
- [Node.js](https://nodejs.org/)
- [Rust](https://www.rust-lang.org/tools/install) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

The app looks for the game in Steam's library folders and the usual Steam locations on each drive. If it can't find it, it asks you to pick the folder and remembers the choice.

## Running it

Double-click `run.bat`, or from a terminal:

```
npm install
npm run tauri dev
```

The first start compiles the Rust side and takes a few minutes. After that it starts in seconds.

## Tests

```
npm test
cd src-tauri
cargo test
```

Some of the Rust tests read your game install and a folder of real blueprints, so they won't pass on a machine without the game.

## How it's put together

The Rust side reads the game's files and writes blueprints. The TypeScript side draws the 3D view with Three.js and runs the interface. They talk through Tauri commands.

I'm learning Rust while building this, so the code is heavily commented. The `vault` folder is an Obsidian vault with my notes on the file formats, how the pieces fit, and what I haven't figured out yet. Start with `00 Start Here`.

## A note on game content

See the notice at the top. The app displays the game's models, textures and icons straight from your own install and doesn't copy or redistribute them.

# Blueprint Import

Reads a Space Engineers 1 blueprint (`bp.sbc`) someone made and loads it into the editor. The reverse of exporting ([[SE1 Blueprint Format]]). Code: `src-tauri/src/blueprint_import.rs` (reads the XML), `src/importer.ts` (matching and planning), `Ship.replaceAll` in `src/ship.ts`, the Import button in the tools row (`index.html`, wired in `src/ui.ts`).

## How to use
Press the **Import** button (the down-arrow-into-tray icon in the tools row, between the mode buttons and the rotate buttons; hover for its tooltip) and pick a `bp.sbc` file (the `bp.sbc` inside a blueprint's folder: your own in `%APPDATA%\SpaceEngineers\Blueprints\local\<name>\`, or one a friend sent). The current ship is **replaced**; **Ctrl+Z brings the old ship back** (grid size included). The camera moves to frame the imported ship, and the ship name box is filled with the blueprint's name.

## What happens
1. The browser reads the file's text and hands it to the Rust command `import_se1_blueprint`.
2. Rust (`parse_blueprint`) reads the main grid's blocks: type, subtype, lowest corner (`Min`), orientation, paint (stored as offsets, converted back exactly as `blueprint.rs` wrote them) and skin. Everything else in the file (inventories, toolbars, terminal settings) is skipped by serde.
3. `buildBlockLookup` matches each block to the player's own block list: type and subtype, with or without the `MyObjectBuilder_` prefix; if the type does not match but the subtype belongs to exactly one block, that block is used; an empty subtype never falls back.
4. `planImport` drops blocks the game does not have (mod blocks), then **moves the ship so its lowest corner is the origin** (blueprints use any coordinates, often negative).
5. `Ship.replaceAll` places everything as one undo step. Blocks that overlap another or do not fit the grid size are skipped and counted.
6. A message says what was left out: not in the block list, did not fit, unreadable, other grids.

## What is not imported
- **Other grids.** A blueprint can hold several grids: the ship, rotor/piston/hinge heads, attached ships. Only the grid with the most blocks is imported (130 of 257 local blueprints have more than one grid). The message says how many were skipped.
- **Mod blocks.** Not shown, as intended. They are named in the message and in the console.
- **The `bp.sbcB5` binary copy.** Only the XML `bp.sbc` is read.
- Everything that is not geometry and paint: conveyor wiring, terminal names, toolbar setups, inventories. They are not in the editor and would be lost on export.
- **Skins** are kept (and exported again) but not drawn, see [[Textures]].

## Checks
Run against the author's own 257 local blueprints (`cargo test blueprint_import`): all 257 read without errors (282,970 blocks), and **278,319 of them (98%) are in the game's block list**. The most common unknown blocks are mod blocks (`aero-wing_...`, `GanymedeLGSmallThruster`, `modular_...`). Other tests: a ship written by the exporter reads back the same (positions, orientation, paint, skin, empty subtype); a hand-written file with extra fields, a rotor-head grid and a block with no position; refusing non-blueprints and cut-off files; field names match the TypeScript side. TypeScript tests cover matching, moving to the origin, replacing and undoing, overlaps and the report text.

## Not checked
- The real file picker and the Rust command in the desktop window (the pieces are tested separately; the browser preview cannot import because it has no Rust).
- A very large blueprint's speed in the viewer (the author's biggest local file is about 1 MB of XML; drawing cost is the open "Faster big ships" item in [[Roadmap and Open Questions]]).

## Ideas for later
- Pick from a list of the player's local blueprints instead of browsing for the file.
- Import every grid, with rotor heads attached, once the editor supports sub-grids.
- Drag a `.sbc` file onto the window.

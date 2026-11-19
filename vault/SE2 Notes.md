# SE2 Notes (Space Engineers 2)

**Status: not implemented.** Everything here is what was *observed on this PC*. Nothing about the SE2 export format is confirmed.

## What is installed
| Path | What |
|---|---|
| `H:\SteamLibrary\steamapps\common\SpaceEngineers2` | the game (about 46,000 files) |
| `H:\SteamLibrary\steamapps\common\Space Engineers 2 - Mod SDK` | Keen's official Mod SDK (Editor, ExampleMod1, GameData) |
| `%APPDATA%\SpaceEngineers2\AppData\Blueprints` | blueprints folder. **Empty** (only an `.index` file). |
| `%APPDATA%\SpaceEngineers2\AppData\SaveGames\<world>` | saves |
| `%APPDATA%\SpaceEngineers2\AppData\SE1GridsToImport` | **a folder for importing SE1 grids** (see below) |

## What the data looks like
- Saves and definitions are **JSON** with a header: `"$Bundles"` (version numbers), `"$Type"` (a .NET type name, for example `Game2:Keen.Game2.Simulation.WorldObjects.CubeBlocks.PlacementDefinitionObjectBuilder`) and `"$Value"` (the data).
- Things are identified by **GUIDs** (`"Definition": "f7a663bd-..."`) rather than names like SE1's `LargeBlockArmorBlock`.
- Block data lives in `.def` files (about 29,000 in the SDK), each with a `.meta` file next to it.
- Models are `.fbx` sources in the SDK, compiled to `.vrm` in the game. Armor uses `.armside` files, and is **deformable**, not a fixed cube grid like SE1.
- Version strings differ between files: saves say `0.12.23.28`, SDK definitions `2.2.0.421`. IDs may change between game versions.
- Scripting is **not** in the Mod SDK yet (Keen says it will come).

## Why SE2 export is harder
1. We have **no sample SE2 blueprint** to copy the format from.
2. Blocks are GUIDs, so the catalog needs a different loader (`.def` files, not `CubeBlocks_*.sbc`).
3. Armor works differently, so a "cell grid" editor may not map directly.

## Plan to learn the format (do in this order)
1. In SE2, build a very small ship and **save it as a blueprint**. Look at what appears in `AppData\Blueprints` (format, size, text or binary).
2. Test the **SE1 import**: put a blueprint exported from this app into `SE1GridsToImport` and see whether SE2 offers it. If it works, one SE1 export may serve both games for compatible blocks.
3. Compare the `.def` files for a few blocks with the SE1 definitions to see how sizes, mount points and skins are described.
4. Only then write `se2.rs` and an `export_se2_blueprint` command, following the same structure as `se1.rs` and `blueprint.rs`.

## Related
[[Workshop and Licensing]], [[Roadmap and Open Questions]]

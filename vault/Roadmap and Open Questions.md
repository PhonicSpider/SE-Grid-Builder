# Roadmap and Open Questions

## Do first (verification, before building more)
1. ~~**Load an exported ship in SE1.**~~ **DONE (2026-11-18).** `SSB Test Ship` (3x3 armor floor, 3x3x3 reactor on top, a conveyor, two red armor blocks) loaded and pasted correctly in SE1. The format, block types, sizes, positions and orientation are accepted. See [[SE1 Blueprint Format]].
2. ~~**Check paint.**~~ **DONE (2026-11-18).** The game's re-saves showed the value offset is 0.45, not 0.55 (fixed), and that hue maps straight through (green, blue verified). See [[Colors and Paint]].
3. ~~**Check conveyors.**~~ **DONE (2026-11-18).** The game rebuilds conveyor networks on load: a ship pasted without `ConveyorLines` had working tubes and item transfer, and the game's re-save recreated all 10 lines identically. No lines need to be exported. See [[SE1 Blueprint Format]].
4. ~~**Run the desktop window**~~ **DONE (2026-11-18).** The window runs with the real catalog, and the real game icons display correctly in the block grid (confirmed by the project owner). Not yet checked in the real window: building a ship and exporting it from the UI (the export path is tested in Rust and by hand-made test ships, but not clicked through in the desktop window).

## Verified so far
- File format accepted by the game; types, sizes, positions, multi-cell blocks.
- Rotation: 26 blocks in assorted orientations tile with no overlaps, matching the game's own saved positions ([[Orientation and Grid Math]]).
- Paint: saturation and value offsets and hue ([[Colors and Paint]]).
- Conveyors: networks rebuild by themselves; no saved lines needed ([[SE1 Blueprint Format]]).

## Next features (rough order)
| Feature | Notes |
|---|---|
| ~~Real block models~~ | **Done for 1,428 blocks (2026-11-18)**: see [[MWM Model Format]] and [[Audit 2026-11-18]]. Remaining pieces are the next rows. |
| ~~Armor shapes from side plates~~ | **Done (2026-11-18)** for 147 of 148 blocks: see [[Armor Shapes and Sub-parts]]. Left: the interior wall (thin walls, still a box) and a guess for 5 round corners. |
| (old) Armor shapes | 148 blocks (slopes, corners, half blocks, and every armor block) have no `<Model>`. The game builds them from side plates (`side_models`) using rules in its code. Plan: find, for each topology, the rotation of each plate that closes the surface, fix the global direction using the definition's mount points, check against icons. Until then they are boxes. |
| ~~Save as ship or station~~ | **Done (2026-11-18)**: a Ship / Station-base toggle in the export section writes `<IsStatic>`; import sets it from the file. Needs an in-game check of an exported station. |
| ~~Fade armor to see inside~~ | **Done (2026-11-18)**: "Armor" opacity slider (0 to 100%, double-click resets) and "Click through faded blocks", in the view bar across the top of the 3D view. See [[View Fading]]. Not yet measured on a large ship. |
| Hide by layer | Cut-away that hides a slice of the ship along one axis while building. Reuses the per-block visibility in `BlockMeshes`. Not started. |
| Connection overlay | Colored symbols per block type (yellow square cargo, blue square assembler, red circle hydrogen thruster, red square hydrogen tank ...) joined by colored lines, drawn on top of the whole ship like Blender's "bones in front", with a toggle. Purpose: spot unconnected conveyors, cargo and weapons before exporting. Needs the user's example and a rule for which blocks connect (conveyor ports in the models' dummies). Not started. |
| ~~Textures~~ | **Done (2026-11-18)**: models draw with the game's own textures; see [[Textures]]. |
| Paint mask | The game paints only parts of a texture; here paint tints the whole surface. The mask is not in the `_cm` alpha (that looks like metalness); likely in the `_add` map. See [[Textures]]. |
| Moving parts | Sub-parts now draw in their **rest pose** (turret barrels, drill heads; see [[Armor Shapes and Sub-parts]]). Left: animation, and stator/piston/hinge *heads* (separate grids). |
| Faster big ships | Instanced meshes per model, adaptive detail (`MODEL_DETAIL`), pick acceleration, cache eviction. Not measured yet. |
| Find Steam from the registry | `find_install` only knows Steam's default folders; read the real path from the Windows registry. |
| (old) Real block models | SE1 `.mwm` needs a parser (no public spec). Alternative: render from the game's own FBX source where available. Stand-in boxes remain the fallback. Check licensing first ([[Workshop and Licensing]]). |
| ~~Block icons in the menu~~ | **Done (2026-11-18).** See [[Walkthrough - se1.rs]]. |
| Compare menu order with the G menu | The menu follows each category's list order from `BlockCategories.sbc`; check it against the real G menu. |
| Group variants like the game | The game shows one block per variant group (armor slopes etc. as a row of choices). We list every variant as its own tile. `BlockVariantGroups.sbc` has the groups. |
| Tile size control | A slider for icon size. |
| ~~Skins~~ | **Done in code (2026-11-18)**: picker, paint tool and export. Needs a check in game: export a ship with a skin and compare with a block skinned in game. Also compare the picker's order with the game's, and decide whether to hide DLC skins the player does not own. |
| Show skins in the 3D view | Needs textures; part of the real-model work. |
| Mirror and symmetry | Big time saver for ships. Build on `Ship`. |
| ~~Drag to place lines/planes~~ | **Done (2026-11-18)**: **Shift + drag fills a floor** and **Ctrl + drag fills a wall** (right button clears), one block deep. A wall started on a top face stands on the side facing the camera. Still missing: straight lines, and filling a hollow box. |
| ~~Real shape in the placement ghost~~ | **Done (2026-11-18)**: the green/red ghost shows the selected block's real model, turned the way it will face, over a faint footprint box. |
| Save and load a project | JSON of the ship, so work can be continued (separate from exporting a blueprint). |
| ~~Import an existing `bp.sbc`~~ | **Done (2026-11-18)**: see [[Blueprint Import]]. Main grid only; mod blocks skipped; 98% of the 282,970 blocks in 257 real blueprints are importable. Not yet tried through the desktop window. |
| Find Steam libraries properly | Read `libraryfolders.vdf` instead of three hard-coded paths. |
| Mod blocks | Read `CubeBlocks` from installed mods too. |
| Block variant groups | Cycle slopes/corners like the game does (`BlockVariantGroups.sbc`). |
| Hide blocks a player cannot build | DLC packs are now browsable as categories; still no ownership check. |
| SE2 | See [[SE2 Notes]]. Blocked on a sample blueprint. |
| Faster 3D for big ships | Use instanced meshes; today each block is its own object, fine for hundreds, slow for many thousands. |

## Known limitations today
- Boxes, not real models. Preview size equals the covered cells.
- No blueprint thumbnail is written.
- One grid per ship (a ship cannot mix Large and Small, as in the game).
- Subgrids (rotors, pistons, wheels) are not modelled. A rotor head is a separate `<CubeGrid>` in the file (seen in `SSB Test Ship_2`); a stator placed alone will have no head.

## Possible issues to watch
- A block whose definition has no `Size` is assumed 1x1x1.
- Block types are written as `MyObjectBuilder_<TypeId>`. A few blocks may need extra required fields; the game log will say which.
- DLC blocks will appear in the menu even if the player does not own the DLC.

# Armor Shapes and Sub-parts

How slopes, corners, half blocks, turrets and other multi-piece blocks are drawn. Code: `src-tauri/src/armor.rs` (armor) and `load_model_with_subparts` in `src-tauri/src/mwm.rs` (sub-parts). Related: [[MWM Model Format]], [[Walkthrough - mwm.rs]], [[Audit 2026-11-18]].

## Armor ("cube side") blocks

147 blocks (light, heavy, large, small) have no `<Model>`. The definition gives a **topology** (`Slope`, `Corner`, `HalfSlopeBox`, ... 37 of them) and a list of **side plates**. Each plate is one small model, already modelled inside the block's cell, lying in one default position. The game turns each plate to its face. The turning rules are in the game's code, so they were found from the files.

### How the turns were found
1. **Closed-solid search.** Per block, for each plate, try all 24 turns (90 degree steps). Keep combinations where every edge of every plate meets an edge of another plate running the other way. This leaves a few possible orientations of the whole solid (a slope has 12, a corner 8, a symmetrical shape 1).
2. **Pick the orientation.** Compare each candidate with the game's own *construction model* for the finished block (`BuildProgressModels`, last stage): the right candidate has the construction model's vertices closest to its surface. 142 of 147 blocks matched with a clear margin.
3. **Cross-check with mount points.** The definition's `MountPoints` say which faces are flat contact faces (Front is -z, Bottom is -y, Right is +x). The corner's answer from step 2 agrees with its mount faces, which confirms both the method and the axis names.
4. **Round corners.** Five round-corner blocks were ambiguous (three candidates fit equally). They use the same turns as the flat corner, since their plates are drop-in replacements for the flat ones.
5. **Share by topology.** Light, heavy, large and small variants of one topology share their turns. One block differs (`LargeRoundArmor_CornerInv`) and has its own entry.

The result is a table in `armor.rs` (`SIDE_ROTATIONS`, `BLOCK_ROTATIONS`) that stores, per topology, an index into 24 rotation matrices for each plate in the definition's order.

### How it is drawn
`armor::assemble` loads each plate, rotates its vertices, and merges everything into one mesh in the same format as any other model. The window asks for it through the command `load_armor_model`; `modelLoader.ts` chooses it when a block has `cube_topology` and `side_models` but no `model` (`modelRequestFor`). Rotations keep triangle order (no mirroring), so the viewer's winding rule still holds.

### Checks (`cargo test armor`)
- All 24 turns are proper rotations and are all different.
- **Every one of the 147 blocks** assembles into a closed solid inside its cell, with positive volume no bigger than the cell. (Along seams one plate can have an extra corner; the test cuts edges at touching corners before matching.)
- The slope is exactly half a cube, flat at the front and bottom, falling away to the back (what its mount points say).
- The corner is exactly a sixth of a cube with its point where the right, bottom and front faces meet.
- The result was also drawn and compared with the game's icons (slope, corner, half block, round slope, round corner, sloped corner, inverted corner).

### Known gaps
- `LargeBlockInteriorWall` (topology `StandaloneBox`) is six thin walls, not a closed solid; it keeps its box.
- The table is *derived data*. If the game adds a topology, that block stays a box until the search is rerun (the dump tool `dump_plates` in `mwm.rs` tests exports what is needed).
- Orientation among the five round corners is a best guess.

## Sub-parts (turret swivel and barrel, drill head, door panels, rotor parts)

A model's `Dummies` tag holds named points, each with a 4x4 matrix and text properties. Dummies named `subpart_<Name>` mark where another model attaches.

Layout read by `read_dummies`: a count, then for each dummy a name, 16 floats (row-vector matrix: three axes, then the position in the last row) and a list of key/value strings (`file` names the sub-part's model).

Rules (checked on all 143 blocks that have sub-parts):
- The sub-part's model is `<Name>.mwm` in the same folder (or the `file` property).
- The matrix stores a scale (0.1 for turrets) that does **not** apply to the sub-part's own geometry. Each axis is rescaled to length 1 (`placement_of_dummy`). Without this a turret's parts come out ten times too small.
- Sub-parts can nest (turret base, then swivel, then barrel); depth is capped at 4.
- They are drawn in the **rest pose**: no animation yet.
- A sub-part that fails to load is left out; the rest still draws.

Check: of 143 blocks that gained sub-parts, 139 fit inside their block's size (plus a small allowance); the four outside are the offset door, the drill and the wind turbine, which genuinely overhang.

**Not drawn:** rotor/hinge/piston *heads*. Those are separate blocks (separate grids in the blueprint), not sub-parts.

## Why the test takes 30 seconds
`subparts_land_inside_their_blocks` loads every block model twice in an unoptimized test build. Run `cargo test --release` if that annoys you.

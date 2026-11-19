# SE1 Blueprint Format (`bp.sbc`)

Checked against your real blueprints in `%APPDATA%\SpaceEngineers\Blueprints\local\*\bp.sbc`.

A blueprint is a folder named after the ship containing `bp.sbc` (the data), optionally `bp.sbcB5` (the game's compiled copy) and `thumb.png`. The game reads `bp.sbc`.

## Skeleton we write
```xml
<?xml version="1.0"?>
<Definitions xmlns:xsd="..." xmlns:xsi="...">
  <ShipBlueprints>
    <ShipBlueprint xsi:type="MyObjectBuilder_ShipBlueprintDefinition">
      <Id Type="MyObjectBuilder_ShipBlueprintDefinition" Subtype="Ship Name" />
      <DisplayName>Ship Name</DisplayName>
      <CubeGrids>
        <CubeGrid>
          <SubtypeName />
          <EntityId>100000000000000</EntityId>
          <PersistentFlags>CastShadows InScene</PersistentFlags>
          <PositionAndOrientation> Position, Forward, Up </PositionAndOrientation>
          <GridSizeEnum>Large</GridSizeEnum>
          <CubeBlocks> ...blocks... </CubeBlocks>
          <IsStatic>false</IsStatic>
          <DisplayName>Ship Name</DisplayName>
          <DestructibleBlocks>true</DestructibleBlocks>
        </CubeGrid>
      </CubeGrids>
    </ShipBlueprint>
  </ShipBlueprints>
</Definitions>
```

## One block
```xml
<MyObjectBuilder_CubeBlock xsi:type="MyObjectBuilder_Conveyor">
  <SubtypeName>LargeBlockConveyor</SubtypeName>
  <EntityId>100000000000001</EntityId>
  <Min x="5" y="1" z="3" />
  <BlockOrientation Forward="Left" Up="Up" />
  <ColorMaskHSV x="0" y="-0.8" z="0" />
</MyObjectBuilder_CubeBlock>
```
- The **element name is always** `MyObjectBuilder_CubeBlock`; the **real type** is the `xsi:type` attribute, `MyObjectBuilder_` plus the definition's `TypeId` (`CubeBlock`, `Conveyor`, `Reactor`, ...).
- `SubtypeName` is the definition's `SubtypeId`.
- `Min` is the block's lowest corner cell. See [[Orientation and Grid Math]].
- `BlockOrientation` uses the six direction names. Real blueprints omit it for the default (Forward / Up); we always write it.
- `ColorMaskHSV` is paint as offsets. See [[Colors and Paint]].

## Things real blueprints have that we do not write (yet)
| Field | Meaning | Risk |
|---|---|---|
| ~~`SkinSubtypeId`~~ | armor skin (`Battered_Armor`, ...) | **now written** by the exporter when a skin is chosen. Not yet loaded in game. |
| `BuiltBy` | player id | none |
| `<DLC>` tags | which DLCs the ship needs | game may warn about missing DLC; unverified |
| `ConveyorLines` | saved conveyor network | **not needed**: the game rebuilds it on load (verified 2026-11-18, see "Conveyor lines" below). |
| block-specific data (inventory, terminal settings) | per block type | defaults should apply |

## What the game writes when it saves a ship (compare: `SSB Test Ship_1` and `_2`)
- **Defaults are omitted:** a block at `Min = (0,0,0)` has no `<Min>`, and the default orientation (Forward / Up) has no `<BlockOrientation>`. We always write both, which loads fine.
- **No `<SubtypeName>` for blocks that have none.** 12 game blocks have an empty subtype (Door, AirtightHangarDoor, GravityGenerator, GravityGeneratorSphere, Passage, Ladder2, AirVent, OxygenGenerator, LargeGatlingTurret, LargeMissileTurret, SmallMissileLauncher, SmallGatlingGun). The exporter now skips the element for them (and used to refuse them entirely).
- **Extra data:** functional blocks get a `ComponentContainer` (inventory, timer), `ShowOnHUD`, `NumberInGrid` and so on. Our minimal files omit these and the game fills in defaults.
- **Subgrids are separate grids:** a rotor head (`MotorRotor`) is a second `<CubeGrid>` with its own `Min (0,0,0)`. We do not export subgrids yet.
- **Ship-level extras:** `Position`/`Orientation` of the grid in space, `IsStatic`, `LocalCoordSys`, `WorkshopId`, `OwnerSteamId`, a `thumb.png` and a compiled `bp.sbcB5`.
- A re-saved copy also gets `<BuiltBy>` on every block.

## Conveyor lines (`SSB Test Ship_3`, 2026-11-18)
When blocks are joined by conveyors the game saves a `<ConveyorLines>` list after `</CubeBlocks>`. The test ship (refineries, tubes, three small cargo containers) produced **10 lines**. A lone tube with no neighbours produced none.

Each line joins **two adjacent cells**:
```xml
<MyObjectBuilder_ConveyorLine>
  <StartPosition x="1" y="2" z="2" />
  <StartDirection>Backward</StartDirection>   <!-- toward the end cell -->
  <EndPosition x="1" y="2" z="3" />
  <EndDirection>Forward</EndDirection>        <!-- the opposite direction -->
  <Sections />
  <ConveyorLineType>LARGE_LINE</ConveyorLineType>
</MyObjectBuilder_ConveyorLine>
```
Findings from the 10 lines: start and end cells differ by exactly one cell along the start direction; the end direction is the opposite; `Sections` is empty; the type is `LARGE_LINE` on a large grid. Lines also join ordinary blocks to each other (for example the two refineries), not just tubes.

**Result (2026-11-18): the game does NOT need saved lines.** `SSB Test Ship_3 NoLines` (the same ship with `<ConveyorLines>` deleted) was pasted in game:
- The tubes appeared physically.
- An item put in one small container could be moved between the containers in the terminal, so the network works.
- The game's own re-save of it (`NoLines_1`) contained **the same 10 lines**, identical in start cell, end cell and directions, plus one new line for a turret that was added in game.

So the game rebuilds conveyor networks from the blocks when a blueprint loads. **The exporter writes no `ConveyorLines`, and that is correct.** This also removes the need to read conveyor ports from the 3D models, which would have been the hardest part.

## Format facts you can rely on
- XML, UTF-8, loaded with the game's own serializer.
- Large and Small grids are separate grids (`GridSizeEnum`).
- Orientation names are exactly: Forward, Backward, Left, Right, Up, Down.

## Verified in game (2026-11-18)
The test ship `SSB Test Ship` (generated by the ignored test `write_sample_ship_to_game_folder`) loaded and pasted correctly in Space Engineers 1: 9 grey armor blocks, a 3x3x3 reactor on top, a conveyor tube and two red armor blocks, all in the expected places. So the skeleton above, the block element form, `Min`, `BlockOrientation`, `ColorMaskHSV` and the multi-cell sizing are **accepted by the game**. Paint was later checked against the game's own re-save (see [[Colors and Paint]]). Not yet confirmed: whether conveyor networks connect.

## How to verify (original steps, kept for new tests)
Export a tiny ship (a few armor blocks plus one conveyor and one reactor), start SE1, open the blueprint screen (Ctrl+B in creative), and paste it. If it fails, check `%APPDATA%\SpaceEngineers\SpaceEngineers_*.log` for the parse error. Update this note with what you find.

## Ship or station (2026-11-18)
A **station / base** is the same grid with `<IsStatic>true</IsStatic>`; a ship has `false`. Nothing else differs in the file (checked on 53 of the author's 257 local blueprints, which are stations). The editor's **Ship / Station / base** toggle above the ship name sets it (`is_station` in the export request; `BlueprintRequest` in `blueprint.rs`). Importing a blueprint reads `IsStatic` and sets the toggle to match. Not yet checked in game: export one of each and place them (a station should be static and placeable on the ground).

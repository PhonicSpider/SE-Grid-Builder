# SE1 Game Files: where things are

Install: `H:\SteamLibrary\steamapps\common\SpaceEngineers`. (`C:` and `D:` have empty shell folders with the same name; the app skips them because `CubeBlocks` is missing.)

## What matters for this app
| Path under the install | What it is |
|---|---|
| `Content\Data\CubeBlocks\CubeBlocks_*.sbc` | **Block definitions.** About 49 files: Armor, Thrusters, Weapons, Energy, ... Read by `se1.rs`. |
| `Content\Data\Localization\MyTexts.resx` | English text table. Maps `DisplayName_Block_*` keys to names. Other languages are `MyTexts.<lang>.resx`. |
| `Content\Data\BlockVariantGroups.sbc` | How the game groups shape variants (the reason hidden blocks exist). Not read yet. |
| `Content\Data\BlockCategories.sbc` | **The game's own menu categories** (49 entries listing blocks as `TypeId/SubtypeId`). Read by `se1.rs`; see [[Walkthrough - se1.rs]]. |
| `Content\Data\AssetModifiers\ArmorModifiers.sbc` | **Armor skins** (28 entries; 27 used). Icons in `Textures\GUI\Icons\Skins\Armor`. Read by `se1.rs`. |
| `Content\Models\...\*.mwm` | **3D models.** About 24,000 files; 1,371 are block models. A custom format with no public spec, now read by `mwm.rs`: see [[MWM Model Format]]. Models come as a small base file plus `_LOD0`, `_LOD1`, ... geometry files. |
| `Content\Textures\GUI\Icons\...\*.dds` | **Block icons.** DDS, 128x128, BC7 sRGB (DX10 header). Decoded to PNG by Rust and shown in the block grid. All 1,576 decode. |
| `Content\Scenarios\*\Worlds\*\Sandbox.sbc` | Starting worlds. Their `AllPlayersColors` holds the game's **14 default paint colors** (all scenarios use the same list). |
| `Content\Data\Prefabs`, `Blueprints.sbc` | Vanilla prefabs and component recipes. |
| `Bin64\*.dll` | The game's code: `Sandbox.Game.dll`, `VRage*.dll`, `SpaceEngineers.ObjectBuilders.dll`. The `MyObjectBuilder_*` types live here. |
| `Tools\VRageEditor\Plugins\ModelBuilder\MwmBuilder.exe` | Converts FBX to MWM (for making new blocks, not for reading). |

## Block definition anatomy
```xml
<Definition xsi:type="MyObjectBuilder_CubeBlockDefinition">
  <Id><TypeId>CubeBlock</TypeId><SubtypeId>LargeBlockArmorBlock</SubtypeId></Id>
  <DisplayName>DisplayName_Block_LightArmorBlock</DisplayName>   <!-- a key into MyTexts -->
  <Icon>Textures\GUI\Icons\Cubes\light_armor_cube.dds</Icon>
  <CubeSize>Large</CubeSize>
  <Size x="1" y="1" z="1" />                                     <!-- or <Size><X>..</X>... -->
  <Components> ... </Components>                                  <!-- build cost -->
  <MountPoints> ... </MountPoints>                                <!-- where blocks may attach -->
  <BuildProgressModels> ... </BuildProgressModels>
  <GuiVisible>false</GuiVisible>                                  <!-- hidden shape variant -->
```
The XML element type (`xsi:type`) varies per kind of block and adds fields (a reactor has `MaxPowerOutput`, `FuelId`, ...). We read only the common parts.

## Numbers (this install)
- 1,576 block definitions across 49 files; 0 parse warnings.
- Roughly half have `GuiVisible=false` (shape variants).

## Not used by the app, but good to know
- Your **mods** are in `H:\SE Modding\SpaceEngineersStuff\SE Mods` and `%APPDATA%\SpaceEngineers\Mods`.
- Mods add blocks with the same `CubeBlocks_*.sbc` format plus their own `Models`. A later feature could read mod blocks too.

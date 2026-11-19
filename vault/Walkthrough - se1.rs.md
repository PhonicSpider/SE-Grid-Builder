# Walkthrough: `src-tauri/src/se1.rs`

Reads Space Engineers 1 data from the player's own install. Concepts used are explained in [[Rust Concepts]]. Sections 1 and 2 are the functions you wrote; the rest builds on them.

## 1. `find_install() -> Option<PathBuf>` (yours, extended in the audit)
*The audit extended this function; see [[Audit 2026-11-18]] for exactly what changed. In short: it now asks Steam for its library folders (`libraryfolders.vdf`) first, and your original list is the last resort.*

Tries three Steam library paths in order and returns the first one that contains `Content\Data\CubeBlocks`.
- Checking `CubeBlocks` rather than just the folder matters: on this PC the C: and D: copies exist but are empty shells.
- Returns `None` if nothing matches, and the app shows "install not found".
- **Limitation:** the three paths are hard-coded. Better later: read Steam's `libraryfolders.vdf` to find every library. See [[Roadmap and Open Questions]].

## 2. `list_block_files(install: &Path) -> Result<Vec<PathBuf>, String>` (yours)
Reads `Content\Data\CubeBlocks` and returns every `.sbc` file (about 49).
- `&Path`: borrows the path.
- `fs::read_dir(...).map_err(...)?`: open the folder or return a readable error.
- `entries.flatten()`: skips entries that failed to read.
- `extension() == Some("sbc")`: only definition files.

## 3. The shapes of the XML (`Raw*` structs)
Each `.sbc` looks like this (trimmed):
```xml
<Definitions>
  <CubeBlocks>
    <Definition xsi:type="MyObjectBuilder_ReactorDefinition">
      <Id><TypeId>Reactor</TypeId><SubtypeId>LargeBlockLargeGenerator</SubtypeId></Id>
      <DisplayName>DisplayName_Block_LargeReactor</DisplayName>
      <CubeSize>Large</CubeSize>
      <Size x="3" y="3" z="3" />
      <GuiVisible>false</GuiVisible>   <!-- sometimes -->
```
The `Raw*` structs mirror that tree. serde fills them in; elements we do not list are ignored.

Two quirks the game files taught us:
- **`<Size>` has two forms**: attributes (`x="1"`) and child elements (`<X>1</X>`). `RawSize` accepts both using `rename = "@x", alias = "X"`. The first version of the parser missed 84 blocks until a test caught this.
- **`GuiVisible=false` does not mean unusable.** The game hides armor slopes, corners and other shape variants from its G-menu and groups them with a base block. Skipping them would remove nearly every armor shape, so they are kept and flagged (`shown_in_game_menu`).

## 4. Readable names (`load_display_names`)
Definitions hold text **keys** like `DisplayName_Block_LightArmorBlock`. The real text lives in `Content\Data\Localization\MyTexts.resx` (English): `<data name="key"><value>Light Armor Block</value></data>`. We read that into a `HashMap<String, String>` (a dictionary). If it cannot be read we fall back to the raw key; the app still works.

## 5. The game's own categories (`load_categories`)
The game's menu is defined in `Content\Data\BlockCategories.sbc`, not guessed from file names. Shape:
```xml
<CategoryClasses>
  <Category>
    <DisplayName>DisplayName_Category_Power</DisplayName>
    <Name>Section1_Position3_Power</Name>
    <ItemIds>
      <string>Reactor/LargeBlockLargeGenerator</string>   <!-- TypeId/SubtypeId -->
      ...
```
The file has 49 categories but only some are ship-block menus. `category_kind` keeps:
| Kept | Game name pattern | Examples |
|---|---|---|
| **Function** tabs | `Section1_Position2_Armorblocks`, `Section1_Position3_*` | Armor Blocks, Power, Propulsion, Weapons |
| **DLC** packs | `Section2_DLC_*` | Warfare 1, Decorative Pack 2 |

Dropped: `Section0_*` (character items, tools, food), "Large Blocks / Small Blocks / Nonarmor" (search filters) and hand-held tool groups.

- Order: the game sorts by the internal `Name`, so `Section1_...` comes before `Section2_...`. We sort the same way and the test checks function tabs come before DLC packs.
- Names: display names go through the same text table as block names.
- **A block can be in several categories** (a reactor is in Power and in a DLC pack if it belongs to one). `BlockInfo.categories` is a list of keys.
- The map is built by `"TypeId/SubtypeId"`, which is how the game lists blocks.
- Result of the check on this install: 15 function categories, 19 DLC packs, and **11 of 1,576 blocks in no category** (debug spheres, a few floor pieces, rail, projector). Those appear under "Not in the game's menu".
- If `BlockCategories.sbc` cannot be read, the editor still works: blocks are uncategorized and a warning is recorded.

## 6. `load_catalog` (puts it together)
For each file: read, strip the byte-order mark, parse, then for each definition build a `BlockInfo`:
- `categories` comes from the map above.
- A bad file adds a **warning** and is skipped, so one odd file never hides the rest.
- The final list is sorted by display name so the menu is stable.

## 6b. Order inside a category
`ItemIds` is an ordered list, and the game shows a category's blocks in that order. `load_categories` records each block's **position** in each list (`BlockInfo.category_positions`, same length as `categories`), and the menu sorts by it when a category is chosen. "All categories" stays alphabetical. Not yet compared side by side with the in-game G menu.

## 6b2. Model fields
Each block now also carries `model` (the `.mwm` path, for most blocks), `model_offset` (meters), and for armor-style blocks `cube_topology` and `side_models` (from `<CubeDefinition><Sides>`). 1,428 of 1,576 blocks have a `<Model>`; 148 use cube sides. `ModelOffset` has the same two XML forms as `Size`, with decimals.

## 6c. Block icons (`resolve_icon_path`, `load_icon_png`)
Each definition has `<Icon>Textures\GUI\Icons\Cubes\light_armor_cube.dds</Icon>`. Facts checked on this install:
- The files are **DDS, 128 x 128, BC7 (sRGB) compressed**, with a DX10 header and 8 mipmaps; about 12 KB as PNG.
- 1,576 of 1,576 blocks have an icon, and **all decode** (test `every_block_icon_in_the_catalog_decodes`).
- Browsers cannot show DDS, so Rust decodes it with the `image_dds` crate and returns a PNG. Nothing is saved or copied; it is read from the install each time.

**Path safety.** The path comes from the front-end, so the resolver is strict. It is now a general function, `resolve_content_file(install, path, extension)`, used for icons (`dds`) and models (`mwm`); `resolve_icon_path` is a thin wrapper. It accepts only a `.dds` file whose path is plain folder names (no `..`, no drive letter, no leading slash), then resolves the real location and checks it is still inside `Content`. A test feeds it `..\..\Bin64\Havok.dll`, `C:\Windows\win.ini`, wrong file types and an empty string, and all are refused.

New Rust ideas here: `matches!` (pattern check), `is_some_and`, `Component::Normal` (what a path is made of), `?` after `.await` (two layers of error), and `spawn_blocking` (run slow work off the window's thread).

## 6d. Armor skins (`load_skins`)
Skins live in `Data\AssetModifiers\ArmorModifiers.sbc` as `<AssetModifier>` entries:
```xml
<AssetModifier>
  <Id Type="AssetModifierDefinition" Subtype="Battered_Armor" />
  <Icon>Textures\GUI\Icons\Skins\Armor\Battered.dds</Icon>
  <DLC>StylePack</DLC>          <!-- optional -->
  <Textures> ... </Textures>    <!-- ignored: the editor does not draw textures -->
</AssetModifier>
```
- 28 entries; `TestArmor` is a debug entry and is skipped, leaving **27 skins**. All 27 icons decode (names mix `.dds` and `.DDS`; the icon loader ignores case).
- `Data\AssetModifiers\AssetModifiers.sbc` holds 366 more modifiers (character suits and helmets) in a different XML form, with no icons. They are not armor skins and are not read.
- 10 DLC tags appear (StylePack, SparksOfTheFuture, DeluxeEdition, Economy, ScrapRace, Frostbite, Warfare2, HeavyIndustry, Automatons, DecorativeBlocks3).
- The game has **no display names** for skins (no entries in `MyTexts.resx`), so `skin_display_name` builds one: underscores become spaces, a trailing "Armor" is dropped, and a space is inserted before inner capitals.
- The order is the file's order. It has not been compared with the in-game picker (which may sort or hide some entries).

## 7. Output types
`BlockInfo` and `Se1Catalog` derive `Serialize`, so Tauri sends them to TypeScript as JSON. The TypeScript mirrors in `catalog.ts` must keep the same field names.

## 8. Tests
- `finds_install`, `lists_files`: your original tests.
- `uses_the_games_own_categories`: checks category names are readable, function tabs come before DLC packs, the reactor is in Power and the armor block in Armor Blocks. Prints the whole category list with counts.
- `loads_catalog_with_readable_names`: needs a real install. Asserts **zero warnings** and that the light armor block is named "Light Armor Block", is Large, and is 1x1x1.

Run: `cargo test -- --nocapture` inside `src-tauri`.

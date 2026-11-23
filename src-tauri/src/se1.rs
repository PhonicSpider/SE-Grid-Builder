//! Space Engineers 1 game data, read from the player's own install.
//!
//! Nothing from the game is copied into this app. At startup we look for the
//! player's Steam install and read the block definitions straight from it.
//!
//! RUST NOTES (see also the Obsidian vault, "Rust Concepts.md"):
//!   * `Option<T>`  - a value that may be missing: `Some(value)` or `None`.
//!   * `Result<T, E>` - success `Ok(value)` or failure `Err(error)`.
//!   * `?`          - "if this failed, return the error from this function now".
//!   * `&Path`      - borrow a path to look at it, without taking ownership.
//!   * `serde`      - turns XML text into structs automatically.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Step 1 (started by you, extended in the audit): find the game folder.
//
// AUDIT NOTES on what changed from your version:
//   * Your loop over candidate folders and the check for `Content\Data\CubeBlocks`
//     are unchanged; they are now the LAST resort.
//   * Before that, we ask Steam where its libraries are (`libraryfolders.vdf`).
//     Your hard-coded list only worked on this PC; anyone with Steam on another
//     drive would have got "not found".
//   * The "is this a real install" check moved into its own small function so
//     both ways of looking use the same rule.
// ---------------------------------------------------------------------------

/// A folder is a real Space Engineers 1 install only if it holds the block
/// definitions. Some folders exist but are empty shells (C: and D: on the
/// author's PC), so just checking the top folder would not be enough.
fn is_real_install(path: &Path) -> bool {
    path.join("Content").join("Data").join("CubeBlocks").is_dir()
}

/// Pulls the library folders out of the text of Steam's `libraryfolders.vdf`.
///
/// The file lists lines such as `"path"    "H:\\SteamLibrary"` (backslashes are
/// doubled inside the file). Splitting such a line on the quote character gives
/// `["\t\t", "path", "\t\t", "H:\\\\SteamLibrary", ""]`, so the folder is the
/// fourth piece. Kept separate from the file reading so it can be tested with
/// plain text.
fn parse_library_folders(vdf_text: &str) -> Vec<PathBuf> {
    let mut folders = Vec::new();
    for line in vdf_text.lines() {
        let pieces: Vec<&str> = line.split('"').collect();
        if pieces.len() >= 4 && pieces[1] == "path" {
            folders.push(PathBuf::from(pieces[3].replace("\\\\", "\\")));
        }
    }
    folders
}

/// Where Steam itself is installed, according to the Windows registry.
/// (Steam writes its real location there, so this finds it on any drive.)
#[cfg(windows)]
fn steam_roots_from_registry() -> Vec<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let mut roots = Vec::new();
    let places = [
        (HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath"),
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"),
        (HKEY_LOCAL_MACHINE, r"SOFTWARE\Valve\Steam", "InstallPath"),
    ];
    for (hive, key, value) in places {
        if let Ok(opened) = RegKey::predef(hive).open_subkey(key)
            && let Ok(path) = opened.get_value::<String, _>(value)
        {
            roots.push(PathBuf::from(path));
        }
    }
    roots
}

#[cfg(not(windows))]
fn steam_roots_from_registry() -> Vec<PathBuf> {
    Vec::new()
}

/// Every place a Steam folder usually is: the registry's answer, the two
/// standard install folders, and the common names people give a Steam
/// folder or library on any drive letter (`D:\SteamLibrary`, `E:\Games\Steam`...).
fn steam_root_guesses() -> Vec<PathBuf> {
    let mut roots = steam_roots_from_registry();
    roots.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
    roots.push(PathBuf::from(r"C:\Program Files\Steam"));
    for letter in 'A'..='Z' {
        let drive = format!("{letter}:\\");
        if !Path::new(&drive).exists() {
            continue; // no such drive; skipping keeps the search quick
        }
        for folder in [
            "SteamLibrary",
            "Steam",
            r"Games\SteamLibrary",
            r"Games\Steam",
            r"Program Files (x86)\Steam",
            r"Program Files\Steam",
        ] {
            roots.push(PathBuf::from(format!("{drive}{folder}")));
        }
    }
    roots
}

/// The folders Steam says it keeps games in: each guessed Steam folder, plus
/// any further libraries listed in its `libraryfolders.vdf`.
fn steam_library_folders() -> Vec<PathBuf> {
    let mut libraries = Vec::new();
    for root in steam_root_guesses() {
        let vdf_path = root.join("steamapps").join("libraryfolders.vdf");
        if let Ok(text) = fs::read_to_string(vdf_path) {
            libraries.extend(parse_library_folders(&text));
        }
        libraries.push(root); // a Steam folder is a library too
    }
    libraries
}

/// Looks for a real Space Engineers 1 install and returns its folder (the one
/// that contains `Content`). Order: the folder the player chose by hand, then
/// every Steam library found automatically.
pub fn find_install() -> Option<PathBuf> {
    if let Some(saved) = crate::settings::saved_install()
        && is_real_install(&saved)
    {
        return Some(saved);
    }

    for library in steam_library_folders() {
        let path = library.join("steamapps").join("common").join("SpaceEngineers");
        if is_real_install(&path) {
            return Some(path);
        }
    }
    None
}

/// Accepts what the player picked in the folder dialog and returns the real
/// game folder. They may pick the game folder itself, or a folder just above
/// it (a `steamapps\common` folder, or a whole library).
pub fn game_folder_from_choice(chosen: &Path) -> Option<PathBuf> {
    let inside = [
        chosen.to_path_buf(),
        chosen.join("SpaceEngineers"),
        chosen.join("common").join("SpaceEngineers"),
        chosen.join("steamapps").join("common").join("SpaceEngineers"),
    ];
    inside.into_iter().find(|path| is_real_install(path))
}

// ---------------------------------------------------------------------------
// Step 2 (written by you, tightened in the audit): list the block definition files.
//
// AUDIT NOTES: the result is now sorted (the operating system returns files in
// no promised order, so results could differ between runs), and the `.sbc`
// check ignores capital letters.
// ---------------------------------------------------------------------------

/// Returns every `.sbc` file inside `Content\Data\CubeBlocks`, in name order.
/// Returns `Err(message)` if the folder cannot be read.
pub fn list_block_files(install: &Path) -> Result<Vec<PathBuf>, String> {
    let directory = install.join("Content").join("Data").join("CubeBlocks");
    let entries = fs::read_dir(&directory)
        .map_err(|error| format!("cannot read {}: {error}", directory.display()))?;

    let mut files = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let is_sbc = path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("sbc"));
        if is_sbc {
            files.push(path);
        }
    }
    files.sort(); // a stable order, whatever order the disk happened to list them in
    Ok(files)
}

// ---------------------------------------------------------------------------
// Step 3: the shapes of the XML we read.
//
// `#[derive(Deserialize)]` makes serde generate the parsing code for us.
// `#[serde(rename = "...")]` maps the XML's CapitalizedNames to Rust names.
// Any XML element we do not list here is simply ignored.
// ---------------------------------------------------------------------------

/// One `.sbc` file: `<Definitions><CubeBlocks><Definition>...`
#[derive(Debug, Deserialize)]
struct DefinitionsFile {
    #[serde(rename = "CubeBlocks", default)]
    cube_blocks: Option<CubeBlocksSection>,
}

#[derive(Debug, Deserialize)]
struct CubeBlocksSection {
    #[serde(rename = "Definition", default)]
    definitions: Vec<RawBlock>,
}

#[derive(Debug, Deserialize)]
struct RawBlock {
    #[serde(rename = "Id")]
    identifier: RawIdentifier,
    #[serde(rename = "DisplayName", default)]
    display_name: Option<String>,
    #[serde(rename = "CubeSize", default)]
    cube_size: Option<String>,
    #[serde(rename = "Size", default)]
    size: Option<RawSize>,
    #[serde(rename = "Icon", default)]
    icon: Option<String>,
    #[serde(rename = "GuiVisible", default)]
    gui_visible: Option<bool>,
    /// Groups a block with its variants (large and small grid, slopes, corners).
    /// `BlockPositions.sbc` places each group in the G-menu grid by this name.
    #[serde(rename = "BlockPairName", default)]
    block_pair_name: Option<String>,
    /// The 3D model of most blocks: `Models\Cubes\Large\GeneratorLarge.mwm`.
    #[serde(rename = "Model", default)]
    model: Option<String>,
    /// Shifts the model inside the block, in meters (usually zero).
    #[serde(rename = "ModelOffset", default)]
    model_offset: Option<RawOffset>,
    /// Armor-style blocks have no single model; they are built from side plates.
    #[serde(rename = "CubeDefinition", default)]
    cube_definition: Option<RawCubeDefinition>,
}

/// `ModelOffset` appears in the same two forms as `Size`, but with decimals.
#[derive(Debug, Deserialize)]
struct RawOffset {
    #[serde(rename = "@x", alias = "X", default)]
    x: f32,
    #[serde(rename = "@y", alias = "Y", default)]
    y: f32,
    #[serde(rename = "@z", alias = "Z", default)]
    z: f32,
}

/// `<CubeDefinition><CubeTopology>Slope</CubeTopology><Sides><Side Model="..."/>...`
#[derive(Debug, Deserialize)]
struct RawCubeDefinition {
    #[serde(rename = "CubeTopology", default)]
    topology: Option<String>,
    #[serde(rename = "Sides", default)]
    sides: Option<RawSides>,
}

#[derive(Debug, Deserialize)]
struct RawSides {
    #[serde(rename = "Side", default)]
    items: Vec<RawSide>,
}

#[derive(Debug, Deserialize)]
struct RawSide {
    #[serde(rename = "@Model")]
    model: String,
}

#[derive(Debug, Deserialize)]
struct RawIdentifier {
    #[serde(rename = "TypeId")]
    type_id: String,
    // A few blocks have an empty or missing subtype, hence Option.
    #[serde(rename = "SubtypeId", default)]
    subtype_id: Option<String>,
}

/// `Size` appears in TWO forms in the game files; we accept both:
///   `<Size x="1" y="1" z="1" />`                (attributes; "@" means attribute)
///   `<Size><X>1</X><Y>1</Y><Z>1</Z></Size>`     (child elements; `alias` handles it)
///
/// x, y and z are the game's own axis names (they are the XML attribute
/// names), so they are kept as-is.
#[derive(Debug, Deserialize)]
struct RawSize {
    #[serde(rename = "@x", alias = "X")]
    x: i32,
    #[serde(rename = "@y", alias = "Y")]
    y: i32,
    #[serde(rename = "@z", alias = "Z")]
    z: i32,
}

/// The game's text table (`MyTexts.resx`). Block names in the definitions are
/// keys like `DisplayName_Block_LightArmorBlock`; this file maps them to
/// readable names like "Light Armor Block".
#[derive(Debug, Deserialize)]
struct ResourceFile {
    #[serde(rename = "data", default)]
    entries: Vec<ResourceEntry>,
}

#[derive(Debug, Deserialize)]
struct ResourceEntry {
    #[serde(rename = "@name")]
    key: String,
    #[serde(rename = "value", default)]
    text: Option<String>,
}

/// Where the game's G-menu puts each block group (`CubeBlocks\BlockPositions.sbc`).
/// Shape: <BlockPositions><BlockPosition> <Name/> <Position><X/><Y/></Position>...
#[derive(Debug, Deserialize)]
struct PositionsFile {
    #[serde(rename = "BlockPositions", default)]
    positions: Option<PositionList>,
}

#[derive(Debug, Deserialize)]
struct PositionList {
    #[serde(rename = "BlockPosition", default)]
    items: Vec<RawPosition>,
}

#[derive(Debug, Deserialize)]
struct RawPosition {
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "Position")]
    position: RawCell,
}

#[derive(Debug, Deserialize)]
struct RawCell {
    #[serde(rename = "X", default)]
    x: u32,
    #[serde(rename = "Y", default)]
    y: u32,
}

/// How many cells wide the game's block grid is (the file's X runs 0 to 9).
const GRID_COLUMNS: u32 = 10;

/// Reads the G-menu grid: block group name (`BlockPairName`) to its place in
/// reading order (row by row, left to right; 0 = top left).
/// Missing or unreadable file gives an empty map, so every block is simply unplaced.
fn load_grid_positions(install: &Path) -> HashMap<String, u32> {
    let path = install.join("Content").join("Data").join("CubeBlocks").join("BlockPositions.sbc");
    let Ok(text) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    let Ok(parsed) = quick_xml::de::from_str::<PositionsFile>(text.trim_start_matches('\u{feff}')) else {
        return HashMap::new();
    };
    parsed
        .positions
        .map(|list| list.items)
        .unwrap_or_default()
        .into_iter()
        .map(|item| (item.name, item.position.y * GRID_COLUMNS + item.position.x))
        .collect()
}

/// The game's variant groups (`BlockVariantGroups.sbc`). A group is one tile in
/// the game's block menu; the player scrolls through its blocks (slopes,
/// corners, ...) once it is on the toolbar. Shape:
///   <BlockVariantGroups><BlockVariantGroup> <Id Subtype=".."/> <Blocks><Block Subtype=".."/>...
#[derive(Debug, Deserialize)]
struct VariantGroupsFile {
    #[serde(rename = "BlockVariantGroups", default)]
    groups: Option<VariantGroupList>,
}

#[derive(Debug, Deserialize)]
struct VariantGroupList {
    #[serde(rename = "BlockVariantGroup", default)]
    items: Vec<RawVariantGroup>,
}

#[derive(Debug, Deserialize)]
struct RawVariantGroup {
    #[serde(rename = "Id")]
    identifier: RawGroupId,
    #[serde(rename = "Blocks", default)]
    blocks: Option<RawGroupBlocks>,
}

/// Group files write ids as attributes (`<Id Type=".." Subtype=".."/>`),
/// unlike block definitions, which use child elements.
#[derive(Debug, Deserialize)]
struct RawGroupId {
    #[serde(rename = "@Subtype", default)]
    subtype_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawGroupBlocks {
    #[serde(rename = "Block", default)]
    items: Vec<RawGroupId>,
}

/// Which group a block belongs to and where it sits inside it.
#[derive(Debug, Clone, PartialEq)]
struct GroupMembership {
    group: String,
    position: u32,
}

/// Reads the variant groups: block subtype to its group and its place in it.
/// A block listed in several groups keeps the first. Missing or unreadable file
/// gives an empty map, so every block is simply its own tile.
fn load_variant_groups(install: &Path) -> HashMap<String, GroupMembership> {
    let path = install.join("Content").join("Data").join("BlockVariantGroups.sbc");
    let Ok(text) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    parse_variant_groups(&text)
}

/// The text-to-map half of `load_variant_groups`, separate so a test can feed it XML.
fn parse_variant_groups(text: &str) -> HashMap<String, GroupMembership> {
    let Ok(parsed) = quick_xml::de::from_str::<VariantGroupsFile>(text.trim_start_matches('\u{feff}')) else {
        return HashMap::new();
    };
    let mut memberships = HashMap::new();
    for group in parsed.groups.map(|list| list.items).unwrap_or_default() {
        let group_name = group.identifier.subtype_id.unwrap_or_default();
        let members = group.blocks.map(|blocks| blocks.items).unwrap_or_default();
        for (position, member) in members.into_iter().enumerate() {
            let Some(subtype) = member.subtype_id else { continue };
            memberships
                .entry(subtype)
                .or_insert(GroupMembership { group: group_name.clone(), position: position as u32 });
        }
    }
    memberships
}

/// The game's menu categories (`BlockCategories.sbc`). Shape:
///   <CategoryClasses><Category> <Name/> <DisplayName/> <ItemIds><string>Type/Subtype</string>...
#[derive(Debug, Deserialize)]
struct CategoriesFile {
    #[serde(rename = "CategoryClasses", default)]
    classes: Option<CategoryClasses>,
}

#[derive(Debug, Deserialize)]
struct CategoryClasses {
    #[serde(rename = "Category", default)]
    categories: Vec<RawCategory>,
}

#[derive(Debug, Deserialize)]
struct RawCategory {
    /// Internal name such as `Section1_Position3_Power`. The game sorts its
    /// menu by this, so the "Section" and "Position" parts give the order.
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "DisplayName", default)]
    display_name: Option<String>,
    #[serde(rename = "IsBlockCategory", default)]
    is_block_category: Option<bool>,
    #[serde(rename = "ItemIds", default)]
    item_ids: Option<RawItemIds>,
}

#[derive(Debug, Deserialize)]
struct RawItemIds {
    /// Each entry reads `TypeId/SubtypeId`, for example `Reactor/LargeBlockLargeGenerator`.
    #[serde(rename = "string", default)]
    items: Vec<String>,
}

/// Armor skins (`Data\AssetModifiers\ArmorModifiers.sbc`). Shape:
///   <AssetModifiers><AssetModifier>
///     <Id Type="AssetModifierDefinition" Subtype="Battered_Armor" />
///     <Icon>Textures\GUI\Icons\Skins\Armor\Battered.dds</Icon>
///     <DLC>StylePack</DLC>          (optional, may repeat)
///     <Textures> ... </Textures>    (ignored)
#[derive(Debug, Deserialize)]
struct SkinsFile {
    #[serde(rename = "AssetModifiers", default)]
    modifiers: Option<RawModifiers>,
}

#[derive(Debug, Deserialize)]
struct RawModifiers {
    #[serde(rename = "AssetModifier", default)]
    items: Vec<RawModifier>,
}

#[derive(Debug, Deserialize)]
struct RawModifier {
    #[serde(rename = "Id")]
    id: RawModifierId,
    #[serde(rename = "Icon", default)]
    icon: Option<String>,
    #[serde(rename = "DLC", default)]
    dlc: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct RawModifierId {
    #[serde(rename = "@Subtype")]
    subtype: String,
}

// ---------------------------------------------------------------------------
// The clean shape sent to the front-end. `Serialize` lets Tauri turn it
// into JSON for the TypeScript side.
// ---------------------------------------------------------------------------

/// Which part of the game's menu a category belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CategoryKind {
    /// What a block does: Armor, Power, Propulsion, Weapons, ...
    Function,
    /// A DLC pack: Warfare 1, Decorative Pack, ...
    Dlc,
}

/// One entry of the game's block menu.
#[derive(Debug, Clone, Serialize)]
pub struct CategoryInfo {
    /// Internal name, used to match blocks to categories.
    pub key: String,
    pub display_name: String,
    pub kind: CategoryKind,
}

#[derive(Debug, Clone, Serialize)]
pub struct BlockInfo {
    /// XML type, for example "CubeBlock" or "Conveyor". The export writes it
    /// as `MyObjectBuilder_<type_id>`.
    pub type_id: String,
    pub subtype_id: String,
    pub display_name: String,
    /// Keys of the game categories this block belongs to (it can be in several,
    /// for example Power and a DLC pack). Empty if the game lists it in none.
    pub categories: Vec<String>,
    /// Same length as `categories`: where the game lists this block inside each
    /// of those categories (0 = first). Used to show blocks in the game's order.
    pub category_positions: Vec<u32>,
    /// Where this block appears across the game's block definition files, read in
    /// file-name order (0 = first). The game's armor menu follows this order.
    pub definition_order: u32,
    /// Where the game's G-menu grid places this block's group, in reading order
    /// (0 = top left). None for blocks the game leaves unplaced; the game lists
    /// those after the placed ones, in category order.
    pub grid_position: Option<u32>,
    /// The game's variant group this block belongs to (one menu tile; the others
    /// are reached by scrolling). None if the block stands alone.
    pub variant_group: Option<String>,
    /// Where the block sits inside its variant group (0 = the group's first block,
    /// the one shown on the tile).
    pub variant_position: u32,
    /// "Large" or "Small" (large-grid ships versus small-grid ships).
    pub cube_size: String,
    /// Size in grid cells: [x, y, z].
    pub size: [i32; 3],
    pub icon: Option<String>,
    /// False for shape variants (slopes, corners) the game hides from its G-menu.
    pub shown_in_game_menu: bool,
    /// The block's 3D model, for example `Models\Cubes\Large\GeneratorLarge.mwm`.
    /// None for armor-style blocks, which use `side_models` instead.
    pub model: Option<String>,
    /// Shifts the model inside the block, in meters: [x, y, z].
    pub model_offset: [f32; 3],
    /// The shape family of an armor-style block ("Box", "Slope", "Corner", ...).
    pub cube_topology: Option<String>,
    /// The side plates of an armor-style block, in the game's order.
    pub side_models: Vec<String>,
}

/// One armor skin from the game's skin picker.
#[derive(Debug, Clone, Serialize)]
pub struct SkinInfo {
    /// The value written to `<SkinSubtypeId>` in a blueprint, for example `Battered_Armor`.
    pub subtype_id: String,
    /// The game has no display names for skins, so this is made from the subtype.
    pub display_name: String,
    /// Icon path, loadable with `load_icon_png`.
    pub icon: Option<String>,
    /// DLC packs that own this skin (empty for free skins).
    pub dlc: Vec<String>,
}

/// Everything the front-end needs about the player's SE1 install.
#[derive(Debug, Serialize)]
pub struct Se1Catalog {
    pub install_path: String,
    /// The game's menu categories, in the game's own order.
    pub categories: Vec<CategoryInfo>,
    /// Armor skins for the paint tool, in the game's file order.
    pub skins: Vec<SkinInfo>,
    pub blocks: Vec<BlockInfo>,
    /// Files that failed to parse. One odd file must not hide the other blocks.
    pub warnings: Vec<String>,
}

/// Reads the English text table. Returns an empty map when it cannot be read,
/// in which case blocks simply keep their raw key as the name.
fn load_display_names(install: &Path) -> HashMap<String, String> {
    let path = install
        .join("Content")
        .join("Data")
        .join("Localization")
        .join("MyTexts.resx");

    let Ok(text) = fs::read_to_string(&path) else {
        return HashMap::new();
    };
    let Ok(resource_file) = quick_xml::de::from_str::<ResourceFile>(text.trim_start_matches('\u{feff}'))
    else {
        return HashMap::new();
    };

    let mut names = HashMap::new();
    for entry in resource_file.entries {
        if let Some(text) = entry.text {
            names.insert(entry.key, text);
        }
    }
    names
}

/// Decides whether a game category is one we show in the menu, and which kind.
///
/// The game file holds 49 categories, but most are not ship-block menus:
///   * `Section0_*`            character items, tools, food (not blocks)
///   * `..._LargeBlocks/SmallBlocks/Nonarmor`  "all blocks" search filters
///   * `ShipWeapons`, `ShipTools`  hand-held tool groups
///
/// What we keep:
///   * `Section1_Position2_Armorblocks` and `Section1_Position3_*`  (the function tabs)
///   * `Section2_DLC_*`  (one per DLC pack)
fn category_kind(name: &str) -> Option<CategoryKind> {
    if name == "Section1_Position2_Armorblocks" || name.starts_with("Section1_Position3_") {
        Some(CategoryKind::Function)
    } else if name.starts_with("Section2_DLC_") {
        Some(CategoryKind::Dlc)
    } else {
        None
    }
}

/// Maps `"TypeId/SubtypeId"` to every category that lists that block, with the
/// block's position in that category's list. The game shows blocks in list
/// order, so the position lets the menu match it.
type CategoriesByItem = HashMap<String, Vec<(String, u32)>>;

/// Reads the game's menu categories.
///
/// Returns the categories in menu order, plus the block-to-categories map.
fn load_categories(
    install: &Path,
    display_names: &HashMap<String, String>,
) -> Result<(Vec<CategoryInfo>, CategoriesByItem), String> {
    let path = install.join("Content").join("Data").join("BlockCategories.sbc");
    let text = fs::read_to_string(&path).map_err(|error| format!("BlockCategories.sbc: {error}"))?;
    let parsed = quick_xml::de::from_str::<CategoriesFile>(text.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("BlockCategories.sbc: {error}"))?;
    let raw_categories = parsed.classes.map(|classes| classes.categories).unwrap_or_default();

    let mut categories = Vec::new();
    let mut categories_by_item = CategoriesByItem::new();

    for raw in raw_categories {
        if raw.is_block_category == Some(false) {
            continue;
        }
        let Some(kind) = category_kind(&raw.name) else {
            continue;
        };

        let key = raw.name.clone();
        let label_key = raw.display_name.unwrap_or_else(|| key.clone());
        let display_name = display_names.get(&label_key).cloned().unwrap_or(label_key);

        let items = raw.item_ids.map(|ids| ids.items).unwrap_or_default();
        for (position, item) in items.iter().enumerate() {
            categories_by_item
                .entry(item.trim().to_string())
                .or_default()
                .push((key.clone(), position as u32));
        }
        categories.push(CategoryInfo { key, display_name, kind });
    }

    // The game orders its menu by internal name ("Section1..." before "Section2...").
    categories.sort_by(|left, right| left.key.cmp(&right.key));
    Ok((categories, categories_by_item))
}

/// Turns a skin subtype into a readable name: "DigitalCamouflage_Armor" becomes
/// "Digital Camouflage". Underscores become spaces, a trailing "Armor" is
/// dropped, and a space is added before each capital letter inside a word.
fn skin_display_name(subtype: &str) -> String {
    let mut words = Vec::new();
    for piece in subtype.split('_').filter(|piece| !piece.is_empty()) {
        let mut word = String::new();
        let mut previous_was_lowercase = false;
        for character in piece.chars() {
            if character.is_uppercase() && previous_was_lowercase {
                word.push(' ');
            }
            previous_was_lowercase = character.is_lowercase();
            word.push(character);
        }
        words.push(word);
    }
    if words.len() > 1 && words.last().is_some_and(|last| last == "Armor") {
        words.pop();
    }
    words.join(" ")
}

/// Reads the armor skins. `TestArmor` is a debug entry and is left out.
fn load_skins(install: &Path) -> Result<Vec<SkinInfo>, String> {
    let path = install.join("Content").join("Data").join("AssetModifiers").join("ArmorModifiers.sbc");
    let text = fs::read_to_string(&path).map_err(|error| format!("ArmorModifiers.sbc: {error}"))?;
    let parsed = quick_xml::de::from_str::<SkinsFile>(text.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("ArmorModifiers.sbc: {error}"))?;

    let mut skins = Vec::new();
    for raw in parsed.modifiers.map(|modifiers| modifiers.items).unwrap_or_default() {
        if raw.id.subtype == "TestArmor" {
            continue;
        }
        skins.push(SkinInfo {
            display_name: skin_display_name(&raw.id.subtype),
            subtype_id: raw.id.subtype,
            icon: raw.icon,
            dlc: raw.dlc,
        });
    }
    Ok(skins)
}

/// One step of the start-up, reported while the catalog loads so the loading
/// screen can show what is happening. `tag = "kind"` makes serde write
/// `{ "kind": "blocks", "found": 3, "total": 10 }`, which TypeScript can tell
/// apart by its `kind` field.
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LoadProgress {
    /// A line of text for the loading screen's log.
    Message { text: String },
    /// How many block definitions have been read out of how many there are.
    Blocks { found: usize, total: usize },
}

/// Parses every block definition in the install and builds the catalog,
/// without reporting progress (the tests use this one).
#[cfg(test)]
pub fn load_catalog(install: &Path) -> Result<Se1Catalog, String> {
    load_catalog_with_progress(install, &mut |_| {})
}

/// Like `load_catalog`, but calls `report` as it works. `report` is a
/// `&mut dyn FnMut`: "any function I may call, which is allowed to change
/// what it captured".
pub fn load_catalog_with_progress(
    install: &Path,
    report: &mut dyn FnMut(LoadProgress),
) -> Result<Se1Catalog, String> {
    let message = |text: &str| LoadProgress::Message { text: text.to_string() };

    report(message("Reading the game's text table..."));
    let display_names = load_display_names(install);
    let files = list_block_files(install)?;

    let mut blocks = Vec::new();
    let mut warnings = Vec::new();

    // Skins are optional too: without them the skin picker is simply empty.
    report(message("Reading armor skins..."));
    let skins = load_skins(install).unwrap_or_else(|error| {
        warnings.push(error);
        Vec::new()
    });
    report(message(&format!("Found {} armor skins.", skins.len())));

    // If the category file cannot be read the editor still works; every block
    // is simply uncategorized, and we say so in the warnings.
    let grid_positions = load_grid_positions(install);
    let variant_groups = load_variant_groups(install);

    report(message("Reading the block menu categories..."));
    let (categories, categories_by_item) = load_categories(install, &display_names).unwrap_or_else(|error| {
        warnings.push(error);
        (Vec::new(), HashMap::new())
    });

    // First read every file (fast), counting the definitions in them, so the
    // loading screen can say "found 300 of 1240" instead of just counting up.
    // The count is a cheap text search; the real number replaces it at the end.
    report(message(&format!("Reading {} block definition files...", files.len())));
    let mut texts = Vec::new();
    let mut total = 0;
    for path in files {
        let file_name = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        match fs::read_to_string(&path) {
            Ok(text) => {
                // "<Definition " (with the space) skips the "<Definitions>" wrapper.
                total += text.matches("<Definition ").count();
                texts.push((file_name, text));
            }
            Err(error) => warnings.push(format!("{file_name}: {error}")),
        }
    }
    report(LoadProgress::Blocks { found: 0, total });

    for (file_name, text) in texts {
        // Some game files start with a byte-order mark that confuses the parser.
        let text = text.trim_start_matches('\u{feff}');

        let parsed = match quick_xml::de::from_str::<DefinitionsFile>(text) {
            Ok(parsed) => parsed,
            Err(error) => {
                warnings.push(format!("{file_name}: {error}"));
                continue;
            }
        };
        let Some(section) = parsed.cube_blocks else {
            continue; // e.g. BlockPositions.sbc has no CubeBlocks
        };

        for raw in section.definitions {
            // GuiVisible=false does NOT mean unusable. The game hides armor
            // slopes, corners and other shape variants from the G-menu and
            // groups them with their base block. We keep them (flagged) because
            // ships need them.
            let raw_name = raw.display_name.unwrap_or_default();
            let readable_name = display_names.get(&raw_name).cloned().unwrap_or(raw_name);

            let type_id = raw.identifier.type_id;
            let subtype_id = raw.identifier.subtype_id.unwrap_or_default();
            // The game lists blocks in its categories as "TypeId/SubtypeId".
            let memberships = categories_by_item
                .get(&format!("{type_id}/{subtype_id}"))
                .cloned()
                .unwrap_or_default();
            // Two lists of the same length: which categories, and the position in each.
            let block_categories: Vec<String> = memberships.iter().map(|(key, _)| key.clone()).collect();
            let block_positions: Vec<u32> = memberships.iter().map(|(_, position)| *position).collect();

            let group_membership = variant_groups.get(&subtype_id).cloned();

            blocks.push(BlockInfo {
                type_id,
                subtype_id,
                display_name: readable_name,
                categories: block_categories,
                category_positions: block_positions,
                // Counted before the alphabetical sort below, so it keeps the file order.
                definition_order: blocks.len() as u32,
                grid_position: raw
                    .block_pair_name
                    .as_ref()
                    .and_then(|pair| grid_positions.get(pair.trim()).copied()),
                variant_group: group_membership.as_ref().map(|member| member.group.clone()),
                variant_position: group_membership.as_ref().map(|member| member.position).unwrap_or(0),
                cube_size: raw.cube_size.unwrap_or_default(),
                size: raw.size.map(|size| [size.x, size.y, size.z]).unwrap_or([1, 1, 1]),
                icon: raw.icon,
                shown_in_game_menu: raw.gui_visible.unwrap_or(true),
                model: raw.model.filter(|model| !model.trim().is_empty()),
                model_offset: raw.model_offset.map(|offset| [offset.x, offset.y, offset.z]).unwrap_or([0.0; 3]),
                cube_topology: raw.cube_definition.as_ref().and_then(|cube| cube.topology.clone()),
                side_models: raw
                    .cube_definition
                    .and_then(|cube| cube.sides)
                    .map(|sides| sides.items.into_iter().map(|side| side.model).collect())
                    .unwrap_or_default(),
            });
        }
        report(LoadProgress::Blocks { found: blocks.len(), total: total.max(blocks.len()) });
    }
    // The real total replaces the estimate, so the counter ends on "N of N".
    report(LoadProgress::Blocks { found: blocks.len(), total: blocks.len() });

    // Stable order makes the menu predictable.
    blocks.sort_by(|left, right| {
        left.display_name
            .cmp(&right.display_name)
            .then_with(|| left.subtype_id.cmp(&right.subtype_id))
    });

    Ok(Se1Catalog {
        install_path: install.display().to_string(),
        categories,
        skins,
        blocks,
        warnings,
    })
}

// ---------------------------------------------------------------------------
// Block icons
//
// The game stores each block's icon as a `.dds` image (BC7 compressed, 128x128).
// Browsers cannot show DDS, so we decode it here and hand back a PNG. Nothing is
// copied or saved: the icon is read from the player's own install each time.
// ---------------------------------------------------------------------------

/// Turns a path from the game's own data (an icon, a model, ...) into a real
/// file inside the install's `Content` folder. Paths look like
/// `Textures\GUI\Icons\Cubes\light_armor_cube.dds` and may use either slash.
///
/// Some of these paths pass through the front-end, so they are checked
/// strictly: the file must have the wanted extension (`.dds`, `.mwm`; case
/// does not matter), the path must be plain folder names (no `..`, no drive
/// letters, no leading slash), and the final location, after following any
/// shortcuts, must still be inside `Content`.
pub fn resolve_content_file(install: &Path, relative: &str, extension: &str) -> Result<PathBuf, String> {
    let normalized = relative.replace('\\', "/");
    let relative_path = Path::new(&normalized);

    let has_extension = relative_path
        .extension()
        .and_then(|found| found.to_str())
        .is_some_and(|found| found.eq_ignore_ascii_case(extension));
    if !has_extension {
        return Err(format!("not a .{extension} file: {relative}"));
    }
    for component in relative_path.components() {
        if !matches!(component, std::path::Component::Normal(_)) {
            return Err(format!("path may only contain plain folder names: {relative}"));
        }
    }

    let content_folder = install.join("Content");
    let canonical_content = content_folder
        .canonicalize()
        .map_err(|error| format!("cannot read {}: {error}", content_folder.display()))?;
    let canonical_file = content_folder
        .join(relative_path)
        .canonicalize()
        .map_err(|error| format!("file not found ({relative}): {error}"))?;

    // canonicalize resolves shortcuts and symlinks, so this also catches those.
    if !canonical_file.starts_with(&canonical_content) {
        return Err(format!("file is outside the game's Content folder: {relative}"));
    }
    Ok(canonical_file)
}

/// The same check for `.dds` icons.
pub fn resolve_icon_path(install: &Path, relative: &str) -> Result<PathBuf, String> {
    resolve_content_file(install, relative, "dds")
}

/// Reads a block icon from the game and returns it as PNG bytes.
pub fn load_icon_png(install: &Path, relative: &str) -> Result<Vec<u8>, String> {
    let path = resolve_icon_path(install, relative)?;
    let file = fs::File::open(&path).map_err(|error| format!("cannot open {}: {error}", path.display()))?;

    let dds = image_dds::ddsfile::Dds::read(std::io::BufReader::new(file))
        .map_err(|error| format!("not a valid DDS file ({relative}): {error}"))?;
    // Mipmap 0 is the full-size image; the others are smaller copies.
    let image = image_dds::image_from_dds(&dds, 0)
        .map_err(|error| format!("cannot decode {relative}: {error}"))?;

    let mut png = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|error| format!("cannot encode PNG for {relative}: {error}"))?;
    Ok(png)
}

/// Decodes a block texture (`ColorMetalTexture`, a `.dds` file) to a PNG no wider
/// than `max_size` pixels.
///
/// Game textures are usually 2048 x 2048. A DDS file stores smaller copies of the
/// picture ("mipmaps": 1024, 512, 256 ...), so the biggest copy that still fits
/// is decoded instead of the full one. That is about 16 times less work and
/// memory, and a block on screen is small anyway.
///
/// The picture is returned as stored. The alpha channel of these textures is not
/// transparency (the viewer ignores it for drawing).
pub fn load_texture_png(install: &Path, relative: &str, max_size: u32) -> Result<Vec<u8>, String> {
    let path = resolve_content_file(install, relative, "dds")?;
    let file = fs::File::open(&path).map_err(|error| format!("cannot open {}: {error}", path.display()))?;
    let dds = image_dds::ddsfile::Dds::read(std::io::BufReader::new(file))
        .map_err(|error| format!("not a valid DDS file ({relative}): {error}"))?;

    // The first mipmap level whose width fits; the last level if none does.
    let levels = dds.get_num_mipmap_levels().max(1);
    let width = dds.get_width().max(1);
    let level = (0..levels).find(|level| (width >> level) <= max_size).unwrap_or(levels - 1);
    let image = image_dds::image_from_dds(&dds, level)
        .map_err(|error| format!("cannot decode {relative}: {error}"))?;

    let mut png = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|error| format!("cannot encode PNG for {relative}: {error}"))?;
    Ok(png)
}

// ---------------------------------------------------------------------------
// Tests: run with `cargo test -- --nocapture` from the src-tauri folder.
// These read your real install, so they only make sense on a PC with the game.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_install() {
        let path = find_install().expect("not found");
        println!("{}", path.display());
        assert!(path.join("Content").join("Data").join("CubeBlocks").is_dir());
    }

    #[test]
    fn reads_library_folders_from_steam_text() {
        // The format of Steam's libraryfolders.vdf: backslashes are doubled inside the file.
        let sample = "\"libraryfolders\"
{
	\"0\"
	{
		\"path\"		\"C:\\Program Files (x86)\\Steam\"
		\"label\"		\"\"
	}
	\"1\"
	{
		\"path\"		\"H:\\SteamLibrary\"
	}
}";
        let folders = parse_library_folders(sample);
        assert_eq!(
            folders,
            vec![PathBuf::from(r"C:\Program Files (x86)\Steam"), PathBuf::from(r"H:\SteamLibrary")]
        );
        // Lines that are not paths, and empty text, give nothing.
        assert!(parse_library_folders("").is_empty());
        assert!(parse_library_folders("\"label\"		\"My games\"").is_empty());
    }

    #[test]
    fn block_files_come_back_sorted() {
        let install = find_install().expect("not found");
        let files = list_block_files(&install).expect("could not list");
        let mut sorted = files.clone();
        sorted.sort();
        assert_eq!(files, sorted);
    }

    #[test]
    fn variant_groups_map_each_block_to_its_group_and_place() {
        let xml = r#"<Definitions><BlockVariantGroups>
            <BlockVariantGroup><Id Type="T" Subtype="CubeGroup" /><Blocks>
                <Block Type="B" Subtype="Cube" /><Block Type="B" Subtype="Slope" />
            </Blocks></BlockVariantGroup>
            <BlockVariantGroup><Id Type="T" Subtype="OtherGroup" /><Blocks>
                <Block Type="B" Subtype="Slope" /><Block Type="B" Subtype="Ramp" />
            </Blocks></BlockVariantGroup>
        </BlockVariantGroups></Definitions>"#;
        let map = parse_variant_groups(xml);
        assert_eq!(map["Cube"], GroupMembership { group: "CubeGroup".into(), position: 0 });
        assert_eq!(map["Slope"], GroupMembership { group: "CubeGroup".into(), position: 1 });
        assert_eq!(map["Ramp"], GroupMembership { group: "OtherGroup".into(), position: 1 });
    }

    #[test]
    fn the_game_grid_puts_the_light_armor_block_first() {
        let install = find_install().expect("not found");
        let catalog = load_catalog(&install).expect("load failed");
        let mut placed: Vec<_> = catalog
            .blocks
            .iter()
            .filter(|block| block.cube_size == "Large" && block.grid_position.is_some())
            .collect();
        placed.sort_by_key(|block| (block.grid_position, block.definition_order));
        assert_eq!(placed[0].subtype_id, "LargeBlockArmorBlock");
        assert_eq!(placed[0].grid_position, Some(0));
        // The heavy armor block is the next cell over.
        let heavy = placed.iter().find(|block| block.subtype_id == "LargeHeavyBlockArmorBlock").expect("no heavy armor");
        assert_eq!(heavy.grid_position, Some(1));
        assert!(placed.len() > 50, "only {} blocks were placed in the grid", placed.len());
    }

    #[test]
    fn the_light_armor_slope_is_a_variant_of_the_light_armor_block() {
        let install = find_install().expect("not found");
        let catalog = load_catalog(&install).expect("load failed");
        let find = |name: &str| catalog.blocks.iter().find(|block| block.subtype_id == name).expect("missing block");
        let cube = find("LargeBlockArmorBlock");
        let slope = find("LargeBlockArmorSlope");
        assert_eq!(cube.variant_group.as_deref(), Some("ArmorLightCubeGroup"));
        assert_eq!(cube.variant_position, 0);
        assert_eq!(slope.variant_group.as_deref(), Some("ArmorLightCubeGroup"));
        assert_eq!(slope.variant_position, 1);
    }

    #[test]
    fn loading_reports_progress_that_ends_on_the_real_block_count() {
        let install = find_install().expect("not found");
        let mut reports = Vec::new();
        let catalog = load_catalog_with_progress(&install, &mut |progress| reports.push(progress)).expect("load failed");

        // Some text lines came first, then block counts that never go backwards.
        assert!(reports.iter().any(|report| matches!(report, LoadProgress::Message { .. })));
        let mut last_found = 0;
        for report in &reports {
            if let LoadProgress::Blocks { found, .. } = report {
                assert!(*found >= last_found, "the counter went backwards");
                last_found = *found;
            }
        }
        // The very last report says "N of N" with N the real number of blocks.
        match reports.last() {
            Some(LoadProgress::Blocks { found, total }) => {
                assert_eq!((*found, *total), (catalog.blocks.len(), catalog.blocks.len()));
            }
            other => panic!("expected a final block count, got {other:?}"),
        }
    }

    #[test]
    fn picking_a_parent_folder_still_finds_the_game() {
        let root = std::env::temp_dir().join("se-grid-builder-choice-test");
        let game = root.join("steamapps").join("common").join("SpaceEngineers");
        fs::create_dir_all(game.join("Content").join("Data").join("CubeBlocks")).unwrap();

        // The game folder itself, the library, and `common` all lead to the game.
        assert_eq!(game_folder_from_choice(&game), Some(game.clone()));
        assert_eq!(game_folder_from_choice(&root), Some(game.clone()));
        assert_eq!(game_folder_from_choice(&root.join("steamapps").join("common")), Some(game.clone()));
        // An unrelated folder does not.
        assert_eq!(game_folder_from_choice(&std::env::temp_dir().join("nothing-here")), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn lists_files() {
        let install = find_install().expect("not found");
        let files = list_block_files(&install).expect("could not list");
        println!("{} files", files.len());
        assert!(files.len() > 40);
    }

    #[test]
    fn uses_the_games_own_categories() {
        let install = find_install().expect("not found");
        let catalog = load_catalog(&install).expect("catalog failed");

        println!("-- categories in menu order --");
        for category in &catalog.categories {
            let count = catalog.blocks.iter().filter(|block| block.categories.contains(&category.key)).count();
            println!("{:?} {} ({}): {count} blocks", category.kind, category.display_name, category.key);
        }
        let uncategorized: Vec<_> = catalog.blocks.iter().filter(|block| block.categories.is_empty()).collect();
        println!("{} of {} blocks are in no category", uncategorized.len(), catalog.blocks.len());
        for block in uncategorized.iter().take(15) {
            println!("  uncategorized: {}/{} ({})", block.type_id, block.subtype_id, block.display_name);
        }

        // Names must be readable, not raw text keys.
        assert!(catalog.categories.iter().all(|category| !category.display_name.starts_with("DisplayName_")));
        // The function tabs come first, DLC packs after, like the game.
        let first_dlc = catalog.categories.iter().position(|category| category.kind == CategoryKind::Dlc).unwrap();
        assert!(catalog.categories[..first_dlc].iter().all(|category| category.kind == CategoryKind::Function));

        let reactor = catalog.blocks.iter().find(|block| block.subtype_id == "LargeBlockLargeGenerator").unwrap();
        assert!(reactor.categories.contains(&"Section1_Position3_Power".to_string()));
        let armor = catalog.blocks.iter().find(|block| block.subtype_id == "LargeBlockArmorBlock").unwrap();
        assert!(armor.categories.contains(&"Section1_Position2_Armorblocks".to_string()));
    }

    #[test]
    fn icon_paths_cannot_escape_the_content_folder() {
        let install = find_install().expect("not found");
        for bad in [
            r"..\..\Bin64\Havok.dll",
            r"Textures\..\..\Bin64\Havok.dll",
            r"C:\Windows\win.ini",
            r"\Windows\win.ini",
            r"Textures\GUI\Icons\Cubes\light_armor_cube.png", // wrong type
            r"Data\BlockCategories.sbc",                          // wrong type
            "",
        ] {
            assert!(resolve_icon_path(&install, bad).is_err(), "should reject: {bad}");
        }
        // A normal icon is accepted, with either kind of slash.
        assert!(resolve_icon_path(&install, r"Textures\GUI\Icons\Cubes\light_armor_cube.dds").is_ok());
        assert!(resolve_icon_path(&install, "Textures/GUI/Icons/Cubes/light_armor_cube.dds").is_ok());
    }

    #[test]
    fn decodes_a_real_icon_to_png() {
        let install = find_install().expect("not found");
        let png = load_icon_png(&install, r"Textures\GUI\Icons\Cubes\light_armor_cube.dds").expect("decode failed");
        // Every PNG starts with these 8 bytes; width and height are at bytes 16 to 23.
        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        let width = u32::from_be_bytes([png[16], png[17], png[18], png[19]]);
        let height = u32::from_be_bytes([png[20], png[21], png[22], png[23]]);
        println!("light armor icon: {width}x{height}, {} bytes", png.len());
        assert_eq!((width, height), (128, 128));
    }

    #[test]
    fn decodes_a_block_texture_at_the_requested_size() {
        let install = find_install().expect("not found");
        // Ask the plate model which texture it uses, so the test does not hard-code a path.
        let plate = crate::mwm::load_model(&install, r"Models\Cubes\Large\Armor\HeavySquarePlate.mwm", 0).expect("plate");
        let texture = plate.parts[0].color_texture.clone();
        println!("texture: {texture}");
        // This texture is 4096 wide, so asking for up to 4096 gives it whole.
        for (wanted, expected_width) in [(512, 512), (256, 256), (4096, 4096)] {
            let png = load_texture_png(&install, &texture, wanted).expect("decode failed");
            assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
            let width = u32::from_be_bytes([png[16], png[17], png[18], png[19]]);
            assert_eq!(width, expected_width, "wanted at most {wanted}");
        }
        // A path that leaves the game folder is refused.
        assert!(load_texture_png(&install, r"..\..\Bin64\x.dds", 512).is_err());
    }

    /// Prints what the alpha channel of block textures holds (mask or metalness?).
    #[test]
    #[ignore = "exploration: prints texture statistics"]
    fn texture_alpha_statistics() {
        let install = find_install().expect("not found");
        for name in [
            "large_heavy_square_plate_cm.dds",
            "Atlas1_cm.DDS",
            "Atlas1Colorable_cm.DDS",
            "Atlas3_Colorable_cm.DDS",
            "Aluminium_cm.DDS",
        ] {
            let path = install.join("Content").join("Textures").join("Models").join("Cubes").join(name);
            let Ok(file) = fs::File::open(&path) else {
                println!("{name}: missing");
                continue;
            };
            let dds = image_dds::ddsfile::Dds::read(std::io::BufReader::new(file)).unwrap();
            let image = image_dds::image_from_dds(&dds, 4).unwrap();
            let pixels = image.as_raw();
            let (mut low, mut high, mut total_alpha) = (0u64, 0u64, 0u64);
            let (mut red, mut green, mut blue) = (0u64, 0u64, 0u64);
            for pixel in pixels.as_chunks::<4>().0 {
                total_alpha += u64::from(pixel[3]);
                red += u64::from(pixel[0]);
                green += u64::from(pixel[1]);
                blue += u64::from(pixel[2]);
                if pixel[3] < 40 { low += 1 } else if pixel[3] > 215 { high += 1 }
            }
            let count = (pixels.len() / 4) as u64;
            println!(
                "{name}: {}x{} mean rgb=({}, {}, {}) mean alpha={} low-alpha={}% high-alpha={}%",
                image.width(), image.height(), red / count, green / count, blue / count,
                total_alpha / count, low * 100 / count, high * 100 / count
            );
        }
    }

    #[test]
    fn every_block_icon_in_the_catalog_decodes() {
        let install = find_install().expect("not found");
        let catalog = load_catalog(&install).expect("catalog failed");
        let mut failures = Vec::new();
        let mut checked = 0;
        for block in &catalog.blocks {
            let Some(icon) = &block.icon else {
                failures.push(format!("{}: no icon", block.subtype_id));
                continue;
            };
            checked += 1;
            if let Err(error) = load_icon_png(&install, icon) {
                failures.push(format!("{}/{}: {error}", block.type_id, block.subtype_id));
            }
        }
        println!("{checked} icons checked, {} problems", failures.len());
        for failure in failures.iter().take(15) {
            println!("  {failure}");
        }
        // A few blocks may legitimately lack a usable icon, but not many.
        assert!(failures.len() * 100 < catalog.blocks.len(), "too many icon failures");
    }

    #[test]
    fn skin_names_are_readable() {
        assert_eq!(skin_display_name("DigitalCamouflage_Armor"), "Digital Camouflage");
        assert_eq!(skin_display_name("Battered_Armor"), "Battered");
        assert_eq!(skin_display_name("Heavy_Rust_Armor"), "Heavy Rust");
        assert_eq!(skin_display_name("Neon_Colorable_Lights"), "Neon Colorable Lights");
        assert_eq!(skin_display_name("Weldless"), "Weldless");
        assert_eq!(skin_display_name("Armor"), "Armor"); // a lone word is kept
    }

    #[test]
    fn loads_the_armor_skins_and_their_icons() {
        let install = find_install().expect("not found");
        let catalog = load_catalog(&install).expect("catalog failed");
        println!("{} skins", catalog.skins.len());
        for skin in catalog.skins.iter().take(5) {
            println!("  {} -> {} {:?}", skin.subtype_id, skin.display_name, skin.dlc);
        }
        assert!(catalog.skins.len() >= 25, "expected the game's armor skins");
        assert!(!catalog.skins.iter().any(|skin| skin.subtype_id == "TestArmor"));

        let battered = catalog.skins.iter().find(|skin| skin.subtype_id == "Battered_Armor").expect("Battered missing");
        assert!(battered.dlc.is_empty(), "Battered is a free skin");
        let camouflage = catalog.skins.iter().find(|skin| skin.subtype_id == "DigitalCamouflage_Armor").unwrap();
        assert_eq!(camouflage.dlc, vec!["StylePack".to_string()]);

        // Every skin icon must decode (the file names mix .dds and .DDS).
        for skin in &catalog.skins {
            let icon = skin.icon.as_ref().unwrap_or_else(|| panic!("{} has no icon", skin.subtype_id));
            load_icon_png(&install, icon).unwrap_or_else(|error| panic!("{}: {error}", skin.subtype_id));
        }
    }

    #[test]
    fn loads_catalog_with_readable_names() {
        let install = find_install().expect("not found");
        let catalog = load_catalog(&install).expect("catalog failed");
        println!("{} blocks, {} warnings", catalog.blocks.len(), catalog.warnings.len());
        assert!(catalog.warnings.is_empty(), "warnings: {:?}", catalog.warnings);

        let light_armor = catalog
            .blocks
            .iter()
            .find(|block| block.subtype_id == "LargeBlockArmorBlock")
            .expect("light armor block missing");
        assert_eq!(light_armor.display_name, "Light Armor Block");
        assert_eq!(light_armor.cube_size, "Large");
        assert_eq!(light_armor.size, [1, 1, 1]);
    }
}

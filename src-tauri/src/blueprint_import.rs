//! Reads a Space Engineers 1 blueprint (`bp.sbc`) back into a list of blocks.
//!
//! This is the reverse of `blueprint.rs`: that file writes the game's XML, this
//! one reads it. The front-end then matches each block against the player's own
//! block list and places the ones it knows (blocks from mods are left out).
//!
//! WHAT IS READ
//!   * The ship's name, and for the main grid: its size (Large or Small) and
//!     every block's type, subtype, lowest corner (`Min`), orientation, paint
//!     and armor skin.
//!   * Everything else in a real blueprint (inventories, toolbars, terminal
//!     settings, conveyor wiring ...) is ignored: serde skips fields we do not
//!     name, so we only pay for what we use.
//!
//! WHAT IS NOT
//!   * A blueprint can hold several grids: the ship, plus the heads of rotors,
//!     pistons and hinges, plus any ships attached to it. Only the grid with the
//!     most blocks is imported; the others are counted so the player is told.
//!   * The compiled `bp.sbcB5` file is not read; it is an optional copy of the
//!     same data, and the XML `bp.sbc` always sits next to it.
//!
//! RUST NOTES:
//!   * `#[serde(rename = "@x")]` means "the XML attribute x" (`<Min x="3" />`);
//!     without the `@` it means a child element.
//!   * `Option<T>` fields are the ones a file may leave out.

use serde::{Deserialize, Serialize};

use crate::blueprint::PaintColor;

/// Refuse absurdly large files before parsing (real blueprints are under a few MB).
const MAX_BLUEPRINT_BYTES: usize = 200 * 1024 * 1024;

// The same offsets `blueprint.rs` uses to write paint (see the note there).
const SATURATION_OFFSET: f64 = 0.8;
const VALUE_OFFSET: f64 = 0.45;

// ---------------------------------------------------------------------------
// The shape of the XML (only the parts we read)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct RawDefinitions {
    #[serde(rename = "ShipBlueprints", default)]
    ship_blueprints: Option<RawShipBlueprints>,
}

#[derive(Debug, Deserialize)]
struct RawShipBlueprints {
    #[serde(rename = "ShipBlueprint", default)]
    items: Vec<RawShipBlueprint>,
}

#[derive(Debug, Deserialize)]
struct RawShipBlueprint {
    #[serde(rename = "Id", default)]
    id: Option<RawBlueprintId>,
    #[serde(rename = "DisplayName", default)]
    display_name: Option<String>,
    #[serde(rename = "CubeGrids", default)]
    cube_grids: Option<RawCubeGrids>,
}

#[derive(Debug, Deserialize)]
struct RawBlueprintId {
    #[serde(rename = "@Subtype", default)]
    subtype: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawCubeGrids {
    #[serde(rename = "CubeGrid", default)]
    grids: Vec<RawCubeGrid>,
}

#[derive(Debug, Deserialize)]
struct RawCubeGrid {
    #[serde(rename = "GridSizeEnum", default)]
    grid_size: Option<String>,
    /// `true` for a station (a static grid), `false` or missing for a ship.
    #[serde(rename = "IsStatic", default)]
    is_static: Option<bool>,
    #[serde(rename = "CubeBlocks", default)]
    cube_blocks: Option<RawCubeBlocks>,
}

#[derive(Debug, Deserialize)]
struct RawCubeBlocks {
    #[serde(rename = "MyObjectBuilder_CubeBlock", default)]
    blocks: Vec<RawCubeBlock>,
}

#[derive(Debug, Deserialize)]
struct RawCubeBlock {
    /// The real block type, e.g. `MyObjectBuilder_Conveyor` (the element itself is always `CubeBlock`).
    /// The XML attribute is `xsi:type`, but quick-xml drops the `xsi:` prefix, so it arrives as `type`.
    #[serde(rename = "@type", alias = "@xsi:type", default)]
    type_name: Option<String>,
    #[serde(rename = "SubtypeName", default)]
    subtype: Option<String>,
    #[serde(rename = "Min", default)]
    min: Option<RawCell>,
    #[serde(rename = "BlockOrientation", default)]
    orientation: Option<RawOrientation>,
    #[serde(rename = "ColorMaskHSV", default)]
    color: Option<RawColor>,
    #[serde(rename = "SkinSubtypeId", default)]
    skin: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawCell {
    #[serde(rename = "@x")]
    x: i32,
    #[serde(rename = "@y")]
    y: i32,
    #[serde(rename = "@z")]
    z: i32,
}

#[derive(Debug, Deserialize)]
struct RawOrientation {
    #[serde(rename = "@Forward", default)]
    forward: Option<String>,
    #[serde(rename = "@Up", default)]
    up: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawColor {
    #[serde(rename = "@x", default)]
    x: f64,
    #[serde(rename = "@y", default)]
    y: f64,
    #[serde(rename = "@z", default)]
    z: f64,
}

// ---------------------------------------------------------------------------
// What we hand to the front-end
// ---------------------------------------------------------------------------

/// One block as the blueprint stores it. Matching it to the game's block list happens in the front-end.
#[derive(Debug, Clone, Serialize)]
pub struct ImportedBlock {
    /// Without the `MyObjectBuilder_` prefix, e.g. "CubeBlock" or "Conveyor".
    pub type_id: String,
    /// May be empty (a few game blocks have no subtype).
    pub subtype_id: String,
    /// Lowest corner of the block, in grid cells. Can be negative.
    pub position: [i32; 3],
    pub forward: String,
    pub up: String,
    pub color: PaintColor,
    pub skin_subtype_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ImportedBlueprint {
    pub name: String,
    /// "Large" or "Small".
    pub grid_size: String,
    /// True when the main grid is a station (static), false for a ship.
    pub is_station: bool,
    pub blocks: Vec<ImportedBlock>,
    /// Blocks in the blueprint's other grids (rotor heads, attached ships ...), which are not imported.
    pub other_grid_count: usize,
    pub other_grid_blocks: usize,
    /// Blocks that could not be read (no position), left out of `blocks`.
    pub unreadable_blocks: usize,
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/// The direction names the game uses.
fn is_direction(name: &str) -> bool {
    matches!(name, "Forward" | "Backward" | "Left" | "Right" | "Up" | "Down")
}

/// Game paint is stored as offsets; this gives plain hue / saturation / value (each 0 to 1).
/// It is the exact reverse of `blueprint::paint_to_game_offsets`.
fn paint_from_game_offsets(hue: f64, saturation_offset: f64, value_offset: f64) -> PaintColor {
    PaintColor {
        hue: hue.clamp(0.0, 1.0),
        saturation: (saturation_offset + SATURATION_OFFSET).clamp(0.0, 1.0),
        value: (value_offset + VALUE_OFFSET).clamp(0.0, 1.0),
    }
}

fn convert_block(raw: &RawCubeBlock) -> Option<ImportedBlock> {
    let min = raw.min.as_ref()?;
    let type_name = raw.type_name.as_deref().unwrap_or("CubeBlock");
    let type_id = type_name.trim_start_matches("MyObjectBuilder_");

    // A missing or odd orientation falls back to the game's default (front forward, top up).
    let orientation = raw.orientation.as_ref();
    let direction = |chosen: Option<&String>, fallback: &str| match chosen {
        Some(name) if is_direction(name) => name.clone(),
        _ => fallback.to_string(),
    };
    let mut forward = direction(orientation.and_then(|found| found.forward.as_ref()), "Forward");
    let mut up = direction(orientation.and_then(|found| found.up.as_ref()), "Up");
    if axis_of(&forward) == axis_of(&up) {
        // Impossible in a real file; keep the block rather than lose it.
        forward = "Forward".to_string();
        up = "Up".to_string();
    }

    let color = match &raw.color {
        Some(found) => paint_from_game_offsets(found.x, found.y, found.z),
        None => paint_from_game_offsets(0.0, -SATURATION_OFFSET, 0.0), // the game's default grey
    };
    Some(ImportedBlock {
        type_id: type_id.to_string(),
        subtype_id: raw.subtype.clone().unwrap_or_default(),
        position: [min.x, min.y, min.z],
        forward,
        up,
        color,
        skin_subtype_id: raw.skin.clone().filter(|skin| !skin.is_empty()),
    })
}

fn axis_of(direction: &str) -> u8 {
    match direction {
        "Left" | "Right" => 0,
        "Up" | "Down" => 1,
        _ => 2,
    }
}

/// Reads the text of a `bp.sbc` file.
pub fn parse_blueprint(xml: &str) -> Result<ImportedBlueprint, String> {
    if xml.len() > MAX_BLUEPRINT_BYTES {
        return Err("that file is too large to be a blueprint".to_string());
    }
    // Files from Windows tools often start with an invisible byte-order mark.
    let text = xml.trim_start_matches('\u{feff}');
    if !text.trim_start().starts_with('<') {
        return Err("that is not an XML blueprint (.sbc) file".to_string());
    }

    let definitions: RawDefinitions =
        quick_xml::de::from_str(text).map_err(|error| format!("cannot read the blueprint: {error}"))?;
    let blueprint = definitions
        .ship_blueprints
        .and_then(|list| list.items.into_iter().next())
        .ok_or("this file has no ship blueprint in it (is it a world or a mod file?)")?;

    let grids = blueprint.cube_grids.map(|found| found.grids).unwrap_or_default();
    let count_of = |grid: &RawCubeGrid| grid.cube_blocks.as_ref().map_or(0, |found| found.blocks.len());

    // The main grid is the one with the most blocks (the first one wins a tie).
    let main_index = grids
        .iter()
        .enumerate()
        .max_by_key(|(index, grid)| (count_of(grid), std::cmp::Reverse(*index)))
        .map(|(index, _)| index)
        .ok_or("the blueprint has no grids")?;
    let other_grid_count = grids.len() - 1;
    let other_grid_blocks: usize = grids.iter().enumerate().filter(|(index, _)| *index != main_index).map(|(_, grid)| count_of(grid)).sum();

    let main = &grids[main_index];
    let raw_blocks = main.cube_blocks.as_ref().map(|found| found.blocks.as_slice()).unwrap_or_default();
    let blocks: Vec<ImportedBlock> = raw_blocks.iter().filter_map(convert_block).collect();
    if blocks.is_empty() {
        return Err("the blueprint has no blocks".to_string());
    }

    let grid_size = match main.grid_size.as_deref() {
        Some("Small") => "Small",
        _ => "Large",
    };
    let name = blueprint
        .id
        .and_then(|id| id.subtype)
        .filter(|subtype| !subtype.trim().is_empty())
        .or(blueprint.display_name)
        .unwrap_or_default();

    Ok(ImportedBlueprint {
        name: name.trim().to_string(),
        grid_size: grid_size.to_string(),
        is_station: main.is_static.unwrap_or(false),
        unreadable_blocks: raw_blocks.len() - blocks.len(),
        blocks,
        other_grid_count,
        other_grid_blocks,
    })
}

// ---------------------------------------------------------------------------
// Tests: `cargo test` from the src-tauri folder.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use crate::blueprint::{build_blueprint_xml, BlueprintRequest, PlacedBlock};

    fn block(type_id: &str, subtype: &str, position: [i32; 3], forward: &str, up: &str, color: PaintColor, skin: Option<&str>) -> PlacedBlock {
        PlacedBlock {
            type_id: type_id.to_string(),
            subtype_id: subtype.to_string(),
            position,
            forward: forward.to_string(),
            up: up.to_string(),
            color,
            skin_subtype_id: skin.map(str::to_string),
        }
    }

    #[test]
    fn what_we_write_we_read_back() {
        let red = PaintColor { hue: 0.0, saturation: 0.8, value: 0.8 };
        let request = BlueprintRequest {
            name: "Round Trip".to_string(),
            grid_size: "Small".to_string(),
            overwrite: false,
            is_station: false,
            blocks: vec![
                block("CubeBlock", "SmallBlockArmorBlock", [0, 0, 0], "Forward", "Up", PaintColor { hue: 0.0, saturation: 0.0, value: 0.45 }, None),
                block("Conveyor", "SmallBlockConveyor", [-3, 2, 7], "Left", "Down", red.clone(), Some("Battered_Armor")),
                block("OxygenGenerator", "", [1, 1, 1], "Backward", "Right", red.clone(), None),
            ],
        };
        let imported = parse_blueprint(&build_blueprint_xml(&request).unwrap()).expect("parse failed");

        assert_eq!(imported.name, "Round Trip");
        assert_eq!(imported.grid_size, "Small");
        assert_eq!(imported.blocks.len(), 3);
        assert_eq!(imported.other_grid_count, 0);
        for (written, read) in request.blocks.iter().zip(&imported.blocks) {
            assert_eq!(read.type_id, written.type_id);
            assert_eq!(read.subtype_id, written.subtype_id);
            assert_eq!(read.position, written.position);
            assert_eq!(read.forward, written.forward);
            assert_eq!(read.up, written.up);
            assert_eq!(read.skin_subtype_id, written.skin_subtype_id);
            assert!((read.color.hue - written.color.hue).abs() < 1e-5);
            assert!((read.color.saturation - written.color.saturation).abs() < 1e-5);
            assert!((read.color.value - written.color.value).abs() < 1e-5);
        }
    }

    #[test]
    fn reads_a_real_looking_file_with_extras_and_several_grids() {
        // Shaped like the game's own saves: lots of fields we ignore, a rotor head as a second grid.
        let xml = r#"<?xml version="1.0"?>
<Definitions xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ShipBlueprints>
    <ShipBlueprint xsi:type="MyObjectBuilder_ShipBlueprintDefinition">
      <Id Type="MyObjectBuilder_ShipBlueprintDefinition" Subtype="My Ship" />
      <DisplayName>Someone</DisplayName>
      <DLC>HeavyIndustry</DLC>
      <CubeGrids>
        <CubeGrid>
          <GridSizeEnum>Small</GridSizeEnum>
          <CubeBlocks>
            <MyObjectBuilder_CubeBlock xsi:type="MyObjectBuilder_MotorRotor">
              <SubtypeName>SmallRotor</SubtypeName>
              <Min x="0" y="0" z="0" />
            </MyObjectBuilder_CubeBlock>
          </CubeBlocks>
        </CubeGrid>
        <CubeGrid>
          <GridSizeEnum>Large</GridSizeEnum>
          <CubeBlocks>
            <MyObjectBuilder_CubeBlock xsi:type="MyObjectBuilder_LandingGear">
              <SubtypeName>LargeBlockLandingGear</SubtypeName>
              <EntityId>90320316381088133</EntityId>
              <Min x="-14" y="4" z="2" />
              <BlockOrientation Forward="Left" Up="Up" />
              <ColorMaskHSV x="0.575" y="0.15" z="0.2" />
              <BrakeForce>-INF</BrakeForce>
              <AttachedEntityId xsi:nil="true" />
            </MyObjectBuilder_CubeBlock>
            <MyObjectBuilder_CubeBlock xsi:type="MyObjectBuilder_CubeBlock">
              <SubtypeName>LargeBlockArmorBlock</SubtypeName>
              <Min x="1" y="2" z="3" />
            </MyObjectBuilder_CubeBlock>
            <MyObjectBuilder_CubeBlock xsi:type="MyObjectBuilder_CubeBlock">
              <SubtypeName>NoPosition</SubtypeName>
            </MyObjectBuilder_CubeBlock>
          </CubeBlocks>
        </CubeGrid>
      </CubeGrids>
    </ShipBlueprint>
  </ShipBlueprints>
</Definitions>"#;
        let imported = parse_blueprint(xml).expect("parse failed");

        assert_eq!(imported.name, "My Ship");
        assert_eq!(imported.grid_size, "Large", "the grid with the most blocks is the main one");
        assert_eq!(imported.blocks.len(), 2);
        assert_eq!(imported.unreadable_blocks, 1);
        assert_eq!((imported.other_grid_count, imported.other_grid_blocks), (1, 1));

        let gear = &imported.blocks[0];
        assert_eq!(gear.type_id, "LandingGear");
        assert_eq!(gear.position, [-14, 4, 2]);
        assert_eq!((gear.forward.as_str(), gear.up.as_str()), ("Left", "Up"));
        assert!((gear.color.saturation - 0.95).abs() < 1e-9 && (gear.color.value - 0.65).abs() < 1e-9);

        // No orientation and no color: the game's defaults.
        let armor = &imported.blocks[1];
        assert_eq!((armor.forward.as_str(), armor.up.as_str()), ("Forward", "Up"));
        assert_eq!((armor.color.saturation, armor.color.value), (0.0, 0.45));
    }

    #[test]
    fn stations_and_ships_survive_the_round_trip() {
        let make = |is_station: bool| BlueprintRequest {
            name: "S".into(),
            grid_size: "Large".into(),
            overwrite: false,
            is_station,
            blocks: vec![block("CubeBlock", "LargeBlockArmorBlock", [0, 0, 0], "Forward", "Up", PaintColor { hue: 0.0, saturation: 0.0, value: 0.45 }, None)],
        };
        let station_xml = build_blueprint_xml(&make(true)).unwrap();
        assert!(station_xml.contains("<IsStatic>true</IsStatic>"));
        assert!(parse_blueprint(&station_xml).unwrap().is_station);

        let ship_xml = build_blueprint_xml(&make(false)).unwrap();
        assert!(ship_xml.contains("<IsStatic>false</IsStatic>"));
        assert!(!parse_blueprint(&ship_xml).unwrap().is_station);
    }

    #[test]
    fn sends_the_field_names_the_front_end_expects() {
        // src/importer.ts mirrors these names. If either side renames a field, this fails
        // instead of the import silently reading `undefined`.
        let request = BlueprintRequest {
            name: "Names".into(),
            grid_size: "Large".into(),
            overwrite: false,
            is_station: false,
            blocks: vec![block("CubeBlock", "LargeBlockArmorBlock", [1, 2, 3], "Forward", "Up", PaintColor { hue: 0.5, saturation: 0.5, value: 0.5 }, Some("Battered_Armor"))],
        };
        let json = serde_json::to_value(parse_blueprint(&build_blueprint_xml(&request).unwrap()).unwrap()).unwrap();
        for key in ["name", "grid_size", "is_station", "blocks", "other_grid_count", "other_grid_blocks", "unreadable_blocks"] {
            assert!(json.get(key).is_some(), "missing {key}");
        }
        let first = &json["blocks"][0];
        for key in ["type_id", "subtype_id", "position", "forward", "up", "color", "skin_subtype_id"] {
            assert!(first.get(key).is_some(), "missing block.{key}");
        }
        assert_eq!(first["position"], serde_json::json!([1, 2, 3]));
        assert!(first["color"].get("hue").is_some() && first["color"].get("saturation").is_some() && first["color"].get("value").is_some());
    }

    #[test]
    fn refuses_files_that_are_not_blueprints() {
        assert!(parse_blueprint("").is_err());
        assert!(parse_blueprint("just some text").is_err());
        assert!(parse_blueprint("<Definitions></Definitions>").is_err()); // no blueprint inside
        assert!(parse_blueprint("<Definitions><ShipBlueprints /></Definitions>").is_err());
        assert!(parse_blueprint("<Definitions><ShipBlueprints><ShipBlueprint><CubeGrids><CubeGrid/></CubeGrids></ShipBlueprint></ShipBlueprints></Definitions>").is_err());
        // Cut off in the middle.
        let good = build_blueprint_xml(&BlueprintRequest {
            name: "X".into(),
            grid_size: "Large".into(),
            overwrite: false,
            is_station: false,
            blocks: vec![block("CubeBlock", "LargeBlockArmorBlock", [0, 0, 0], "Forward", "Up", PaintColor { hue: 0.0, saturation: 0.0, value: 0.45 }, None)],
        })
        .unwrap();
        assert!(parse_blueprint(&good[..good.len() / 2]).is_err());
    }

    #[test]
    fn a_byte_order_mark_is_fine() {
        let mut xml = String::from('\u{feff}');
        xml.push_str(
            &build_blueprint_xml(&BlueprintRequest {
                name: "Bom".into(),
                grid_size: "Large".into(),
                overwrite: false,
                is_station: false,
                blocks: vec![block("CubeBlock", "LargeBlockArmorBlock", [0, 0, 0], "Forward", "Up", PaintColor { hue: 0.0, saturation: 0.0, value: 0.45 }, None)],
            })
            .unwrap(),
        );
        assert_eq!(parse_blueprint(&xml).unwrap().blocks.len(), 1);
    }

    /// Reads every blueprint in the player's own local folder (257 on the author's PC), and checks
    /// how many blocks the game's own block list knows
    /// (the same rule as `buildBlockLookup` in src/importer.ts). Prints the most common
    /// unknown blocks, which should be mod blocks. Skipped without the game or blueprints.
    #[test]
    fn most_real_blocks_are_in_the_games_block_list() {
        use std::collections::{HashMap, HashSet};
        let Some(install) = crate::se1::find_install() else { return };
        let Ok(root) = crate::blueprint::local_blueprint_folder() else { return };
        let Ok(folders) = std::fs::read_dir(&root) else { return };
        let catalog = crate::se1::load_catalog(&install).expect("catalog failed");

        let bare = |name: &str| name.trim_start_matches("MyObjectBuilder_").to_string();
        let exact: HashSet<(String, String)> = catalog.blocks.iter().map(|block| (bare(&block.type_id), block.subtype_id.clone())).collect();
        let mut by_subtype: HashMap<&str, usize> = HashMap::new();
        for block in &catalog.blocks {
            *by_subtype.entry(block.subtype_id.as_str()).or_default() += 1;
        }

        let (mut known, mut total, mut multi_grid) = (0usize, 0usize, 0usize);
        let mut failed: Vec<String> = Vec::new();
        let mut unknown: HashMap<String, usize> = HashMap::new();
        for folder in folders.flatten() {
            let Ok(text) = std::fs::read_to_string(folder.path().join("bp.sbc")) else { continue };
            let imported = match parse_blueprint(&text) {
                Ok(imported) => imported,
                Err(error) => {
                    failed.push(format!("{}: {error}", folder.file_name().to_string_lossy()));
                    continue;
                }
            };
            if imported.other_grid_count > 0 {
                multi_grid += 1;
            }
            for block in imported.blocks {
                total += 1;
                let found = exact.contains(&(bare(&block.type_id), block.subtype_id.clone()))
                    || (!block.subtype_id.is_empty() && by_subtype.get(block.subtype_id.as_str()) == Some(&1));
                if found {
                    known += 1;
                } else {
                    *unknown.entry(format!("{}/{}", block.type_id, block.subtype_id)).or_default() += 1;
                }
            }
        }
        let mut worst: Vec<_> = unknown.into_iter().collect();
        worst.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
        println!("{multi_grid} blueprints have more than one grid; {} could not be read", failed.len());
        for line in &failed {
            println!("  FAILED {line}");
        }
        assert!(failed.is_empty(), "blueprints that failed to read: {failed:?}");
        println!("{known} of {total} blocks are in the game's list ({}%)", known * 100 / total.max(1));
        for (name, count) in worst.iter().take(12) {
            println!("  unknown x{count}: {name}");
        }
        if total > 1000 {
            assert!(known * 100 / total >= 85, "only {known} of {total} real blocks matched; the matching rule is probably wrong");
        }
    }

}

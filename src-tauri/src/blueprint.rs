//! Writes a Space Engineers 1 blueprint (`bp.sbc`) from a list of placed blocks.
//!
//! The front-end sends a `BlueprintRequest`. We validate it, turn it into the
//! game's XML text, and save it in the game's blueprint folder so the ship shows
//! up in the in-game blueprint screen.
//!
//! The format was checked against real blueprints in
//! `%APPDATA%\SpaceEngineers\Blueprints\local` (see the Obsidian vault note
//! "SE1 Blueprint Format").
//!
//! RUST NOTES:
//!   * `#[derive(Deserialize)]` - serde builds the JSON-to-struct code for us.
//!   * `String` vs `&str`       - owned text vs borrowed text.
//!   * `impl` blocks            - methods attached to a struct (like C# methods).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

// The game stores paint as an OFFSET from a base color rather than as plain
// hue / saturation / value:
//     stored saturation = saturation - 0.8
//     stored value      = value - 0.45
// Verified against the game's own save (2026-11-18): a reactor painted #B20909
// (saturation 0.949, value 0.698) was stored as (0, 0.15, 0.25). The game's
// default grey (0, -0.8, 0) is therefore saturation 0, value 0.45.
const SATURATION_OFFSET: f64 = 0.8;
const VALUE_OFFSET: f64 = 0.45;

// First entity id handed out to blocks that need one. Entity ids only have to
// be unique inside this blueprint; the game gives every block a fresh id when
// the blueprint is pasted.
const FIRST_ENTITY_ID: u64 = 100_000_000_000_000;

/// Paint as a person thinks of it: each part from 0.0 to 1.0.
/// (`Serialize` is for the importer, which sends colors back to the front-end.)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PaintColor {
    pub hue: f64,
    pub saturation: f64,
    pub value: f64,
}

/// One block placed on the grid, exactly as the editor sees it.
#[derive(Debug, Clone, Deserialize)]
pub struct PlacedBlock {
    /// XML type, for example "CubeBlock" or "Conveyor".
    pub type_id: String,
    pub subtype_id: String,
    /// Lowest corner of the block in grid cells: [x, y, z].
    pub position: [i32; 3],
    /// One of Forward, Backward, Left, Right, Up, Down.
    pub forward: String,
    pub up: String,
    pub color: PaintColor,
    /// Armor skin such as `Battered_Armor`; `None` (or empty) means no skin.
    /// Written as `<SkinSubtypeId>`, exactly as in the game's own blueprints.
    #[serde(default)]
    pub skin_subtype_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BlueprintRequest {
    pub name: String,
    /// "Large" or "Small".
    pub grid_size: String,
    pub blocks: Vec<PlacedBlock>,
    /// Replace an existing blueprint with the same name. Off unless the
    /// player confirms it, so we never destroy a ship by accident.
    #[serde(default)]
    pub overwrite: bool,
    /// Save as a station (a static grid: it does not move, and can be built on
    /// the ground), not a ship. Written as `<IsStatic>`.
    #[serde(default)]
    pub is_station: bool,
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/// Which axis a direction name lies on: 0 = x (left/right), 1 = y (up/down),
/// 2 = z (forward/backward). `None` for an unknown name.
fn axis_of(direction: &str) -> Option<u8> {
    match direction {
        "Left" | "Right" => Some(0),
        "Up" | "Down" => Some(1),
        "Forward" | "Backward" => Some(2),
        _ => None,
    }
}

fn validate_block(block: &PlacedBlock) -> Result<(), String> {
    let forward_axis = axis_of(&block.forward)
        .ok_or_else(|| format!("unknown forward direction '{}'", block.forward))?;
    let up_axis = axis_of(&block.up).ok_or_else(|| format!("unknown up direction '{}'", block.up))?;
    if forward_axis == up_axis {
        return Err(format!(
            "forward ({}) and up ({}) point along the same axis",
            block.forward, block.up
        ));
    }
    // The subtype CAN be empty: 12 game blocks (Door, AirVent, OxygenGenerator,
    // the gravity generators, ...) are defined without one. Only the type is required.
    if block.type_id.is_empty() {
        return Err("a block is missing its type".to_string());
    }
    // Skin names are identifiers like "Battered_Armor": letters, digits, _ and -.
    if let Some(skin) = &block.skin_subtype_id {
        let allowed = skin.chars().all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-');
        if !allowed {
            return Err(format!("invalid skin name '{skin}'"));
        }
    }
    Ok(())
}

/// Turns a ship name into something safe to use as a folder name.
pub fn safe_folder_name(name: &str) -> Result<String, String> {
    let cleaned: String = name
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || " -_().#'".contains(character) {
                character
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').to_string();
    if trimmed.is_empty() {
        return Err("the blueprint needs a name".to_string());
    }
    Ok(trimmed)
}

/// Escapes the five characters that are special in XML text.
fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Rounds to six places and avoids printing "-0".
fn format_number(number: f64) -> String {
    let rounded = (number * 1_000_000.0).round() / 1_000_000.0;
    let text = format!("{rounded}");
    if text == "-0" { "0".to_string() } else { text }
}

/// Converts plain paint into the game's offset form: (hue, saturation offset,
/// value offset).
pub fn paint_to_game_offsets(color: &PaintColor) -> (f64, f64, f64) {
    let hue = color.hue.clamp(0.0, 1.0);
    let saturation = color.saturation.clamp(0.0, 1.0);
    let value = color.value.clamp(0.0, 1.0);
    (hue, saturation - SATURATION_OFFSET, value - VALUE_OFFSET)
}

// ---------------------------------------------------------------------------
// XML generation
// ---------------------------------------------------------------------------

/// Builds the full text of a `bp.sbc` file.
pub fn build_blueprint_xml(request: &BlueprintRequest) -> Result<String, String> {
    if request.blocks.is_empty() {
        return Err("the ship has no blocks".to_string());
    }
    if request.grid_size != "Large" && request.grid_size != "Small" {
        return Err(format!("grid size must be Large or Small, not '{}'", request.grid_size));
    }
    for block in &request.blocks {
        validate_block(block)?;
    }

    let ship_name = escape_xml(request.name.trim());
    let mut xml = String::new();

    xml.push_str("<?xml version=\"1.0\"?>\n");
    xml.push_str("<Definitions xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\n");
    xml.push_str("  <ShipBlueprints>\n");
    xml.push_str("    <ShipBlueprint xsi:type=\"MyObjectBuilder_ShipBlueprintDefinition\">\n");
    xml.push_str(&format!(
        "      <Id Type=\"MyObjectBuilder_ShipBlueprintDefinition\" Subtype=\"{ship_name}\" />\n"
    ));
    xml.push_str(&format!("      <DisplayName>{ship_name}</DisplayName>\n"));
    xml.push_str("      <CubeGrids>\n");
    xml.push_str("        <CubeGrid>\n");
    xml.push_str("          <SubtypeName />\n");
    xml.push_str(&format!("          <EntityId>{FIRST_ENTITY_ID}</EntityId>\n"));
    xml.push_str("          <PersistentFlags>CastShadows InScene</PersistentFlags>\n");
    xml.push_str("          <PositionAndOrientation>\n");
    xml.push_str("            <Position x=\"0\" y=\"0\" z=\"0\" />\n");
    xml.push_str("            <Forward x=\"0\" y=\"0\" z=\"-1\" />\n");
    xml.push_str("            <Up x=\"0\" y=\"1\" z=\"0\" />\n");
    xml.push_str("          </PositionAndOrientation>\n");
    xml.push_str(&format!("          <GridSizeEnum>{}</GridSizeEnum>\n", request.grid_size));
    xml.push_str("          <CubeBlocks>\n");

    let mut next_entity_id = FIRST_ENTITY_ID + 1;
    for block in &request.blocks {
        let (hue, saturation_offset, value_offset) = paint_to_game_offsets(&block.color);
        // A few game definitions (the projector) already store their type with
        // the prefix, so remove it first to avoid "MyObjectBuilder_MyObjectBuilder_...".
        let bare_type = block.type_id.trim_start_matches("MyObjectBuilder_");
        let type_name = escape_xml(bare_type);

        xml.push_str(&format!(
            "            <MyObjectBuilder_CubeBlock xsi:type=\"MyObjectBuilder_{type_name}\">\n"
        ));
        // The game leaves out <SubtypeName> entirely for blocks without a subtype
        // (seen in its own save of an Oxygen Generator), so we do the same.
        if !block.subtype_id.is_empty() {
            xml.push_str(&format!(
                "              <SubtypeName>{}</SubtypeName>\n",
                escape_xml(&block.subtype_id)
            ));
        }
        // Plain armor needs no id; functional blocks (conveyors, doors, ...)
        // get one so the game can track them.
        if bare_type != "CubeBlock" {
            xml.push_str(&format!("              <EntityId>{next_entity_id}</EntityId>\n"));
            next_entity_id += 1;
        }
        xml.push_str(&format!(
            "              <Min x=\"{}\" y=\"{}\" z=\"{}\" />\n",
            block.position[0], block.position[1], block.position[2]
        ));
        xml.push_str(&format!(
            "              <BlockOrientation Forward=\"{}\" Up=\"{}\" />\n",
            block.forward, block.up
        ));
        xml.push_str(&format!(
            "              <ColorMaskHSV x=\"{}\" y=\"{}\" z=\"{}\" />\n",
            format_number(hue),
            format_number(saturation_offset),
            format_number(value_offset)
        ));
        // The game writes the skin right after the color, and leaves it out for "no skin".
        if let Some(skin) = block.skin_subtype_id.as_deref().filter(|skin| !skin.is_empty()) {
            xml.push_str(&format!("              <SkinSubtypeId>{}</SkinSubtypeId>\n", escape_xml(skin)));
        }
        xml.push_str("            </MyObjectBuilder_CubeBlock>\n");
    }

    xml.push_str("          </CubeBlocks>\n");
    // A station is the same grid marked static; nothing else in the file differs.
    xml.push_str(&format!("          <IsStatic>{}</IsStatic>\n", request.is_station));
    xml.push_str("          <DisplayName>");
    xml.push_str(&ship_name);
    xml.push_str("</DisplayName>\n");
    xml.push_str("          <DestructibleBlocks>true</DestructibleBlocks>\n");
    xml.push_str("        </CubeGrid>\n");
    xml.push_str("      </CubeGrids>\n");
    xml.push_str("    </ShipBlueprint>\n");
    xml.push_str("  </ShipBlueprints>\n");
    xml.push_str("</Definitions>\n");
    Ok(xml)
}

// ---------------------------------------------------------------------------
// Saving to disk
// ---------------------------------------------------------------------------

/// The game's local blueprint folder: `%APPDATA%\SpaceEngineers\Blueprints\local`.
pub fn local_blueprint_folder() -> Result<PathBuf, String> {
    let app_data = std::env::var("APPDATA").map_err(|_| "APPDATA is not set".to_string())?;
    Ok(PathBuf::from(app_data)
        .join("SpaceEngineers")
        .join("Blueprints")
        .join("local"))
}

/// Writes `<root>\<ship name>\bp.sbc` and returns the file path.
/// `root` is a parameter (not hard-coded) so tests can use a temporary folder
/// instead of your real blueprints.
pub fn write_blueprint(root: &Path, request: &BlueprintRequest) -> Result<PathBuf, String> {
    let xml = build_blueprint_xml(request)?;
    let folder = root.join(safe_folder_name(&request.name)?);
    let file = folder.join("bp.sbc");

    if file.exists() && !request.overwrite {
        return Err(format!("a blueprint named '{}' already exists", request.name.trim()));
    }
    fs::create_dir_all(&folder)
        .map_err(|error| format!("cannot create {}: {error}", folder.display()))?;
    fs::write(&file, xml).map_err(|error| format!("cannot write {}: {error}", file.display()))?;
    Ok(file)
}

// ---------------------------------------------------------------------------
// Tests: `cargo test` from the src-tauri folder.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    fn sample_block(subtype: &str, x_position: i32) -> PlacedBlock {
        PlacedBlock {
            type_id: "CubeBlock".to_string(),
            subtype_id: subtype.to_string(),
            position: [x_position, 0, 0],
            forward: "Forward".to_string(),
            up: "Up".to_string(),
            color: PaintColor { hue: 0.0, saturation: 0.0, value: 0.45 },
            skin_subtype_id: None,
        }
    }

    fn sample_request() -> BlueprintRequest {
        BlueprintRequest {
            name: "Test Ship".to_string(),
            grid_size: "Large".to_string(),
            blocks: vec![sample_block("LargeBlockArmorBlock", 0), sample_block("LargeBlockArmorBlock", 1)],
            overwrite: false,
            is_station: false,
        }
    }

    #[test]
    fn default_grey_matches_real_blueprints() {
        // Real blueprints store the default grey as (0, -0.8, 0).
        let (hue, saturation, value) =
            paint_to_game_offsets(&PaintColor { hue: 0.0, saturation: 0.0, value: 0.45 });
        assert_eq!(format_number(hue), "0");
        assert_eq!(format_number(saturation), "-0.8");
        assert_eq!(format_number(value), "0");
    }

    #[test]
    fn matches_a_color_the_game_itself_saved() {
        // From the game's re-save of "SSB Test Ship": a reactor painted #B20909
        // was stored as ColorMaskHSV (0, 0.15, 0.25). The game rounds to two
        // decimals, so allow a small difference.
        let color = PaintColor {
            hue: 0.0,
            saturation: (178.0 - 9.0) / 178.0, // from the hex channels 0xB2 and 0x09
            value: 178.0 / 255.0,
        };
        let (hue, saturation, value) = paint_to_game_offsets(&color);
        assert_eq!(hue, 0.0);
        assert!((saturation - 0.15).abs() < 0.01, "saturation offset {saturation}");
        assert!((value - 0.25).abs() < 0.01, "value offset {value}");
    }

    #[test]
    fn hue_and_bright_colors_match_the_games_own_save() {
        // From "SSB Test Ship_2", painted with the game's color picker:
        //   bright green stored as (0.3333, 0.2, 0.55)   -> hue 120 degrees, saturation 1, value 1
        //   bright blue  stored as (0.6944, 0.2, 0.55)   -> hue 250 degrees, saturation 1, value 1
        //   picker grey  stored as (0, -0.8, 0.2)        -> saturation 0, value 0.65
        let check = |hue: f64, saturation: f64, value: f64, expected: (f64, f64, f64)| {
            let (stored_hue, stored_saturation, stored_value) =
                paint_to_game_offsets(&PaintColor { hue, saturation, value });
            assert!((stored_hue - expected.0).abs() < 0.001, "hue {stored_hue} vs {}", expected.0);
            assert!((stored_saturation - expected.1).abs() < 0.001, "saturation {stored_saturation}");
            assert!((stored_value - expected.2).abs() < 0.001, "value {stored_value}");
        };
        check(120.0 / 360.0, 1.0, 1.0, (0.3333, 0.2, 0.55));
        check(250.0 / 360.0, 1.0, 1.0, (0.6944, 0.2, 0.55));
        check(0.0, 0.0, 0.65, (0.0, -0.8, 0.2));
    }

    #[test]
    fn full_value_matches_the_games_white() {
        // Real blueprints store white-ish paint as value offset 0.55.
        let (_, _, value) = paint_to_game_offsets(&PaintColor { hue: 0.0, saturation: 0.0, value: 1.0 });
        assert_eq!(format_number(value), "0.55");
    }

    #[test]
    fn xml_contains_expected_parts_and_is_well_formed() {
        let xml = build_blueprint_xml(&sample_request()).unwrap();
        assert!(xml.contains("<SubtypeName>LargeBlockArmorBlock</SubtypeName>"));
        assert!(xml.contains("<BlockOrientation Forward=\"Forward\" Up=\"Up\" />"));
        assert!(xml.contains("<Min x=\"1\" y=\"0\" z=\"0\" />"));
        assert!(xml.contains("<GridSizeEnum>Large</GridSizeEnum>"));

        // Walk the whole document: any unbalanced tag makes the reader fail.
        let mut reader = quick_xml::Reader::from_str(&xml);
        loop {
            match reader.read_event() {
                Ok(quick_xml::events::Event::Eof) => break,
                Ok(_) => {}
                Err(error) => panic!("generated XML is not well formed: {error}"),
            }
        }
    }

    #[test]
    fn rejects_bad_orientation_and_empty_ships() {
        let mut request = sample_request();
        request.blocks[0].up = "Forward".to_string(); // same axis as forward
        assert!(build_blueprint_xml(&request).is_err());

        request.blocks[0].forward = "Sideways".to_string();
        assert!(build_blueprint_xml(&request).is_err());

        let mut empty = sample_request();
        empty.blocks.clear();
        assert!(build_blueprint_xml(&empty).is_err());
    }

    #[test]
    fn blocks_without_a_subtype_export_like_the_game_does() {
        // The game saved its Oxygen Generator with no <SubtypeName> element.
        let mut request = sample_request();
        request.blocks[0].type_id = "OxygenGenerator".to_string();
        request.blocks[0].subtype_id = String::new();
        let xml = build_blueprint_xml(&request).unwrap();

        let generator_start = xml.find("MyObjectBuilder_OxygenGenerator").unwrap();
        let generator_end = generator_start + xml[generator_start..].find("</MyObjectBuilder_CubeBlock>").unwrap();
        let generator = &xml[generator_start..generator_end];
        assert!(!generator.contains("SubtypeName"), "unexpected SubtypeName in {generator}");
        assert!(generator.contains("<Min "));
    }

    #[test]
    fn skins_are_written_like_the_game_does() {
        // The game writes <SkinSubtypeId> right after <ColorMaskHSV> and omits it for "no skin".
        let mut request = sample_request();
        request.blocks[0].skin_subtype_id = Some("Battered_Armor".to_string());
        request.blocks[1].skin_subtype_id = Some(String::new()); // empty means none
        let xml = build_blueprint_xml(&request).unwrap();

        assert_eq!(xml.matches("<SkinSubtypeId>").count(), 1);
        assert!(xml.contains("<SkinSubtypeId>Battered_Armor</SkinSubtypeId>"));
        let color_at = xml.find("<ColorMaskHSV").unwrap();
        let skin_at = xml.find("<SkinSubtypeId>").unwrap();
        assert!(color_at < skin_at, "skin should follow the color");

        // A name that could break the XML is refused rather than escaped.
        request.blocks[0].skin_subtype_id = Some("Bad<Skin>".to_string());
        assert!(build_blueprint_xml(&request).is_err());
    }

    #[test]
    fn json_without_a_skin_field_still_works() {
        // Older callers (and the tests above) send no skin field at all.
        let json = r#"{"name":"S","grid_size":"Large","blocks":[{"type_id":"CubeBlock","subtype_id":"LargeBlockArmorBlock",
            "position":[0,0,0],"forward":"Forward","up":"Up","color":{"hue":0,"saturation":0,"value":0.45}}]}"#;
        let request: BlueprintRequest = serde_json::from_str(json).expect("JSON shape mismatch");
        assert!(request.blocks[0].skin_subtype_id.is_none());
        assert!(!build_blueprint_xml(&request).unwrap().contains("SkinSubtypeId"));
    }

    #[test]
    fn type_prefix_is_never_doubled() {
        // The game's own definition for the projector is `MyObjectBuilder_Projector`.
        let mut request = sample_request();
        request.blocks[0].type_id = "MyObjectBuilder_Projector".to_string();
        request.blocks[1].type_id = "Projector".to_string();
        let xml = build_blueprint_xml(&request).unwrap();
        assert!(!xml.contains("MyObjectBuilder_MyObjectBuilder_"));
        assert_eq!(xml.matches("xsi:type=\"MyObjectBuilder_Projector\"").count(), 2);
    }

    #[test]
    fn escapes_special_characters_in_names() {
        let mut request = sample_request();
        request.name = "Tom & <Jerry>".to_string();
        let xml = build_blueprint_xml(&request).unwrap();
        assert!(xml.contains("Tom &amp; &lt;Jerry&gt;"));
    }

    #[test]
    fn writes_file_and_refuses_to_overwrite() {
        let root = std::env::temp_dir().join("se_grid_builder_test_blueprints");
        let _ = fs::remove_dir_all(&root); // start clean; ignore "not found"

        let written = write_blueprint(&root, &sample_request()).unwrap();
        assert!(written.is_file());

        // Second save with the same name must fail unless overwrite is set.
        assert!(write_blueprint(&root, &sample_request()).is_err());
        let mut replace = sample_request();
        replace.overwrite = true;
        assert!(write_blueprint(&root, &replace).is_ok());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn accepts_the_exact_json_the_front_end_sends() {
        // Copied from what src/exporter.ts builds. If either side renames a
        // field, this test fails instead of the export failing mysteriously.
        let json = r#"{
            "name": "From Browser",
            "grid_size": "Small",
            "overwrite": false,
            "blocks": [{
                "type_id": "CubeBlock",
                "subtype_id": "SmallBlockArmorBlock",
                "position": [0, 1, -2],
                "forward": "Left",
                "up": "Up",
                "color": { "hue": 0.5, "saturation": 0.25, "value": 1 }
            }]
        }"#;
        let request: BlueprintRequest = serde_json::from_str(json).expect("JSON shape mismatch");
        let xml = build_blueprint_xml(&request).unwrap();
        assert!(xml.contains("<Min x=\"0\" y=\"1\" z=\"-2\" />"));
        assert!(xml.contains("<GridSizeEnum>Small</GridSizeEnum>"));
    }

    /// Not run by default because it writes into the REAL blueprint folder.
    /// Run it on purpose with:  cargo test write_sample_ship -- --ignored --nocapture
    ///
    /// It builds a small ship from real catalog entries (so sizes and types are
    /// the game's own): a 3x3 armor floor, a reactor on top, a conveyor, and two
    /// red armor blocks. Load it in game to check the format is accepted.
    #[test]
    #[ignore]
    fn write_sample_ship_to_game_folder() {
        let install = crate::se1::find_install().expect("SE1 not found");
        let catalog = crate::se1::load_catalog(&install).expect("catalog failed");
        let find = |subtype: &str| {
            catalog
                .blocks
                .iter()
                .find(|block| block.subtype_id == subtype)
                .unwrap_or_else(|| panic!("{subtype} not in catalog"))
        };

        let grey = PaintColor { hue: 0.0, saturation: 0.0, value: 0.45 };
        let red = PaintColor { hue: 0.0, saturation: 0.8, value: 0.8 };
        let make = |subtype: &str, position: [i32; 3], color: &PaintColor| {
            let info = find(subtype);
            PlacedBlock {
                type_id: info.type_id.clone(),
                subtype_id: info.subtype_id.clone(),
                position,
                forward: "Forward".to_string(),
                up: "Up".to_string(),
                color: color.clone(),
                skin_subtype_id: None,
            }
        };

        let mut blocks = Vec::new();
        for x_position in 0..3 {
            for z_position in 0..3 {
                blocks.push(make("LargeBlockArmorBlock", [x_position, 0, z_position], &grey));
            }
        }
        blocks.push(make("LargeBlockLargeGenerator", [0, 1, 0], &grey)); // 3x3x3 reactor
        blocks.push(make("LargeBlockConveyor", [3, 0, 0], &grey));
        blocks.push(make("LargeBlockArmorBlock", [4, 0, 0], &red));
        blocks.push(make("LargeBlockArmorBlock", [5, 0, 0], &red));

        let request = BlueprintRequest {
            name: "SSB Test Ship".to_string(),
            grid_size: "Large".to_string(),
            blocks,
            overwrite: true, // this name is reserved for this test
            is_station: false,
        };
        let root = local_blueprint_folder().unwrap();
        let written = write_blueprint(&root, &request).unwrap();
        println!("WROTE {}", written.display());
    }

    #[test]
    fn folder_names_are_sanitized() {
        assert_eq!(safe_folder_name("My Ship #1").unwrap(), "My Ship #1");
        assert_eq!(safe_folder_name("a/b\\c:d").unwrap(), "a_b_c_d");
        assert!(safe_folder_name("   ").is_err());
        assert!(safe_folder_name("..").is_err());
    }
}

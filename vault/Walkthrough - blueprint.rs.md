# Walkthrough: `src-tauri/src/blueprint.rs`

Turns the ship from the editor into a Space Engineers 1 `bp.sbc` file. Format details: [[SE1 Blueprint Format]]. Rust ideas: [[Rust Concepts]].

## Input types (what TypeScript sends)
```rust
BlueprintRequest { name, grid_size, blocks: Vec<PlacedBlock>, overwrite }
PlacedBlock      { type_id, subtype_id, position: [i32;3], forward, up, color: PaintColor }
PaintColor       { hue, saturation, value }   // each 0.0 to 1.0
```
`#[derive(Deserialize)]` lets serde build these from JSON. `#[serde(default)]` on `overwrite` means "false if missing".

## Validation first
Nothing is written until everything checks out:
- `validate_block`: orientation names must be known, and **forward and up must not lie on the same axis** (a block cannot face forward with its top also forward). `axis_of` maps each name to x, y or z. See [[Orientation and Grid Math]].
- `build_blueprint_xml` also rejects an empty ship and any grid size other than Large or Small.
- `safe_folder_name`: replaces characters Windows forbids in folder names; rejects empty names and `..`.

## Paint conversion
`paint_to_game_offsets` turns plain hue / saturation / value into the game's *offset* form. Two constants (`SATURATION_OFFSET = 0.8`, `VALUE_OFFSET = 0.45`) are **verified against the game's own save** of a painted block. Tests prove default grey (0, 0, 0.45) becomes `(0, -0.8, 0)`, full value gives the game's white, and a real `#B20909` paint matches what the game stored. See [[Colors and Paint]].

## Building the XML
`build_blueprint_xml` builds the text with `String::push_str` and `format!`. It was kept simple on purpose: easy to read next to a real `bp.sbc`.
- `escape_xml` protects the five special characters so a ship named `Tom & <Jerry>` cannot break the file.
- `format_number` rounds to 6 places and prints `0` instead of `-0`.
- **Skins:** each block may carry `skin_subtype_id`. When present and non-empty it is written as `<SkinSubtypeId>` right after `<ColorMaskHSV>`, matching the game's own files (seen as `Battered_Armor` in real blueprints). A skin name may only contain letters, digits, `_` and `-`; anything else is refused instead of escaped, since a real skin name never needs it. A request with no skin field at all still works (`#[serde(default)]`).
- Blocks with an **empty subtype** (12 in the game) get no `<SubtypeName>` element, exactly as the game saves them. Only the type is required.
- Plain armor (`CubeBlock`) gets no `EntityId`; every other block type gets a unique one starting at `100000000000000`. Ids only need to be unique inside this file; the game assigns new ones when the blueprint is pasted. **Unverified in game.**

## Saving
- `local_blueprint_folder()` reads the `APPDATA` environment variable and builds `...\SpaceEngineers\Blueprints\local`.
- `write_blueprint(root, request)` takes `root` as a **parameter** so tests can write to a temp folder and never touch your real blueprints.
- If `bp.sbc` already exists and `overwrite` is false, it returns an error and writes nothing. The UI turns that error into an explicit "Replace" button.

## A bug the categories work exposed
Some game definitions (the projector) store their type already prefixed: `MyObjectBuilder_Projector`. Writing `MyObjectBuilder_` in front again would give `MyObjectBuilder_MyObjectBuilder_Projector`, which the game would not recognize. The exporter now strips the prefix first (`trim_start_matches`), and `type_prefix_is_never_doubled` guards it.

## The sample-ship test (ignored by default)
`write_sample_ship_to_game_folder` builds a small ship from real catalog entries and writes `SSB Test Ship` into your real blueprint folder, for loading in game. It is marked `#[ignore]` so a normal `cargo test` never touches your blueprints. Run it on purpose:
```bash
cargo test write_sample_ship -- --ignored --nocapture
```

## Tests (blueprint ones; the whole project has 12 Rust tests plus this ignored one)
| Test | Proves |
|---|---|
| `default_grey_matches_real_blueprints` | paint math matches the game's own default |
| `xml_contains_expected_parts_and_is_well_formed` | key tags present, and a full read finds no unbalanced tags |
| `rejects_bad_orientation_and_empty_ships` | validation works |
| `escapes_special_characters_in_names` | names cannot corrupt the XML |
| `writes_file_and_refuses_to_overwrite` | saving and the overwrite guard (in a temp folder) |
| `accepts_the_exact_json_the_front_end_sends` | the TypeScript and Rust field names agree |
| `type_prefix_is_never_doubled` | `MyObjectBuilder_` is not written twice |
| `folder_names_are_sanitized` | bad characters, empty names, `..` |

## What the tests do NOT prove
That the **game accepts the file**. The only real proof is loading it in Space Engineers. That is the first item in [[Roadmap and Open Questions]].

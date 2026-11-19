//! Armor shapes: slopes, corners, half blocks and the rest of the game's
//! "cube side" blocks.
//!
//! These blocks have no single model. The game defines a *topology* (such as
//! `Slope`) and a list of flat "side plates"; each plate is modelled lying in one
//! default position, and the game turns every plate to the right face. The turning
//! rules live in the game's code, so they were **worked out from the game's own
//! files** and are stored in the table below:
//!
//!   1. Every plate already sits in block coordinates (it spans the block's cell);
//!      only turns in 90 degree steps are needed (24 possible turns).
//!   2. For each block, a search tried every turn of every plate and kept the
//!      combinations that form a **closed solid**: every edge of every plate meets
//!      an edge of another plate. That leaves a few possible orientations of the
//!      whole solid.
//!   3. The right orientation was picked by comparing each candidate with the
//!      game's own construction model of the finished block (its
//!      `BuildProgressModels`); corner and slope were cross-checked against the
//!      block's mount points. 142 of 147 blocks matched with a clear margin; the
//!      other five (round corners) follow the same turns as the flat corner, since
//!      their plates are drop-in replacements.
//!   4. Light, heavy, large and small variants of one topology share their turns.
//!
//! The table is data we derived, not game content. A test re-checks it against the
//! real install: every armor block must assemble into a closed solid.

use crate::mwm::{self, MeshPart, ModelMesh};
use std::path::Path;

/// The 24 ways to turn a cube in 90 degree steps. Each is a 3x3 matrix, row by
/// row; a point `p` becomes `[row0 . p, row1 . p, row2 . p]`.
const ROTATIONS: [[i8; 9]; 24] = [
    [1, 0, 0, 0, 1, 0, 0, 0, 1],
    [1, 0, 0, 0, -1, 0, 0, 0, -1],
    [-1, 0, 0, 0, 1, 0, 0, 0, -1],
    [-1, 0, 0, 0, -1, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1, 0, -1, 0],
    [1, 0, 0, 0, 0, -1, 0, 1, 0],
    [-1, 0, 0, 0, 0, 1, 0, 1, 0],
    [-1, 0, 0, 0, 0, -1, 0, -1, 0],
    [0, 1, 0, 1, 0, 0, 0, 0, -1],
    [0, 1, 0, -1, 0, 0, 0, 0, 1],
    [0, -1, 0, 1, 0, 0, 0, 0, 1],
    [0, -1, 0, -1, 0, 0, 0, 0, -1],
    [0, 1, 0, 0, 0, 1, 1, 0, 0],
    [0, 1, 0, 0, 0, -1, -1, 0, 0],
    [0, -1, 0, 0, 0, 1, -1, 0, 0],
    [0, -1, 0, 0, 0, -1, 1, 0, 0],
    [0, 0, 1, 1, 0, 0, 0, 1, 0],
    [0, 0, 1, -1, 0, 0, 0, -1, 0],
    [0, 0, -1, 1, 0, 0, 0, -1, 0],
    [0, 0, -1, -1, 0, 0, 0, 1, 0],
    [0, 0, 1, 0, 1, 0, -1, 0, 0],
    [0, 0, 1, 0, -1, 0, 1, 0, 0],
    [0, 0, -1, 0, 1, 0, 1, 0, 0],
    [0, 0, -1, 0, -1, 0, -1, 0, 0],
];

/// For each topology: which turn (an index into `ROTATIONS`) each side plate gets,
/// in the same order as the block definition's `<Sides>` list.
const SIDE_ROTATIONS: &[(&str, &[u8])] = &[
    ("Box", &[0, 5, 1, 8, 10, 4]),
    ("Corner", &[6, 19, 0, 22]),
    ("Corner2Base", &[0, 0, 0, 3, 4]),
    ("Corner2Tip", &[22, 0, 0, 10]),
    ("CornerSquare", &[0, 20, 0, 0, 1]),
    ("CornerSquareInverted", &[0, 0, 6, 12, 1, 10, 4]),
    ("HalfBox", &[0, 5, 10, 9, 4, 3]),
    ("HalfCorner", &[16, 0, 0, 4, 14]),
    ("HalfSlopeBox", &[3, 0, 0, 4, 6]),
    ("HalfSlopeCorner", &[2, 18, 14, 0]),
    ("HalfSlopeCornerInverted", &[0, 2, 14, 20, 1, 8, 5]),
    ("HalfSlopeInverted", &[0, 8, 8, 1, 10, 20, 12]),
    ("HalfSlopedCorner", &[16, 0, 0, 10, 18]),
    ("HalfSlopedCornerBase", &[0, 0, 0, 2, 1, 14, 4]),
    ("InvCorner", &[0, 13, 8, 7, 0, 5, 10]),
    ("InvCorner2Base", &[0, 1, 21, 8, 10, 0, 5]),
    ("InvCorner2Tip", &[0, 1, 21, 8, 10, 0, 5]),
    ("RaisedSlopedCorner", &[2, 0, 1, 12, 6, 10, 18]),
    ("RoundCorner", &[6, 19, 0, 22]),
    ("RoundInvCorner", &[0, 22, 19, 1, 4, 8, 7]),
    ("RoundSlope", &[0, 0, 0, 1, 4]),
    ("Slope", &[0, 6, 6, 1, 4]),
    ("Slope2Base", &[0, 1, 6, 4, 8, 10]),
    ("Slope2Tip", &[0, 0, 0, 1, 4]),
    ("SlopeTransition", &[6, 0, 0, 0, 1, 18]),
    ("SlopeTransitionBase", &[20, 0, 0, 0, 1, 4, 10]),
    ("SlopeTransitionBaseMirrored", &[2, 20, 0, 0, 1, 5, 10]),
    ("SlopeTransitionMirrored", &[18, 2, 2, 0, 1, 16]),
    ("SlopeTransitionTip", &[0, 0, 0, 0, 4, 21]),
    ("SlopeTransitionTipMirrored", &[2, 2, 0, 0, 6, 23]),
    ("SlopedCorner", &[0, 2, 0, 1, 10, 18]),
    ("SlopedCornerBase", &[0, 10, 1, 8, 4, 6, 2]),
    ("SlopedCornerTip", &[8, 0, 0, 0]),
    ("SquareSlopedCornerBase", &[0, 0, 1, 12, 6, 10, 18]),
    ("SquareSlopedCornerTip", &[0, 0, 22, 22, 1]),
    ("SquareSlopedCornerTipInv", &[0, 0, 0, 2, 1, 14, 4]),
];

/// Blocks whose plates differ from the rest of their topology.
const BLOCK_ROTATIONS: &[(&str, &[u8])] = &[("LargeRoundArmor_CornerInv", &[0, 22, 19, 1, 4, 8, 7])];

/// The turns for a block's side plates, or None when the shape is not in the table.
pub fn rotations_for(subtype: &str, topology: &str, side_count: usize) -> Option<&'static [u8]> {
    let from_block = BLOCK_ROTATIONS.iter().find(|(name, _)| *name == subtype).map(|(_, turns)| *turns);
    let found = from_block.or_else(|| SIDE_ROTATIONS.iter().find(|(name, _)| *name == topology).map(|(_, turns)| *turns))?;
    (found.len() == side_count).then_some(found)
}

fn turn_point(turn: &[i8; 9], point: [f32; 3]) -> [f32; 3] {
    let mut result = [0.0; 3];
    for row in 0..3 {
        for column in 0..3 {
            result[row] += f32::from(turn[row * 3 + column]) * point[column];
        }
    }
    result
}

/// Builds one mesh from a block's side plates, each turned into place.
///
/// Turning by a proper rotation keeps the triangle order, so the "clockwise from
/// outside" rule the viewer relies on still holds.
pub fn assemble(
    install: &Path,
    subtype: &str,
    topology: &str,
    side_models: &[String],
    detail: usize,
) -> Result<ModelMesh, String> {
    let turns = rotations_for(subtype, topology, side_models.len())
        .ok_or_else(|| format!("no side-plate turns known for {subtype} ({topology})"))?;

    let mut positions: Vec<f32> = Vec::new();
    let mut uvs: Vec<f32> = Vec::new();
    let mut indices: Vec<u32> = Vec::new();
    let mut parts: Vec<MeshPart> = Vec::new();

    for (side_model, &turn_index) in side_models.iter().zip(turns) {
        let plate = mwm::load_model(install, side_model, detail)?;
        let turn = ROTATIONS.get(usize::from(turn_index)).ok_or("turn index out of range")?;
        let first_vertex = u32::try_from(positions.len() / 3).map_err(|_| "too many vertices")?;
        let first_index = u32::try_from(indices.len()).map_err(|_| "too many indices")?;

        let (vertices, _) = plate.positions.as_chunks::<3>();
        for vertex in vertices {
            positions.extend_from_slice(&turn_point(turn, *vertex));
        }
        uvs.extend_from_slice(&plate.uvs); // turning a plate does not change its texture coordinates
        indices.extend(plate.indices.iter().map(|index| index + first_vertex));
        for part in plate.parts {
            parts.push(MeshPart { first_index: part.first_index + first_index, ..part });
        }
    }
    Ok(ModelMesh { positions, uvs, indices, parts })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::se1;
    use std::collections::HashSet;

    #[test]
    fn every_turn_is_a_proper_rotation() {
        for turn in &ROTATIONS {
            let at = |index: usize| i32::from(turn[index]);
            let determinant = at(0) * (at(4) * at(8) - at(5) * at(7)) - at(1) * (at(3) * at(8) - at(5) * at(6))
                + at(2) * (at(3) * at(7) - at(4) * at(6));
            assert_eq!(determinant, 1, "a mirror would turn the triangles inside out");
        }
        for (first, turn) in ROTATIONS.iter().enumerate() {
            for (second, other) in ROTATIONS.iter().enumerate().skip(first + 1) {
                assert_ne!(turn, other, "turns {first} and {second} are the same");
            }
        }
    }

    /// Every edge of every triangle, as a pair of rounded corner positions.
    fn directed_edges(mesh: &ModelMesh) -> Vec<([i32; 3], [i32; 3])> {
        let key = |index: u32| -> [i32; 3] {
            let at = index as usize * 3;
            [0, 1, 2].map(|axis| (mesh.positions[at + axis] * 256.0).round() as i32)
        };
        let mut edges = Vec::new();
        for triangle in mesh.indices.as_chunks::<3>().0 {
            for (from, to) in [(0, 1), (1, 2), (2, 0)] {
                let (start, end) = (key(triangle[from]), key(triangle[to]));
                if start != end {
                    edges.push((start, end));
                }
            }
        }
        edges
    }

    /// How many edges of the surface have no partner running the other way, after
    /// splitting edges at any corner that touches them. (Along a seam one plate can
    /// have an extra corner that its neighbour lacks; that is not a gap.) Zero means
    /// the surface is closed.
    fn unmatched_edges(mesh: &ModelMesh) -> usize {
        let edges = directed_edges(mesh);
        let set: HashSet<_> = edges.iter().copied().collect();
        let corners: HashSet<[i32; 3]> = edges.iter().flat_map(|(start, end)| [*start, *end]).collect();

        let leftovers: Vec<_> = edges.iter().filter(|(start, end)| !set.contains(&(*end, *start))).copied().collect();
        // Cut every leftover edge at the corners lying strictly inside it.
        let mut pieces: HashSet<([i32; 3], [i32; 3])> = HashSet::new();
        for (start, end) in &leftovers {
            let along = [0, 1, 2].map(|axis| i64::from(end[axis] - start[axis]));
            let mut cuts: Vec<(i64, [i32; 3])> = Vec::new();
            for corner in &corners {
                let offset = [0, 1, 2].map(|axis| i64::from(corner[axis] - start[axis]));
                let cross = [
                    along[1] * offset[2] - along[2] * offset[1],
                    along[2] * offset[0] - along[0] * offset[2],
                    along[0] * offset[1] - along[1] * offset[0],
                ];
                let dot = along[0] * offset[0] + along[1] * offset[1] + along[2] * offset[2];
                let length_squared = along[0] * along[0] + along[1] * along[1] + along[2] * along[2];
                if cross == [0, 0, 0] && dot >= 0 && dot <= length_squared {
                    cuts.push((dot, *corner));
                }
            }
            cuts.sort_by_key(|(distance, _)| *distance);
            cuts.dedup_by_key(|(distance, _)| *distance);
            for pair in cuts.windows(2) {
                pieces.insert((pair[0].1, pair[1].1));
            }
        }
        pieces.iter().filter(|(start, end)| !pieces.contains(&(*end, *start))).count()
    }

    /// Volume inside the surface (the game stores triangles clockwise from outside).
    fn volume(mesh: &ModelMesh) -> f64 {
        let at = |index: u32| -> [f64; 3] {
            let start = index as usize * 3;
            [0, 1, 2].map(|axis| f64::from(mesh.positions[start + axis]))
        };
        let mut total = 0.0;
        for triangle in mesh.indices.as_chunks::<3>().0 {
            let (a, b, c) = (at(triangle[0]), at(triangle[1]), at(triangle[2]));
            total += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
        }
        -total / 6.0
    }

    fn find<'a>(catalog: &'a se1::Se1Catalog, subtype: &str) -> &'a se1::BlockInfo {
        catalog.blocks.iter().find(|block| block.subtype_id == subtype).expect("block missing")
    }

    fn build(install: &Path, block: &se1::BlockInfo) -> Result<ModelMesh, String> {
        assemble(install, &block.subtype_id, block.cube_topology.as_deref().unwrap_or(""), &block.side_models, 0)
    }

    fn has_vertex(mesh: &ModelMesh, x: f32, y: f32, z: f32) -> bool {
        let (vertices, _) = mesh.positions.as_chunks::<3>();
        vertices.iter().any(|v| (v[0] - x).abs() < 0.01 && (v[1] - y).abs() < 0.01 && (v[2] - z).abs() < 0.01)
    }

    #[test]
    fn slope_is_half_a_cube_and_falls_away_to_the_back() {
        let install = se1::find_install().expect("install not found");
        let catalog = se1::load_catalog(&install).expect("catalog failed");
        let mesh = build(&install, find(&catalog, "LargeBlockArmorSlope")).expect("assemble failed");
        let cube = 2.5f64.powi(3);
        let inside = volume(&mesh);
        assert!((inside - cube / 2.0).abs() < 0.01, "a slope is half a cube, got {inside} of {cube}");
        // The game's mount points say the slope is flat at the front and at the bottom.
        assert!(has_vertex(&mesh, 1.25, 1.25, -1.25), "front top corner must exist");
        assert!(!has_vertex(&mesh, 1.25, 1.25, 1.25), "back top corner must not exist");
        assert!(has_vertex(&mesh, 1.25, -1.25, 1.25), "back bottom corner must exist");
    }

    #[test]
    fn a_corner_is_a_sixth_of_a_cube_with_its_point_where_the_mount_faces_meet() {
        let install = se1::find_install().expect("install not found");
        let catalog = se1::load_catalog(&install).expect("catalog failed");
        let mesh = build(&install, find(&catalog, "LargeBlockArmorCorner")).expect("assemble failed");
        let inside = volume(&mesh);
        assert!((inside - 2.5f64.powi(3) / 6.0).abs() < 0.01, "got {inside}");
        // Mount points: right (+x), bottom (-y), front (-z) are the flat faces.
        assert!(has_vertex(&mesh, 1.25, -1.25, -1.25));
    }

    #[test]
    fn every_armor_block_assembles_into_a_closed_solid_inside_its_cell() {
        let install = se1::find_install().expect("install not found");
        let catalog = se1::load_catalog(&install).expect("catalog failed");
        let mut checked = 0;
        let mut problems = Vec::new();
        for block in catalog.blocks.iter().filter(|block| !block.side_models.is_empty()) {
            // The interior wall is a set of thin walls, not a closed solid; it keeps its box.
            if block.cube_topology.as_deref() == Some("StandaloneBox") {
                continue;
            }
            let mesh = match build(&install, block) {
                Ok(mesh) => mesh,
                Err(message) => {
                    problems.push(format!("{}: {message}", block.subtype_id));
                    continue;
                }
            };
            checked += 1;
            let half = if block.cube_size == "Large" { 1.25 } else { 0.25 };
            let (low, high) = mesh.bounds();
            if (0..3).any(|axis| low[axis] < -half - 0.01 || high[axis] > half + 0.01) {
                problems.push(format!("{}: sticks out of its cell", block.subtype_id));
            }
            let inside = volume(&mesh);
            let cell = (f64::from(half) * 2.0).powi(3);
            if !(inside > 0.0 && inside <= cell + 0.001) {
                problems.push(format!("{}: volume {inside:.3} of a {cell:.3} cell", block.subtype_id));
            }
            let open = unmatched_edges(&mesh);
            if open > 0 {
                problems.push(format!("{}: {open} open edges", block.subtype_id));
            }
        }
        println!("checked {checked} armor blocks");
        assert!(checked >= 140, "expected about 147 armor blocks, saw {checked}");
        assert!(problems.is_empty(), "problems:\n{}", problems.join("\n"));
    }

    /// DEVELOPMENT TOOL (ignored): writes the assembled shapes and the game's icons for a
    /// few armor blocks to `devfixtures/armor/`, so a test page can compare drawings with
    /// the game's own pictures.   cargo test export_armor_fixtures -- --ignored --nocapture
    #[test]
    #[ignore]
    fn export_armor_fixtures() {
        let install = se1::find_install().expect("install not found");
        let catalog = se1::load_catalog(&install).expect("catalog failed");
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("devfixtures").join("armor");
        std::fs::create_dir_all(&root).unwrap();
        let wanted = std::fs::read_to_string(root.join("wanted.txt")).unwrap_or_default();
        let mut written = Vec::new();
        for line in wanted.lines().map(str::trim).filter(|line| !line.is_empty()) {
            // A line is either a subtype, or `TypeId|SubtypeId` (for blocks whose subtype is empty).
            let (type_name, name) = line.split_once('|').unwrap_or(("", line));
            let Some(block) = catalog.blocks.iter().find(|block| {
                block.subtype_id == name && (type_name.is_empty() || block.type_id.ends_with(type_name))
            }) else {
                println!("not found: {line}");
                continue;
            };
            let built = match &block.model {
                Some(model) => mwm::load_model_with_subparts(&install, model, 0),
                None => build(&install, block),
            };
            let Ok(mesh) = built else {
                println!("cannot build: {line}");
                continue;
            };
            let file = if name.is_empty() { block.type_id.clone() } else { name.to_string() };
            std::fs::write(root.join(format!("{file}.bin")), mesh.encode_for_viewer()).unwrap();
            // The model's textures, saved as PNG named after the texture path.
            for part in &mesh.parts {
                if part.color_texture.is_empty() {
                    continue;
                }
                let png_name = part.color_texture.replace(['\\', '/', ':'], "__").to_lowercase();
                if let Ok(png) = se1::load_texture_png(&install, &part.color_texture, 512) {
                    std::fs::write(root.join(format!("tex_{png_name}.png")), png).unwrap();
                }
            }
            if let Some(icon) = &block.icon
                && let Ok(png) = se1::load_icon_png(&install, icon)
            {
                std::fs::write(root.join(format!("{file}.png")), png).unwrap();
            }
            written.push(file);
        }
        std::fs::write(root.join("index.json"), serde_json::to_string(&written).unwrap()).unwrap();
        println!("wrote {} shapes", written.len());
    }
}

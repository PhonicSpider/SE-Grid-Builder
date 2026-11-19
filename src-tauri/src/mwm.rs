//! Reading Space Engineers 1 `.mwm` model files.
//!
//! The format is not publicly documented. This reader was worked out from the
//! files themselves (see the Obsidian note "MWM Model Format") and checked
//! against every block model in the game: each file's own `ModelInfo` triangle
//! and vertex counts must match what is read here (see the tests).
//!
//! WHAT A FILE LOOKS LIKE
//!   * A header: the text "Debug", a list of debug strings, then an INDEX of
//!     named sections ("tags"), each with the byte position where it starts.
//!   * Each tag is stored as its name followed by its data.
//!   * Strings are length-prefixed: the length uses 7 bits per byte (like C#'s
//!     BinaryWriter), then the UTF-8 text.
//!   * The small "base" file of a model (`Foo.mwm`) usually holds only
//!     bookkeeping. The triangles live in a separate file named by its
//!     `GeometryDataAsset` tag (`Foo_LOD0.mwm`), and the `LODs` tag lists the
//!     simpler versions (`Foo_LOD1.mwm`, ...).
//!
//! WHAT WE KEEP
//!   * `Vertices`: positions only. Each vertex is 4 half-precision numbers
//!     (x, y, z, w) and the real position is (x, y, z) multiplied by w. The
//!     file stores small numbers scaled by a whole number (1, 2 or 3) to keep
//!     precision. This was found by comparing against each file's stored
//!     bounding box: without the multiplication, big models come out too small
//!     and their curved surfaces turn into spikes.
//!   * `MeshParts`: the triangle indices, grouped by material.
//!   * Packed normals and texture coordinates are skipped: the viewer works
//!     lighting out from the triangles, and does not draw textures yet.
//!
//! RUST NOTES:
//!   * Every read checks its bounds and returns `Err`, never panics, so a
//!     damaged file cannot crash the app (a test hammers this).
//!   * `?` passes an error up; `.ok_or_else(..)` turns a missing `Option` into an error.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::se1;

/// The most mesh parts or LODs we accept, to reject nonsense counts early.
const MAX_SMALL_COUNT: usize = 4096;

// ---------------------------------------------------------------------------
// Bounds-checked reading of bytes
// ---------------------------------------------------------------------------

/// A position in a byte slice with safe `read_*` methods.
struct ByteReader<'a> {
    bytes: &'a [u8],
    position: usize,
}

impl<'a> ByteReader<'a> {
    fn new(bytes: &'a [u8], position: usize) -> Self {
        Self { bytes, position }
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.position)
    }

    /// Takes the next `length` bytes, or fails if the file ends first.
    fn take(&mut self, length: usize) -> Result<&'a [u8], String> {
        if length > self.remaining() {
            return Err(format!(
                "file ends early: wanted {length} bytes at {}, only {} left",
                self.position,
                self.remaining()
            ));
        }
        let slice = &self.bytes[self.position..self.position + length];
        self.position += length;
        Ok(slice)
    }

    fn read_u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }

    fn read_i32(&mut self) -> Result<i32, String> {
        let bytes = self.take(4)?;
        Ok(i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    fn read_f32(&mut self) -> Result<f32, String> {
        let bytes = self.take(4)?;
        Ok(f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    /// A count that must be zero or more and no bigger than `limit`.
    fn read_count(&mut self, limit: usize) -> Result<usize, String> {
        let value = self.read_i32()?;
        usize::try_from(value)
            .ok()
            .filter(|count| *count <= limit)
            .ok_or_else(|| format!("unreasonable count {value} (limit {limit})"))
    }

    /// A string: its length in 7-bit groups (low groups first), then UTF-8 text.
    fn read_string(&mut self) -> Result<String, String> {
        let mut length: usize = 0;
        let mut shift = 0;
        loop {
            let byte = self.read_u8()?;
            length |= usize::from(byte & 0x7F) << shift;
            if byte & 0x80 == 0 {
                break;
            }
            shift += 7;
            if shift > 28 {
                return Err("string length is too long".to_string());
            }
        }
        let text = self.take(length)?;
        Ok(String::from_utf8_lossy(text).into_owned())
    }
}

/// Converts a half-precision float (16 bits) to a normal 32-bit float.
fn half_to_f32(bits: u16) -> f32 {
    let sign = if bits & 0x8000 != 0 { -1.0 } else { 1.0 };
    let exponent = i32::from((bits >> 10) & 0x1F);
    let fraction = f32::from(bits & 0x3FF);
    match exponent {
        0 => sign * fraction * 2f32.powi(-24),             // tiny "subnormal" numbers
        31 => if fraction == 0.0 { sign * f32::INFINITY } else { f32::NAN },
        _ => sign * (1.0 + fraction / 1024.0) * 2f32.powi(exponent - 15),
    }
}

// ---------------------------------------------------------------------------
// The file index
// ---------------------------------------------------------------------------

/// A whole `.mwm` file in memory plus its tag index.
struct MwmFile {
    bytes: Vec<u8>,
    tag_offsets: HashMap<String, usize>,
}

impl MwmFile {
    fn parse(bytes: Vec<u8>) -> Result<Self, String> {
        // The reader only borrows `bytes`; it ends with this block so the
        // bytes can then be moved into the result without copying them.
        let tag_offsets = {
            let mut reader = ByteReader::new(&bytes, 0);
            let first = reader.read_string()?;
            if first != "Debug" {
                return Err("not a .mwm file (missing the Debug header)".to_string());
            }
            for _ in 0..reader.read_count(MAX_SMALL_COUNT)? {
                reader.read_string()?; // debug strings, such as the version
            }

            let tag_count = reader.read_count(MAX_SMALL_COUNT)?;
            let mut offsets = HashMap::new();
            for _ in 0..tag_count {
                let name = reader.read_string()?;
                let offset = reader.read_count(bytes.len())?;
                offsets.insert(name, offset);
            }
            offsets
        };
        Ok(Self { bytes, tag_offsets })
    }

    /// A reader placed on a tag's data (just after its name), if the file has that tag.
    fn tag(&self, name: &str) -> Result<Option<ByteReader<'_>>, String> {
        let Some(offset) = self.tag_offsets.get(name) else {
            return Ok(None);
        };
        let mut reader = ByteReader::new(&self.bytes, *offset);
        let stored_name = reader.read_string()?;
        if stored_name != name {
            return Err(format!("index says '{name}' but the file has '{stored_name}' there"));
        }
        Ok(Some(reader))
    }
}

// ---------------------------------------------------------------------------
// The geometry we hand to the viewer
// ---------------------------------------------------------------------------

/// A group of triangles that share one material.
#[derive(Debug, Clone, PartialEq)]
pub struct MeshPart {
    /// Where this part's indices start inside `ModelMesh::indices`.
    pub first_index: u32,
    pub index_count: u32,
    pub material: String,
    /// How the game shades it: "MESH", "GLASS", "DECAL", ...
    pub technique: String,
    /// Path of the colour texture (`ColorMetalTexture`), if the material has one.
    pub color_texture: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModelMesh {
    /// x, y, z for each vertex, in meters, in the block's own coordinates.
    pub positions: Vec<f32>,
    /// u, v for each vertex (two numbers per vertex, same count as `positions` / 3).
    /// Zeros when the file has no usable texture coordinates.
    pub uvs: Vec<f32>,
    /// Three indices per triangle, in the order stored (clockwise seen from outside).
    pub indices: Vec<u32>,
    pub parts: Vec<MeshPart>,
}

impl ModelMesh {
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }

    /// The smallest and largest corner of the box around every vertex.
    pub fn bounds(&self) -> ([f32; 3], [f32; 3]) {
        let mut low = [f32::INFINITY; 3];
        let mut high = [f32::NEG_INFINITY; 3];
        let (vertices, _) = self.positions.as_chunks::<3>();
        for vertex in vertices {
            for axis in 0..3 {
                low[axis] = low[axis].min(vertex[axis]);
                high[axis] = high[axis].max(vertex[axis]);
            }
        }
        if self.positions.is_empty() {
            return ([0.0; 3], [0.0; 3]);
        }
        (low, high)
    }

    /// Packs the mesh into the compact layout the front-end reads
    /// (`src/modelLoader.ts` has the matching reader). All numbers are
    /// little-endian.
    ///
    /// ```text
    /// u32  magic 0x444D4553 ("SEMD")
    /// u32  vertex count        u32  index count        u32  part count
    /// f32  bounds minimum x, y, z                f32  bounds maximum x, y, z
    /// f32  positions: vertex count * 3
    /// f32  texture coordinates: vertex count * 2 (u, v)
    /// u32  indices:   index count
    /// per part:  u32 first index, u32 index count,
    ///            u32 material length, material bytes,
    ///            u32 technique length, technique bytes,
    ///            u32 texture length, texture bytes
    /// ```
    /// The 40-byte header keeps the position array aligned to 4 bytes, which
    /// the browser needs to view it as a `Float32Array` without copying.
    pub fn encode_for_viewer(&self) -> Vec<u8> {
        let (low, high) = self.bounds();
        let mut bytes = Vec::with_capacity(40 + self.positions.len() * 4 + self.uvs.len() * 4 + self.indices.len() * 4 + 64);

        bytes.extend_from_slice(&0x444D_4553u32.to_le_bytes());
        bytes.extend_from_slice(&(self.vertex_count() as u32).to_le_bytes());
        bytes.extend_from_slice(&(self.indices.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&(self.parts.len() as u32).to_le_bytes());
        for number in low.iter().chain(high.iter()) {
            bytes.extend_from_slice(&number.to_le_bytes());
        }
        for position in &self.positions {
            bytes.extend_from_slice(&position.to_le_bytes());
        }
        for coordinate in &self.uvs {
            bytes.extend_from_slice(&coordinate.to_le_bytes());
        }
        for index in &self.indices {
            bytes.extend_from_slice(&index.to_le_bytes());
        }
        for part in &self.parts {
            bytes.extend_from_slice(&part.first_index.to_le_bytes());
            bytes.extend_from_slice(&part.index_count.to_le_bytes());
            for text in [&part.material, &part.technique, &part.color_texture] {
                bytes.extend_from_slice(&(text.len() as u32).to_le_bytes());
                bytes.extend_from_slice(text.as_bytes());
            }
        }
        bytes
    }
}

// ---------------------------------------------------------------------------
// Reading the geometry
// ---------------------------------------------------------------------------

/// Reads `Vertices` and `MeshParts` from a file that holds geometry.
fn read_geometry(file: &MwmFile) -> Result<ModelMesh, String> {
    // --- Vertices: a count, then 4 half-precision numbers per vertex: x, y, z and
    // a scale. The real position is (x, y, z) times the scale.
    let mut reader = file.tag("Vertices")?.ok_or("this file has no Vertices")?;
    let vertex_count = reader.read_count(reader.remaining() / 8)?;
    let mut positions = Vec::with_capacity(vertex_count * 3);
    for _ in 0..vertex_count {
        let raw = reader.take(8)?;
        let half_at = |slot: usize| half_to_f32(u16::from_le_bytes([raw[slot * 2], raw[slot * 2 + 1]]));
        let scale = half_at(3);
        for axis in 0..3 {
            let value = half_at(axis) * scale;
            if !value.is_finite() {
                return Err("a vertex position is not a number".to_string());
            }
            positions.push(value);
        }
    }

    let uvs = read_texture_coordinates(file, vertex_count)?;

    // --- MeshParts: a count, then for each part its triangles and material.
    let mut reader = file.tag("MeshParts")?.ok_or("this file has no MeshParts")?;
    let part_count = reader.read_count(MAX_SMALL_COUNT)?;
    let mut indices: Vec<u32> = Vec::new();
    let mut parts = Vec::with_capacity(part_count);

    for _ in 0..part_count {
        let _material_hash = reader.read_i32()?;
        let index_count = reader.read_count(reader.remaining() / 4)?;
        if index_count % 3 != 0 {
            return Err(format!("a part has {index_count} indices, not a multiple of 3"));
        }
        let first_index = indices.len() as u32;
        for _ in 0..index_count {
            let index = reader.read_i32()?;
            let index = u32::try_from(index)
                .ok()
                .filter(|index| (*index as usize) < vertex_count)
                .ok_or_else(|| format!("index {index} is outside the {vertex_count} vertices"))?;
            indices.push(index);
        }

        // A flag says whether this part carries material data. Most do (1).
        // Some parts (seen in big models such as the warhead) have none (0),
        // and the next part follows straight away.
        let has_material = reader.read_u8()? != 0;

        let mut material = String::new();
        let mut technique = String::new();
        let mut color_texture = String::new();
        if has_material {
            material = reader.read_string()?;

            // Textures: (kind, path) pairs such as "ColorMetalTexture" -> "Textures\...dds".
            for _ in 0..reader.read_count(MAX_SMALL_COUNT)? {
                let kind = reader.read_string()?;
                let path = reader.read_string()?;
                if kind == "ColorMetalTexture" {
                    color_texture = path;
                }
            }
            // Material settings: (name, value) pairs. We do not use them.
            for _ in 0..reader.read_count(MAX_SMALL_COUNT)? {
                reader.read_string()?;
                reader.read_string()?;
            }
            technique = reader.read_string()?;
            if technique == "GLASS" {
                // Glass parts end with two more material names and a flag.
                reader.read_string()?;
                reader.read_string()?;
                reader.read_u8()?;
            }
        }

        parts.push(MeshPart { first_index, index_count: index_count as u32, material, technique, color_texture });
    }

    Ok(ModelMesh { positions, uvs, indices, parts })
}

/// Reads `TexCoords0`: a count, then two half-precision numbers (u, v) per vertex.
/// Gives zeros when the tag is missing or does not match the vertex count, so a
/// model with odd texture data still draws (without its texture detail).
fn read_texture_coordinates(file: &MwmFile, vertex_count: usize) -> Result<Vec<f32>, String> {
    let mut uvs = vec![0.0; vertex_count * 2];
    let Some(mut reader) = file.tag("TexCoords0")? else {
        return Ok(uvs);
    };
    let count = reader.read_count(reader.remaining() / 4)?;
    if count != vertex_count {
        return Ok(uvs);
    }
    for coordinate in &mut uvs {
        let raw = reader.take(2)?;
        let value = half_to_f32(u16::from_le_bytes([raw[0], raw[1]]));
        *coordinate = if value.is_finite() { value } else { 0.0 };
    }
    Ok(uvs)
}

/// The triangle and vertex counts the file claims for itself (`ModelInfo`).
/// Used by tests to check the reader against the game's own numbers.
#[cfg(test)]
fn read_model_info(file: &MwmFile) -> Result<Option<(usize, usize)>, String> {
    let Some(mut reader) = file.tag("ModelInfo")? else {
        return Ok(None);
    };
    let triangles = reader.read_count(usize::MAX >> 1)?;
    let vertices = reader.read_count(usize::MAX >> 1)?;
    Ok(Some((triangles, vertices)))
}

/// Adds ".mwm" to a path from inside a model file when it has no extension.
fn with_mwm_extension(path: &str) -> String {
    if path.to_ascii_lowercase().ends_with(".mwm") {
        path.to_string()
    } else {
        format!("{path}.mwm")
    }
}

/// Reads the model paths of the `LODs` tag: a count, then per level of detail a
/// view distance (f32), the model path and a construction-model path. Stops
/// quietly at the first thing that does not read, keeping what it has so far.
fn read_lod_models(reader: &mut ByteReader) -> Vec<String> {
    let mut models = Vec::new();
    let Ok(count) = reader.read_count(64) else {
        return models;
    };
    for _ in 0..count {
        let level = reader.read_f32().and_then(|_distance| {
            let model = reader.read_string()?;
            reader.read_string()?; // the construction model; not used
            Ok(model)
        });
        match level {
            Ok(model) if !model.is_empty() => models.push(model),
            _ => break,
        }
    }
    models
}

/// The model files that hold geometry, best detail first.
///
/// A model is a base file plus lower-detail copies. The base file either holds
/// geometry itself (older models) or names the full-detail file in
/// `GeometryDataAsset`. The `LODs` tag lists the simpler versions.
fn geometry_files(install: &Path, base: &MwmFile, base_path: &str) -> Result<Vec<String>, String> {
    let mut paths = Vec::new();

    if base.tag_offsets.contains_key("Vertices") {
        paths.push(base_path.to_string());
    } else if let Some(mut reader) = base.tag("GeometryDataAsset")? {
        paths.push(with_mwm_extension(&reader.read_string()?));
    } else {
        return Err("the model has no geometry".to_string());
    }

    // If the LODs tag is odd, the full-detail model alone is still fine, so errors there are ignored.
    if let Ok(Some(mut reader)) = base.tag("LODs") {
        paths.extend(read_lod_models(&mut reader).iter().map(|model| with_mwm_extension(model)));
    }

    // Keep only the files that exist inside the game folder.
    paths.retain(|path| se1::resolve_content_file(install, path, "mwm").is_ok());
    if paths.is_empty() {
        return Err("the model's geometry files were not found".to_string());
    }
    Ok(paths)
}

/// Loads a block model from the player's install.
///
/// `detail` picks the level of detail: 0 is the most detailed; higher numbers
/// are simpler. Asking for more detail than exists returns the simplest one.
pub fn load_model(install: &Path, model: &str, detail: usize) -> Result<ModelMesh, String> {
    let base_path = se1::resolve_content_file(install, model, "mwm")?;
    let base = MwmFile::parse(fs::read(&base_path).map_err(|error| format!("cannot read {model}: {error}"))?)?;

    let files = geometry_files(install, &base, model)?;
    let chosen = &files[detail.min(files.len() - 1)];
    let geometry_path = se1::resolve_content_file(install, chosen, "mwm")?;
    let geometry = MwmFile::parse(
        fs::read(&geometry_path).map_err(|error| format!("cannot read {chosen}: {error}"))?,
    )?;
    read_geometry(&geometry).map_err(|error| format!("{model}: {error}"))
}

// ---------------------------------------------------------------------------
// Sub-parts: turret barrels, rotor heads, door panels
// ---------------------------------------------------------------------------

/// How deep sub-parts may nest (a turret is base, then swivel, then barrel).
const MAX_SUBPART_DEPTH: usize = 4;

/// A named point in a model. Those called `subpart_...` mark where another model
/// (a turret barrel, a door panel) attaches.
struct Dummy {
    name: String,
    /// 4x4 matrix, row by row, for row vectors (a point is multiplied on the left).
    /// The first three rows are the axes, the last row the position.
    matrix: [f32; 16],
    /// `file` property: the sub-part's model name, when given.
    file: Option<String>,
}

/// Reads the `Dummies` tag: a count, then per dummy a name, 16 matrix numbers,
/// and a list of text properties.
fn read_dummies(file: &MwmFile) -> Result<Vec<Dummy>, String> {
    let Some(mut reader) = file.tag("Dummies")? else {
        return Ok(Vec::new());
    };
    let count = reader.read_count(MAX_SMALL_COUNT)?;
    let mut dummies = Vec::with_capacity(count);
    for _ in 0..count {
        let name = reader.read_string()?;
        let mut matrix = [0.0f32; 16];
        for number in &mut matrix {
            *number = reader.read_f32()?;
        }
        let mut model_file = None;
        for _ in 0..reader.read_count(MAX_SMALL_COUNT)? {
            let key = reader.read_string()?;
            let value = reader.read_string()?;
            if key == "file" {
                model_file = Some(value);
            }
        }
        dummies.push(Dummy { name, matrix, file: model_file });
    }
    Ok(dummies)
}

/// Turns a sub-part's matrix into a clean placement. The files store a scale in
/// the axes (0.1 for turret parts) that does not apply to the sub-part's own
/// geometry, so each axis is rescaled to length 1. Returns None for a broken matrix.
fn placement_of_dummy(matrix: &[f32; 16]) -> Option<[f32; 12]> {
    let mut result = [0.0f32; 12];
    for row in 0..3 {
        let axis = [matrix[row * 4], matrix[row * 4 + 1], matrix[row * 4 + 2]];
        let length = (axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]).sqrt();
        if !length.is_finite() || length < 1e-6 {
            return None;
        }
        for column in 0..3 {
            result[row * 3 + column] = axis[column] / length;
        }
    }
    // The position is the last row. Shape of `result`: 9 axis numbers, then 3 position numbers.
    result[9..12].copy_from_slice(&matrix[12..15]);
    Some(result)
}

/// Adds `child` to `mesh`, moved and turned by `placement` (see `placement_of_dummy`).
fn append_placed(mesh: &mut ModelMesh, child: ModelMesh, placement: &[f32; 12]) {
    let first_vertex = (mesh.positions.len() / 3) as u32;
    let first_index = mesh.indices.len() as u32;
    let (vertices, _) = child.positions.as_chunks::<3>();
    for vertex in vertices {
        for column in 0..3 {
            mesh.positions.push(
                vertex[0] * placement[column]
                    + vertex[1] * placement[3 + column]
                    + vertex[2] * placement[6 + column]
                    + placement[9 + column],
            );
        }
    }
    mesh.uvs.extend_from_slice(&child.uvs); // texture coordinates do not move with the vertices
    mesh.indices.extend(child.indices.iter().map(|index| index + first_vertex));
    for part in child.parts {
        mesh.parts.push(MeshPart { first_index: part.first_index + first_index, ..part });
    }
}

/// Like `load_model`, but also draws the model's sub-parts in their rest position:
/// the barrel and swivel of a turret, the head of a rotor, and so on.
///
/// A sub-part is named in the parent's `Dummies` by `subpart_<name>`; its model is
/// `<name>.mwm` in the same folder (or the dummy's `file` property). A sub-part that
/// cannot be loaded is left out; the rest of the model still draws.
pub fn load_model_with_subparts(install: &Path, model: &str, detail: usize) -> Result<ModelMesh, String> {
    load_with_subparts(install, model, detail, 0)
}

fn load_with_subparts(install: &Path, model: &str, detail: usize, depth: usize) -> Result<ModelMesh, String> {
    // Geometry can be missing on purpose (a model that is only sub-parts), so an
    // empty mesh is the starting point if the main part has none.
    let mut mesh = load_model(install, model, detail).unwrap_or(ModelMesh { positions: vec![], uvs: vec![], indices: vec![], parts: vec![] });
    if depth >= MAX_SUBPART_DEPTH {
        return finish(mesh, model);
    }

    let base_path = se1::resolve_content_file(install, model, "mwm")?;
    let Ok(base) = fs::read(&base_path).map_err(|error| error.to_string()).and_then(MwmFile::parse) else {
        return finish(mesh, model);
    };
    let folder = model.rsplit_once('\\').map_or("", |(folder, _)| folder);
    for dummy in read_dummies(&base).unwrap_or_default() {
        let Some(suffix) = dummy.name.strip_prefix("subpart_") else {
            continue;
        };
        let Some(placement) = placement_of_dummy(&dummy.matrix) else {
            continue;
        };
        let file_name = dummy.file.as_deref().unwrap_or(suffix);
        let sub_model = format!("{folder}\\{file_name}.mwm");
        if let Ok(child) = load_with_subparts(install, &sub_model, detail, depth + 1) {
            append_placed(&mut mesh, child, &placement);
        }
    }
    finish(mesh, model)
}

fn finish(mesh: ModelMesh, model: &str) -> Result<ModelMesh, String> {
    if mesh.positions.is_empty() {
        Err(format!("{model}: no geometry"))
    } else {
        Ok(mesh)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn half_floats_decode_correctly() {
        assert_eq!(half_to_f32(0x3C00), 1.0);
        assert_eq!(half_to_f32(0xBC00), -1.0);
        assert_eq!(half_to_f32(0x3D00), 1.25); // the cube half-size, 2.5 m / 2
        assert_eq!(half_to_f32(0x0000), 0.0);
        assert_eq!(half_to_f32(0x4000), 2.0);
        assert!(half_to_f32(0x7E00).is_nan());
        assert!(half_to_f32(0x7C00).is_infinite());
    }

    #[test]
    fn strings_use_seven_bit_lengths() {
        // "Debug" is 5 characters; a 200-character string needs two length bytes (0xC8 0x01).
        let mut bytes = vec![5];
        bytes.extend_from_slice(b"Debug");
        let mut long = vec![0xC8, 0x01];
        long.extend(std::iter::repeat_n(b'a', 200));
        bytes.extend(long);

        let mut reader = ByteReader::new(&bytes, 0);
        assert_eq!(reader.read_string().unwrap(), "Debug");
        assert_eq!(reader.read_string().unwrap().len(), 200);
        assert!(reader.read_string().is_err(), "nothing is left to read");
    }

    #[test]
    fn rejects_files_that_are_not_models() {
        assert!(MwmFile::parse(Vec::new()).is_err());
        assert!(MwmFile::parse(b"hello world".to_vec()).is_err());
        let mut text_file = vec![4];
        text_file.extend_from_slice(b"Text");
        assert!(MwmFile::parse(text_file).is_err());
    }

    #[test]
    fn loads_the_heavy_square_plate_exactly() {
        let install = se1::find_install().expect("not found");
        let mesh = load_model(&install, r"Models\Cubes\Large\Armor\HeavySquarePlate.mwm", 0).expect("load failed");

        // Worked out by hand from the file: 9 vertices, 8 triangles, one material.
        assert_eq!(mesh.vertex_count(), 9);
        assert_eq!(mesh.indices.len(), 24);
        assert_eq!(mesh.parts.len(), 1);
        assert_eq!(mesh.parts[0].material, "HeavySquarePlate");
        assert_eq!(mesh.parts[0].technique, "MESH");
        assert!(mesh.parts[0].color_texture.ends_with("large_heavy_square_plate_cm.dds"));

        // It is a flat plate on the top face of a 2.5 m cube: y is 1.25 everywhere.
        let (low, high) = mesh.bounds();
        assert_eq!(low, [-1.25, 1.25, -1.25]);
        assert_eq!(high, [1.25, 1.25, 1.25]);
    }

    #[test]
    fn simpler_detail_levels_never_have_more_triangles() {
        let install = se1::find_install().expect("not found");
        // A corner block has several levels of detail.
        let model = r"Models\Cubes\Large\Armor\CornerTriangleLeftPlate.mwm";
        let mut previous = usize::MAX;
        for detail in 0..4 {
            let mesh = load_model(&install, model, detail).expect("load failed");
            println!("detail {detail}: {} triangles", mesh.indices.len() / 3);
            assert!(mesh.indices.len() <= previous, "detail {detail} has more triangles than the level before");
            previous = mesh.indices.len();
        }
        // Asking for far more detail levels than exist gives the simplest, not an error.
        assert!(load_model(&install, model, 99).is_ok());
    }

    #[test]
    fn rejects_paths_outside_the_game() {
        let install = se1::find_install().expect("not found");
        assert!(load_model(&install, r"..\Bin64\Havok.dll", 0).is_err());
        assert!(load_model(&install, r"Models\..\..\Bin64\Havok.mwm", 0).is_err());
        assert!(load_model(&install, "Models/Cubes/NoSuchModel.mwm", 0).is_err());
    }

    #[test]
    fn damaged_files_return_errors_and_never_panic() {
        let install = se1::find_install().expect("not found");
        let path = se1::resolve_content_file(&install, r"Models\Cubes\Large\Armor\HeavySquarePlate_LOD0.mwm", "mwm").unwrap();
        let original = fs::read(path).unwrap();

        let full = read_geometry(&MwmFile::parse(original.clone()).unwrap()).unwrap();

        // Cut the file short at many points. A cut that removes needed data must
        // be an error; a cut after the geometry is harmless. Either way the
        // result must be exactly the original mesh or an error, never garbage.
        for length in (0..original.len()).step_by(7) {
            if let Ok(mesh) = MwmFile::parse(original[..length].to_vec()).and_then(|file| read_geometry(&file)) {
                assert_eq!(mesh, full, "a file cut to {length} bytes loaded as a different mesh");
            }
        }
        // Cutting inside the geometry itself must fail.
        assert!(MwmFile::parse(original[..1000].to_vec()).and_then(|file| read_geometry(&file)).is_err());
        // Damage single bytes; the result may be fine or an error, but never a crash.
        for position in (0..original.len()).step_by(3) {
            let mut damaged = original.clone();
            damaged[position] = damaged[position].wrapping_add(0x55);
            let _ = MwmFile::parse(damaged).and_then(|file| read_geometry(&file));
        }
    }

    #[test]
    fn encoded_layout_is_aligned_and_complete() {
        let install = se1::find_install().expect("not found");
        let mesh = load_model(&install, r"Models\Cubes\Large\Armor\HeavySquarePlate.mwm", 0).unwrap();
        let bytes = mesh.encode_for_viewer();

        assert_eq!(&bytes[..4], &0x444D_4553u32.to_le_bytes());
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 9); // vertices
        assert_eq!(u32::from_le_bytes(bytes[8..12].try_into().unwrap()), 24); // indices
        assert_eq!(u32::from_le_bytes(bytes[12..16].try_into().unwrap()), 1); // parts
        // Positions start at byte 40, which is divisible by 4 (needed for Float32Array).
        assert_eq!(40 % 4, 0);
        let first_x = f32::from_le_bytes(bytes[40..44].try_into().unwrap());
        assert_eq!(first_x, mesh.positions[0]);
        // Texture coordinates follow the positions: two numbers per vertex.
        let uv_start = 40 + 9 * 12;
        let first_u = f32::from_le_bytes(bytes[uv_start..uv_start + 4].try_into().unwrap());
        assert_eq!(first_u, mesh.uvs[0]);
    }

    /// Every model that has a colour texture should also have real texture
    /// coordinates, sensibly sized. A few models may genuinely have none.
    #[test]
    fn textured_models_have_texture_coordinates() {
        let install = se1::find_install().expect("install not found");
        let catalog = se1::load_catalog(&install).expect("catalog failed");
        let mut textured = 0;
        let mut flat_uvs = Vec::new();
        let mut huge = Vec::new();
        for block in &catalog.blocks {
            let Some(model) = &block.model else { continue };
            let Ok(mesh) = load_model(&install, model, 0) else { continue };
            assert_eq!(mesh.uvs.len(), mesh.vertex_count() * 2, "{model}");
            if !mesh.parts.iter().any(|part| !part.color_texture.is_empty()) {
                continue;
            }
            textured += 1;
            if mesh.uvs.iter().all(|value| *value == 0.0) {
                flat_uvs.push(model.clone());
            }
            if mesh.uvs.iter().any(|value| value.abs() > 64.0) {
                huge.push(model.clone());
            }
        }
        println!("{textured} textured models; {} with all-zero uvs; {} with huge uvs", flat_uvs.len(), huge.len());
        assert!(textured > 500);
        assert!(flat_uvs.len() * 20 < textured, "too many models lost their texture coordinates: {flat_uvs:?}");
        assert!(huge.len() * 20 < textured, "texture coordinates look wrong: {huge:?}");
    }

    /// Blocks with sub-parts must still fit inside their block once the sub-parts are
    /// placed, which only holds if the placement rules (axes rescaled, position from the
    /// last row) are right. Also checks the turret really gains its barrel.
    #[test]
    fn subparts_land_inside_their_blocks() {
        let install = se1::find_install().expect("install not found");
        let catalog = se1::load_catalog(&install).expect("catalog failed");

        let turret = catalog.blocks.iter().find(|block| block.type_id.ends_with("LargeGatlingTurret") && block.subtype_id.is_empty() && block.cube_size == "Large").expect("turret missing");
        let model = turret.model.as_deref().unwrap();
        let alone = load_model(&install, model, 0).unwrap();
        let assembled = load_model_with_subparts(&install, model, 0).unwrap();
        assert!(assembled.vertex_count() > alone.vertex_count() * 3, "turret should gain base, swivel and barrel");
        let (_, high) = assembled.bounds();
        assert!(high[1] > -1.0, "the swivel and barrel rise above the base plate, got top {}", high[1]);

        let (mut with_subparts, mut outside) = (0, Vec::new());
        for block in catalog.blocks.iter().filter(|block| block.model.is_some()) {
            let model = block.model.as_deref().unwrap();
            let (Ok(alone), Ok(full)) = (load_model(&install, model, 0), load_model_with_subparts(&install, model, 0)) else { continue };
            if full.vertex_count() == alone.vertex_count() {
                continue;
            }
            with_subparts += 1;
            let cell = if block.cube_size == "Large" { 2.5 } else { 0.5 };
            let (low, high) = full.bounds();
            let slack = 0.3; // sub-parts may poke out a little in their rest pose
            for axis in 0..3 {
                let half = f64::from(block.size[axis]) * cell / 2.0 + f64::from(block.model_offset[axis]).abs() + slack;
                if f64::from(low[axis]).abs() > half || f64::from(high[axis]).abs() > half {
                    outside.push(format!("{} ({:?} {:?} limit {half:.2})", block.subtype_id, low, high));
                    break;
                }
            }
        }
        println!("{with_subparts} blocks gained sub-parts; {} stick out: {outside:?}", outside.len());
        assert!(with_subparts > 50, "expected many blocks with sub-parts, saw {with_subparts}");
        assert!(outside.len() * 10 <= with_subparts, "too many sub-part models land outside their block: {outside:?}");
    }

    /// DEVELOPMENT TOOL (ignored): dumps every armor side-plate mesh and every cube-side
    /// block definition to `devfixtures/plates.json`, for working out how plates assemble.
    ///   cargo test dump_plates -- --ignored --nocapture
    #[test]
    #[ignore]
    fn dump_plates() {
        let install = se1::find_install().expect("not found");
        let catalog = se1::load_catalog(&install).expect("catalog failed");
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("devfixtures");
        fs::create_dir_all(&root).unwrap();
        let mut plates = serde_json::Map::new();
        let mut blocks = Vec::new();
        for block in catalog.blocks.iter().filter(|block| !block.side_models.is_empty()) {
            for side in &block.side_models {
                if plates.contains_key(side) {
                    continue;
                }
                if let Ok(mesh) = load_model(&install, side, 0) {
                    plates.insert(side.to_string(), serde_json::json!({"positions": mesh.positions, "indices": mesh.indices}));
                }
            }
            blocks.push(serde_json::json!({
                "subtype": block.subtype_id, "topology": block.cube_topology, "sides": block.side_models,
                "size": block.size, "cube": block.cube_size, "offset": block.model_offset
            }));
        }
        // Final-stage construction models named by `devfixtures/construction_names.json`.
        let mut construction = serde_json::Map::new();
        if let Ok(names) = fs::read_to_string(root.join("construction_names.json"))
            && let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(&names)
        {
            for list in map.values() {
                for model in list.as_array().into_iter().flatten().filter_map(|value| value.as_str()) {
                    if !construction.contains_key(model)
                        && let Ok(mesh) = load_model(&install, model, 0)
                    {
                        construction.insert(model.to_string(), serde_json::json!({"positions": mesh.positions, "indices": mesh.indices}));
                    }
                }
            }
        }
        println!("{} construction models", construction.len());
        let text = serde_json::json!({"plates": plates, "blocks": blocks, "construction": construction}).to_string();
        fs::write(root.join("plates.json"), text).unwrap();
        println!("wrote {} plates, {} blocks", plates.len(), blocks.len());
    }

    /// DEVELOPMENT TOOL, not a real test (hence `ignore`): exports a few real blocks,
    /// their models and their game icons into `devfixtures/` at the project root, so
    /// a test page in a plain browser can draw them with the real viewer code and
    /// compare with the game's own icons. Run with:
    ///   cargo test export_viewer_fixtures -- --ignored --nocapture
    /// The folder is temporary; delete it afterwards.
    #[test]
    #[ignore]
    fn export_viewer_fixtures() {
        let install = se1::find_install().expect("not found");
        let catalog = se1::load_catalog(&install).expect("catalog failed");
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("devfixtures");
        fs::create_dir_all(root.join("models")).unwrap();
        fs::create_dir_all(root.join("icons")).unwrap();

        // Blocks to draw, as (type, subtype, cube size). A missing one is skipped rather
        // than failing. A fixed starter list, plus any lines in `devfixtures/wanted.txt`
        // (format `Type|Subtype|Large`), so any blueprint's blocks can be exported.
        let mut wanted: Vec<(String, String, String)> = [
            ("Reactor", "LargeBlockLargeGenerator"),
            ("Refinery", "LargeRefinery"),
            ("CargoContainer", "LargeBlockSmallContainer"),
            ("Cockpit", "LargeBlockCockpit"),
        ]
        .iter()
        .map(|(kind, name)| (kind.to_string(), name.to_string(), "Large".to_string()))
        .collect();
        if let Ok(extra) = fs::read_to_string(root.join("wanted.txt")) {
            for line in extra.lines() {
                let parts: Vec<&str> = line.trim().split('|').collect();
                if parts.len() == 3 {
                    wanted.push((parts[0].to_string(), parts[1].to_string(), parts[2].to_string()));
                }
            }
        }
        let mut chosen: Vec<se1::BlockInfo> = Vec::new();
        let sanitize = |text: &str| text.replace(['\\', '/', ':'], "__");
        for (type_name, name, cube_size) in wanted {
            if chosen.iter().any(|block| {
                block.type_id.trim_start_matches("MyObjectBuilder_") == type_name
                    && block.subtype_id == name
                    && block.cube_size == cube_size
            }) {
                continue; // already exported
            }
            let Some(block) = catalog.blocks.iter().find(|block| {
                block.type_id.trim_start_matches("MyObjectBuilder_") == type_name
                    && block.subtype_id == name
                    && block.cube_size == cube_size
            }) else {
                println!("skipped (not found): {type_name}/{name}");
                continue;
            };
            if let Some(model) = &block.model {
                match load_model(&install, model, 0) {
                    Ok(mesh) => fs::write(root.join("models").join(format!("{}.bin", sanitize(model))), mesh.encode_for_viewer()).unwrap(),
                    Err(error) => {
                        println!("model failed for {type_name}/{name}: {error}");
                        continue;
                    }
                }
            }
            if let Some(icon) = &block.icon
                && let Ok(png) = se1::load_icon_png(&install, icon)
            {
                let file_name = if block.subtype_id.is_empty() { block.type_id.clone() } else { block.subtype_id.clone() };
                fs::write(root.join("icons").join(format!("{file_name}.png")), png).unwrap();
            }
            chosen.push(block.clone());
        }
        // BlockInfo only derives Serialize, which is all that is needed here.
        let json = serde_json::to_string_pretty(&chosen).unwrap();
        fs::write(root.join("blocks.json"), json).unwrap();
        println!("exported {} blocks to {}", chosen.len(), root.display());
    }

    /// The strongest check of the vertex reading: for every block model, the box
    /// around the vertices we read must match the bounding box the game stored
    /// inside the same file (a different tag, written by the game's own tools).
    #[test]
    fn vertex_bounds_match_each_files_stored_bounding_box() {
        let install = se1::find_install().expect("not found");
        let catalog = se1::load_catalog(&install).expect("catalog failed");
        let mut models: Vec<String> = catalog.blocks.iter().filter_map(|block| block.model.clone()).collect();
        models.sort();
        models.dedup();

        let mut checked = 0;
        let mut disagreements = Vec::new();
        for model in &models {
            let Ok(mesh) = load_model(&install, model, 0) else { continue };
            // Find the geometry file again to read its BoundingBox tag.
            let base_path = se1::resolve_content_file(&install, model, "mwm").unwrap();
            let base = MwmFile::parse(fs::read(base_path).unwrap()).unwrap();
            let files = geometry_files(&install, &base, model).unwrap();
            let path = se1::resolve_content_file(&install, &files[0], "mwm").unwrap();
            let file = MwmFile::parse(fs::read(path).unwrap()).unwrap();
            let Some(mut reader) = file.tag("BoundingBox").unwrap() else { continue };
            let stored: Vec<f32> = (0..6).map(|_| reader.read_f32().unwrap()).collect();

            let (low, high) = mesh.bounds();
            let ours = [low[0], low[1], low[2], high[0], high[1], high[2]];
            checked += 1;
            // The stored box may be a little larger than the vertices (it is rounded
            // up by the exporter), so allow a small tolerance.
            let worst = (0..6).map(|index| (ours[index] - stored[index]).abs()).fold(0.0f32, f32::max);
            if worst > 0.05 {
                disagreements.push(format!("{model}: worst difference {worst:.3} m (ours {ours:?}, stored {stored:?})"));
            }
        }
        println!("{checked} models checked, {} disagree with their stored bounding box", disagreements.len());
        for line in disagreements.iter().take(12) {
            println!("  {line}");
        }
        assert!(disagreements.len() * 100 <= checked, "more than 1% of models disagree with their own bounding box");
    }

    /// Tests how models sit inside their blocks, for ALL block models.
    ///
    /// The viewer places a model with its origin at the middle of the block's
    /// cells (plus the definition's `ModelOffset`). If that is right, each
    /// model's bounding box must fit inside the block's size and be roughly
    /// centered. This measures how true that is across the whole game.
    #[test]
    fn models_sit_inside_their_blocks_around_the_center() {
        let install = se1::find_install().expect("not found");
        let catalog = se1::load_catalog(&install).expect("catalog failed");

        let mut checked = 0;
        let mut fits = 0;
        let mut centered = 0;
        let mut outliers = Vec::new();
        for block in catalog.blocks.iter().filter(|block| block.model.is_some()) {
            let model = block.model.as_ref().unwrap();
            let Ok(mesh) = load_model(&install, model, 0) else { continue };
            if mesh.positions.is_empty() {
                continue;
            }
            let cell_meters = if block.cube_size == "Small" { 0.5 } else { 2.5 };
            let (low, high) = mesh.bounds();
            checked += 1;

            let mut block_fits = true;
            let mut block_centered = true;
            for axis in 0..3 {
                let half = block.size[axis] as f32 * cell_meters / 2.0;
                let offset = block.model_offset[axis];
                // Where the model's box sits, relative to the block center.
                let (box_low, box_high) = (low[axis] + offset, high[axis] + offset);
                // Allow a little overhang: many models stick out slightly (antennas, pipes, frames).
                if box_low < -half - cell_meters * 0.5 || box_high > half + cell_meters * 0.5 {
                    block_fits = false;
                }
                let middle = (box_low + box_high) / 2.0;
                if middle.abs() > cell_meters * 0.6 {
                    block_centered = false;
                }
            }
            fits += usize::from(block_fits);
            centered += usize::from(block_centered);
            if !block_fits && outliers.len() < 12 {
                outliers.push(format!("{} size {:?} model bounds {:?}..{:?} offset {:?}", block.subtype_id, block.size, low, high, block.model_offset));
            }
        }
        println!("{checked} models: {fits} fit inside their block, {centered} are centered");
        for line in &outliers {
            println!("  outside: {line}");
        }
        // The assumption holds if the clear majority fit; a wrong pivot would fail most of them.
        assert!(fits * 100 >= checked * 90, "only {fits} of {checked} models fit: the pivot assumption may be wrong");
        assert!(centered * 100 >= checked * 90, "only {centered} of {checked} models are centered");
    }

    /// Reads every block model in the game and compares with the game's own `ModelInfo`.
    #[test]
    fn every_block_model_matches_its_own_model_info() {
        let install = se1::find_install().expect("not found");
        let catalog = se1::load_catalog(&install).expect("catalog failed");

        let mut models: Vec<String> = catalog.blocks.iter().filter_map(|block| block.model.clone()).collect();
        models.sort();
        models.dedup();

        let mut checked = 0;
        let mut count_mismatches = Vec::new();
        let mut failures = Vec::new();
        for model in &models {
            match load_model(&install, model, 0) {
                Ok(mesh) => {
                    // Compare with the geometry file's own claim.
                    let base_path = se1::resolve_content_file(&install, model, "mwm").unwrap();
                    let base = MwmFile::parse(fs::read(base_path).unwrap()).unwrap();
                    let files = geometry_files(&install, &base, model).unwrap();
                    let geometry_path = se1::resolve_content_file(&install, &files[0], "mwm").unwrap();
                    let geometry = MwmFile::parse(fs::read(geometry_path).unwrap()).unwrap();
                    if let Ok(Some((triangles, vertices))) = read_model_info(&geometry)
                        && (triangles != mesh.indices.len() / 3 || vertices != mesh.vertex_count())
                    {
                        count_mismatches.push(format!(
                            "{model}: file says {triangles} tri / {vertices} vert, read {} / {}",
                            mesh.indices.len() / 3,
                            mesh.vertex_count()
                        ));
                    }
                    checked += 1;
                }
                Err(error) => failures.push(format!("{model}: {error}")),
            }
        }
        println!("{} models: {checked} read, {} failed, {} count mismatches", models.len(), failures.len(), count_mismatches.len());
        for line in failures.iter().take(20) {
            println!("  FAILED {line}");
        }
        for line in count_mismatches.iter().take(20) {
            println!("  MISMATCH {line}");
        }
        // A few debug and unusual props may not load; real blocks must.
        assert!(failures.len() * 100 <= models.len(), "more than 1% of block models failed to load");
        assert!(count_mismatches.is_empty(), "the reader disagrees with the game's own counts");
    }
}

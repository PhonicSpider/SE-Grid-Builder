# Walkthrough: `src-tauri/src/mwm.rs`

Reads the game's `.mwm` model files and hands the triangles to the viewer. The format itself is described in [[MWM Model Format]]; Rust ideas in [[Rust Concepts]].

## The pieces, top to bottom

### `ByteReader`: safe reading
A position inside a byte slice with `read_u8`, `read_i32`, `read_f32`, `read_string` and so on. **Every read checks it stays inside the file and returns `Err` otherwise.** A damaged or unexpected file therefore gives an error message, never a crash. `read_count(limit)` also rejects counts that are negative or silly big, which catches most cases of "reading from the wrong place".

New Rust ideas: **lifetimes** (`ByteReader<'a>` borrows the bytes it reads; the `'a` says how long), `usize::try_from(...)` for safe number conversion, and `.filter(..).ok_or_else(..)` to turn "not good enough" into an error.

### `half_to_f32`
Converts a 16-bit "half" float to a normal 32-bit float by hand (sign, 5-bit exponent, 10-bit fraction). A test checks 1.0, -1.0, 1.25, 2.0, NaN and infinity.

### `MwmFile`
Holds the whole file in memory plus the tag index (`HashMap<String, usize>`, tag name to byte offset). `tag("Vertices")` returns a reader placed on that tag's data, after checking the stored name matches (a mismatch means the index is lying). `parse` borrows the bytes while reading the index, then **moves** them into the result without copying (a leftover `clone()` was removed in the audit).

### `read_geometry`
Reads `Vertices` (positions times the per-vertex scale, and rejects any that are not finite numbers) and `MeshParts` (indices, material, textures, parameters, technique, glass tail, and the "no material" flag). **Every index is checked to point at a real vertex.**

### `geometry_files` and `load_model`
- `geometry_files` works out which files hold geometry, best detail first: the base file itself, or the `GeometryDataAsset` file, followed by the `LODs` list. `read_lod_models` (split out in the audit) reads that list and stops quietly at anything odd.
- `load_model(install, "Models\\...\\Foo.mwm", detail)` resolves the path with `se1::resolve_content_file` (see below), reads the base file, picks the file for the requested detail (more than exists gives the simplest), and parses it.

### `ModelMesh::encode_for_viewer`
Packs the mesh into a flat byte layout (documented in the code) that TypeScript reads with no copying. The header is 40 bytes so the position array is 4-byte aligned, which the browser needs for a `Float32Array` view.

## Safety
`resolve_content_file` (in `se1.rs`, generalized from the icon checker) is the only way a path from the front-end becomes a file. It insists on the right extension, plain folder names only (no `..`, no drive letters), and a final location inside `Content`. Tests feed it `..\Bin64\Havok.dll` and similar and expect refusals.

## The tests (11 in this file)
| Test | What it proves |
|---|---|
| `half_floats_decode_correctly` | the number conversion |
| `strings_use_seven_bit_lengths` | the string format, including 2-byte lengths |
| `rejects_files_that_are_not_models` | garbage in gives an error |
| `loads_the_heavy_square_plate_exactly` | a hand-checked model: 9 vertices, 24 indices, one material, flat at y = 1.25 |
| `simpler_detail_levels_never_have_more_triangles` | LOD choice; asking for too much detail is fine |
| `rejects_paths_outside_the_game` | path safety |
| `damaged_files_return_errors_and_never_panic` | cut the file at many points and damage single bytes: each result is an error or exactly the original mesh |
| `encoded_layout_is_aligned_and_complete` | the packed layout |
| `every_block_model_matches_its_own_model_info` | for all block models, our triangle and vertex counts equal the file's own `ModelInfo` (**0 mismatches**) |
| `vertex_bounds_match_each_files_stored_bounding_box` | for all block models, our vertex box equals the file's stored `BoundingBox` (**0 disagreements**) |
| `models_sit_inside_their_blocks_around_the_center` | the placement rule across 1,426 models |

Two more are **on-demand tools**, not tests (`#[ignore]`): `export_viewer_fixtures` (see [[Commands]]) and the blueprint sample writer.

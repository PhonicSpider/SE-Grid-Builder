# MWM Model Format (`.mwm`)

Space Engineers 1 stores 3D models as `.mwm` files. **The format is not publicly documented.** Keen's published source on GitHub does not contain the importer (a research agent looked), and a decompiler was not installed. Everything here was **worked out from the files themselves** and then checked against the game's own data. See [[Walkthrough - mwm.rs]] for the reader.

## How big a job it was
- 24,148 `.mwm` files in the install; 1,371 distinct models are used by blocks.
- **Result: 1,369 of 1,371 block models read correctly.** The two that do not (`Monolith`, `Stereolith`, environment props) use another layout and fall back to a box.

## The file layout
All numbers are little-endian. A "string" is a length (7 bits per byte, low bits first, top bit means "more bytes follow") then UTF-8 text, exactly like C#'s `BinaryWriter`.

```
string "Debug"
int    count, then that many strings        (holds "Version:01157002")
int    number of tags
repeat: string tagName, int byteOffset      <- the INDEX
...then each tag's data at its offset, stored as: string tagName, data
```
So a file is an index of named sections, each stored as its own name followed by its data.

### The tags we use
| Tag | Data |
|---|---|
| `Vertices` | `int count`, then per vertex **4 half-precision numbers**: x, y, z and a scale. **Position = (x, y, z) times the scale.** |
| `TexCoords0` | `int count` (equals the vertex count), then per vertex **2 half-precision numbers**: u, v. Origin at the texture's top-left, as in the DDS files. Verified: every one of the 1,426 textured block models has a matching count and non-zero coordinates. A few models tile their texture (numbers above 64). |
| `MeshParts` | `int count`, then per part (below) |
| `GeometryDataAsset` | string: the model file that holds the geometry (in the small "base" file) |
| `LODs` | `int count`, then per level: `f32 distance`, string model path, string construction-model path |
| `ModelInfo` | `int triangles`, `int vertices`, then a size (used only to check our reader) |
| `BoundingBox` | six `f32`: minimum x, y, z, maximum x, y, z (used only to check our reader) |

Other tags exist and are **not read**: `Normals`, `Binormals`, `Tangents`, `Dummies`, `Sections`, `Bones`, `HavokCollisionGeometry`, `ModelBvh` and others.

### A mesh part
```
int    material hash            (not used)
int    index count              (always a multiple of 3)
int    x index count            triangle corners, as vertex numbers
byte   hasMaterial              1 = material data follows, 0 = none
if hasMaterial:
  string material name          e.g. "PaintedMetal_Colorable"
  int    texture count;  per texture: string kind, string path   ("ColorMetalTexture", ...)
  int    parameter count; per parameter: string name, string value
  string technique              "MESH", "GLASS", "DECAL_CUTOUT", "ALPHA_MASKED", "HOLO", "FOLIAGE", ...
  if technique == "GLASS":  string, string, byte   (two more material names and a flag)
```
**Triangles are clockwise seen from outside** (checked on a plate and on 120 other models), so a viewer using the usual counter-clockwise rule swaps two corners of each triangle. `SwapWindingOrder` is 0 in every sampled file.

### The two-file arrangement
Most models are a **base file** plus separate geometry files:
- `Foo.mwm` (about 1 KB): bookkeeping only. Its `GeometryDataAsset` names `Foo_LOD0.mwm`, and `LODs` lists `Foo_LOD1`, `Foo_LOD2`, ...
- `Foo_LOD0.mwm`: the full-detail geometry. Higher LOD numbers are simpler (a corner plate went 4 triangles, then 1).
- 82 block models hold geometry directly in the base file.

## How each finding was reached (and checked)
1. **Header and index**: read the bytes; offsets line up exactly with the tag names.
2. **Vertex layout**: `Vertices` was 8 bytes per vertex; the plate's 9 vertices matched its `ModelInfo` (9 vertices, 8 triangles) and sat on the 2.5 m cube face.
3. **Index and part layout**: parse 3,000 random models; fix each failure class: material parameters, glass tails, and the "no material" flag. Final result on block models: 0 count mismatches against `ModelInfo`.
4. **The scale value (the biggest bug).** At first the fourth number was ignored. Small plates looked right, but the reactor looked like a spiky star. The fourth number is 1, 2 or 3, and the **real position is x, y, z multiplied by it** (the file keeps small numbers for precision). Proof: with the multiplication the vertex extents were -3.750 to 3.750, the file's own `BoundingBox` says -3.751 to 3.751. After the fix **all 1,369 models match their stored bounding box** (a Rust test), and the reactor matches the game's icon.

## Placement in the world
- The model's origin is the **middle of the block's cells**, in the block's own axes, in meters, shifted by the definition's `ModelOffset`. Checked on 1,426 models: 96.6 percent fit inside their block's size and are centered there; the rest are items that overhang (wheels, suspensions, antennas).
- The scene counts in cells, so meters are scaled by 1/2.5 (large grid) or 1/0.5 (small grid).
- **Orientation check against the game's own saved ship** (`Miner`): all 40 real placements, spread over 15 different orientations and 27 non-cube blocks, keep the rotated model inside the block's footprint. A wrong orientation convention would not.

## Not understood yet
- **Packed normals** (4 bytes per vertex). Many models use deliberately "bent" normals, which made fitting unreliable. The viewer works out normals from the triangles instead.
- **Texture coordinates** look like two half-precision numbers per vertex (not needed until textures are drawn).
- **`Dummies`** is now read for `subpart_*` entries (see [[Armor Shapes and Sub-parts]]). Still unused: detector and port dummies (conveyor ports, terminals).
- **`Sections`**, **`Bones`**, and the two prop models that fail.
- **Armor "cube sides"**: solved, see [[Armor Shapes and Sub-parts]].

## Left out on purpose
Parts with technique `DECAL`, `DECAL_CUTOUT` or `HOLO` are stickers and light effects. Drawn solid and without textures they show up as slabs, so the viewer skips them.

## Licensing note
The app reads these files from the player's own install at run time and never copies or ships them. See [[Workshop and Licensing]]; asking Keen is still recommended before a public release, especially now that real models are drawn.

# Learning Exercises

You wanted to write Rust yourself. Steps 1 and 2 of `se1.rs` are yours; the rest was written for you while you rested. These exercises let you take the code back over, smallest first. Each has a way to check your work.

Read [[Rust Concepts]] and [[Walkthrough - se1.rs]] first.

## Level 1: small and safe
1. **Add `Mass` to the catalog.** Definitions do not carry mass directly (components do), so first add a simpler field: `BuildTimeSeconds`. Add `build_time_seconds: Option<f64>` to `RawBlock` and `BlockInfo`. Check: a test that the large light armor block has a value.
2. **Count blocks per category.** Write `fn count_by_category(blocks: &[BlockInfo]) -> HashMap<String, usize>`. Practice with `HashMap`, loops and `entry().or_insert()`. Check: write a test; armor should be among the biggest.
3. **Find the largest block.** Use `.iter().max_by_key(...)` on volume (`size[0]*size[1]*size[2]`). Check: print it with `--nocapture`.

## Level 2: real features
4. **Find Steam libraries properly.** Replace the three hard-coded paths in `find_install` by reading `C:\Program Files (x86)\Steam\steamapps\libraryfolders.vdf` and trying every `"path"` line. Keep the hard-coded list as a fallback. Check: the existing `finds_install` test must still pass.
5. **Show DLC.** Many definitions list `<DLC>` elements. Add `dlcs: Vec<String>` to the output and show a small label in the menu (this touches `se1.rs`, `catalog.ts` and `ui.ts`).
6. **Read `BlockVariantGroups.sbc`.** Parse the groups so slopes and corners can be cycled. This is new serde structs plus a second file, the same pattern as `load_display_names`.

## Level 3: bigger
7. **Import a blueprint.** *(Done for you on 2026-11-18, see [[Blueprint Import]]; read `blueprint_import.rs` as a worked example of the `Raw*` serde pattern.)* A new version of the exercise: add reading the second and later grids, or make the import list your local blueprints instead of asking for a file.
8. **Write `se2.rs`.** After the investigation in [[SE2 Notes]].

## Habits to practice
- Run `cargo test` after every small change.
- When the compiler errors, read the **first** one, then the `help:` lines.
- Prefer `Option` and `Result` handling over `.unwrap()` in real code (tests may use `.expect()` for clear failure messages).

## Rust things to try on purpose
- Remove a `mut` and read the error.
- Use a `String` after moving it into a function and read the error.
- Delete a semicolon at the end of a function and read the error.

## New exercises from the model reader
9. **Read the `Dummies` tag.** It lists named points with matrices (where sub-parts attach). Add it to `mwm.rs` and print the names for a door and a turret. Check: the names should look like `subpart_...` or `detector_...`.
10. **Count triangles per material.** From `ModelMesh::parts`, print how many triangles each material has for the reactor. Practice with iterators and `HashMap`.
11. **Make the damaged-file test meaner.** In `damaged_files_return_errors_and_never_panic`, try changing two bytes at once, or inserting bytes. Does anything panic? (If so, that is a real bug to fix.)
12. **Add a second `ByteReader` method**, `read_vector3`, that reads three `f32` values, and use it to read `BoundingBox` in the tests instead of three separate calls.

## New exercises from armor and sub-parts
13. **Print a topology's turns.** Write a test that prints `rotations_for("LargeBlockArmorSlope", "Slope", 5)` and, for each plate, which face of the cell it ends up on (apply the matrix to the plate's centre).
14. **Fix the interior wall.** `LargeBlockInteriorWall` is six thin walls. Work out which plate goes on which face (hint: the top and bottom plates have their own models) and add it to the table.
15. **Draw a sub-part in a different pose.** In `placement_of_dummy`, rotate a turret's barrel by 30 degrees about x before it is merged. What would a proper animation need instead of merging into one mesh?

# Coding Conventions

## Naming: whole words
Variables, parameters, functions and fields are whole words, not single letters or abbreviations.
- Good: `entry`, `placementCell`, `|error| ...`, `saturation_offset`, `blockCount`.
- Avoid: `e`, `p`, `b`, `idx`, `tmp`, `cfg`.

**One deliberate exception:** `x`, `y` and `z` are used for the three grid axes, because they are the game's own names (the XML attributes are literally `x`, `y`, `z`) and the standard names in 3D. Where practical the code still uses `width`, `height`, `depth` or `xOffset` for derived values.

## Case
- Rust: `snake_case` for functions and variables, `CamelCase` for types, `SCREAMING_CASE` for constants.
- TypeScript: `camelCase` for functions and variables, `PascalCase` for classes and types, `SCREAMING_CASE` for constants.
- **Exception:** the TypeScript interfaces that mirror Rust structs (`BlockInfo`, `Se1Catalog`) keep `snake_case` field names so they match the JSON exactly.

## Comments
- Every file starts with a comment explaining its job.
- Explain **why**, and explain Rust-specific ideas where they first appear (the code is also a learning project).
- Mark unverified assumptions with `TODO(verify in game)` so they can be searched.

## Structure
- One job per file (see [[Architecture]]).
- Data and rules (`ship.ts`, `blueprint.rs`) never draw anything; drawing code (`viewport.ts`) never decides rules.
- Rust reads and writes files; TypeScript never touches the disk directly.

## Safety rules
- Never write into the player's blueprint folder without checking the name is free (or the player pressed Replace).
- Tests that write files use a temp folder, never the real blueprint folder.
- Never copy game assets into the project.

## Process used
Small slices, each tested before the next: catalog parser, blueprint writer, then front-end modules, with automated tests where logic could be wrong, and a click-through of the browser version.

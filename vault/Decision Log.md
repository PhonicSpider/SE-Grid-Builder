# Decision Log

| Decision | Why | Alternatives |
|---|---|---|
| **Desktop app, not a web app** | Needs to read the player's installed game files and write straight into the blueprint folder. Hosting the game's models on a website risks redistributing Keen's assets. | Web app (browser cannot read the Steam folder without a clumsy folder picker). |
| **Tauri (Rust + web UI)** | Small installer, low memory, and it is a good place to learn Rust: the Rust side is small and concrete. The 3D editor stays in familiar web tech. | Electron (all JavaScript, heavier). Godot or Avalonia with C# (you know C#; would be faster to ship, but you chose to learn Rust). Lua frameworks (weak 3D, sandboxed file access). |
| **Rust for game files, TypeScript for editor** | Rust is strong at file parsing and checking data shapes. TypeScript has Three.js. | Everything in TypeScript. |
| **Read game data at run time, never bundle it** | Avoids redistributing Keen's assets and stays current when the game updates. | Ship a pre-extracted block list. |
| **Plain boxes first, real models later** | Export only needs block ids, positions, orientation and color, so the exporter does not depend on models. Models are the hardest part. | Start with model parsing. |
| **SE1 first, SE2 second** | SE1's format is plain XML with real samples on disk. SE2 has no sample blueprint yet. | Both together. |
| **Keep `GuiVisible=false` blocks** | The game hides armor slopes and corners from its menu but they are essential. | Hide them (cut the block list in half and lose all armor shapes). |
| **Use the game's own categories** (`BlockCategories.sbc`) | Players already know that menu, and it is the game's own data, so it stays right after updates. Only ship-block categories are kept (function tabs and DLC packs). A block can be in several. | Group by definition file name (what the first version did; it did not match the game). |
| **Decode icons in Rust, load on demand** | Browsers cannot show `.dds`. Decoding in Rust keeps the game's files untouched and out of the app, and loading only visible tiles keeps a 1,000-block list fast. | Pre-convert all icons to a cache folder; ship converted icons (redistributes Keen's art). |
| **CSS grid for the block tiles** | `auto-fill` reflows on resize with no code. | A virtual-scroll list library (not needed at this size). |
| **Resizer is a plain draggable bar** | Small, keyboard accessible, no library. | A split-pane package. |
| **Toolbar icons drawn by us** | Simple, themeable with `currentColor`, no copied artwork. | The game's own UI icons. |
| **One shared tooltip box** | CSS tooltips inside the side panel were clipped and slid behind the 3D view. A single box drawn above everything and positioned in code stays on screen. | Per-element CSS tooltips; the browser's `title` (slow, unstyled). |
| **Ctrl + drag works on one flat layer** | Matches how people build floors and walls, and it is predictable: the layer is fixed when the drag starts. | Free 3D box selection. |
| **Group edits into one undo step** | A 400-block floor must undo with one Ctrl+Z, not 400. | Undo per block. |
| **Skins exported, not drawn** | The editor draws plain boxes; skins only matter in the file. | Texture the boxes (needs the model and texture pipeline). |
| **Reverse-engineer `.mwm` from the files, not by decompiling** | Keen's published source has no importer, and installing a decompiler was refused. Reading the bytes and checking every guess against the game's own data (`ModelInfo`, `BoundingBox`, icons) worked and is documented. | Decompile the game's DLL; use the game's DLL at run time (ties the app to Windows and the game's code). |
| **Model origin = center of the block's cells** | Checked on all 1,426 block models and on a real game-made ship. | Corner origin. |
| **Simple boxes for picking, real models for drawing** | Fast clicks and exact faces regardless of model complexity. | Pick against the real triangles. |
| **Skip sticker/decal parts** | They need textures and special shading to look right. | Draw them solid (looked like slabs). |
| ~~Armor stays boxes for now~~ | Replaced below. | |
| **Armor shapes: derive the plate turns from the files and store a table** | The game's rules are in its code, which we do not read. A closed-solid search plus the game's own construction models and mount points pinned them down, and a test re-checks every block against the install. | Hand-tune each shape; read the game's code. |
| **Sub-parts merged into one mesh, rest pose** | Keeps one draw call and the same packet format; animation can come later. | A tree of moving objects. |
| **Export refuses to overwrite** | A player's existing ship must never be destroyed by a typo. Replace needs an explicit button. | Silent overwrite. |
| **Tests write to a temp folder** | Never risk the real blueprint folder. | Test against the real folder. |
| **XML built as text, not a serializer** | Output stays readable beside a real blueprint. Escaping is handled by one small function. | `quick-xml` serialize with structs. Worth revisiting if the format grows. |
| **No UI framework** | The panel is small. Plain TypeScript keeps the learning surface small. | React, Svelte. |
| **`x`/`y`/`z` kept as axis names** | They are the game's own names. See [[Coding Conventions]]. | `xAxis`, ... |

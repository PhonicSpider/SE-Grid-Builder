# Textures

How the viewer shows the game's own surface detail instead of plain grey. Code: `load_texture_png` in `src-tauri/src/se1.rs`, command `load_block_texture` in `lib.rs`, `src/textureLoader.ts`, `paintTint` and `solidMaterial` in `src/blockMeshes.ts`. Related: [[MWM Model Format]], [[Armor Shapes and Sub-parts]], [[Roadmap and Open Questions]].

## Pipeline
1. **Which texture.** Each mesh part of a model names its `ColorMetalTexture` (`color_texture`). Models carry texture coordinates (`TexCoords0`, see [[MWM Model Format]]), sent after the positions in the model packet.
2. **Decoding.** Textures are `.dds` files, almost all BC7 (1,515 of 1,637 colour textures), the rest DXT5. The `image_dds` crate decodes them (it already decodes block icons). Files are 2048 or 4096 pixels wide, so Rust decodes a smaller **mipmap** (stored smaller copy) no wider than 512 and sends a PNG. That is much less work and memory, and a block on screen is small.
3. **Drawing.** The browser turns the PNG into a three.js texture, loaded once and shared. A model has one material slot per distinct texture (plus one for glass). Until a texture arrives, the block shows its plain paint color.
4. **Paint.** The material color multiplies the texture. Default grey paint gives the texture at normal brightness; other colors shift it (`paintTint`).

## Known limits
- **Paint mask not used.** The game paints only the parts of the texture that a color mask marks as paintable, and the mask is not in the `_cm` texture's alpha channel (that holds something like metalness: about 0 in `Atlas1_cm`, 255 in `Aluminium_cm`). Here the whole surface is tinted. A correct version needs the `_add` map and a small shader change.
- **No normal maps, metalness or glossiness.** Lighting uses a fixed roughness and metalness.
- **Armor skins** (Battered, Golden ...) are not drawn; the picked skin is only exported.
- **Decals** are still left out (they need special blending).
- The brightness factor (`TEXTURE_REFERENCE_BRIGHTNESS` in `blockMeshes.ts`) was chosen by eye so the default looks about as bright as the old flat grey.
- **Not seen in the desktop window.** Checked in a browser test page fed with textures and models exported by Rust (armor, refinery, reactor, containers, cockpit, assembler); the real `load_block_texture` command is covered by a Rust test but not run through the window.

## Tests
`decodes_a_block_texture_at_the_requested_size` (size picking, and refusing a path outside the game folder), `textured_models_have_texture_coordinates`, the packet layout test, and the TypeScript slot tests in `modelLoader.test.ts`.

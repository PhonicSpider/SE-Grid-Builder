# Walkthrough: the TypeScript front-end (`src/`)

TypeScript is JavaScript with types, so it should feel close to C#. The app is plain TypeScript with no UI framework: the page is `index.html`, and the code finds elements by id.

## `ship.ts`: the data (no drawing)
`Ship` holds placed blocks in two maps:
- `blocksById`: id to block.
- `blockIdByCell`: `"x,y,z"` text to block id, so "what is in this cell?" is one lookup.

A block covers several cells if it is bigger than 1x1x1. `cellsCovered` lists them using the rotated size from [[Orientation and Grid Math]]. `canPlace` requires the right grid size and all cells free.

**Undo:** every change pushes a *function that reverses it* onto `undoSteps`. `undo()` pops and runs one. Placing records "delete this"; removing records "put this exact block back"; painting records "restore the old color". The private `insert` and `delete` helpers change data without recording, so undoing never creates new undo steps.

`onChange` is a callback the menu sets so the viewport and counter refresh after any change.

## `orientation.ts`: facing
A block's facing is two names, **forward** and **up**, giving 24 combinations. Turning uses the cross product: `rotateYaw` spins forward around up (key Q), `rotatePitch` spins both around the right side (W), `rotateRoll` spins up around forward (E). (Moved from R / T / Y.) A test checks that repeated rotation reaches exactly 24 distinct valid orientations. `footprint` gives the covered cells along each world axis after rotating.

## `color.ts`
Converts between the color picker's hex (`#rrggbb`) and hue / saturation / value. Tests check a round trip. See [[Colors and Paint]].

## `catalog.ts`
Types that mirror the Rust structs, plus `loadSe1Catalog()`. Inside the desktop app it calls Rust. In a plain browser (`npm run dev`) there is no Rust, so it returns a 10-block **sample catalog** so the editor can still be tried and tested. `isDesktopApp()` checks for Tauri's marker on `window`.

## `editorState.ts`
One small object: mode (build / remove / paint), selected block, orientation, paint color. The menu writes it; the viewport reads it.

## Real models: `modelLoader.ts`, `blockPlacement.ts`, `blockMeshes.ts`
- **`modelLoader.ts`** decodes the packet from Rust (checks the header, counts and every part, and throws a clear error on damaged data), then `buildGeometry` makes three.js geometry: the game's triangles are clockwise from outside, so two corners of each triangle swap; lighting normals are computed from the triangles; one *group* per drawn part (glass goes to a see-through material). **Sticker parts (`DECAL`, `DECAL_CUTOUT`, `HOLO`) are skipped**: drawn solid and untextured they look like slabs. Models are cached by path and detail, and at most 4 load at once (`limiter.ts`).
- **`blockPlacement.ts`** (pure math, tested): a model's origin is the middle of the block's cells; the block's own axes come from its orientation (right = forward x up, up, back); meters become cells by 1/2.5 (large) or 1/0.5 (small); `ModelOffset` is applied in the block's own axes. A test proves every one of the 24 orientations is a proper rotation (determinant +1, never mirrored).
- **`blockMeshes.ts`** owns the scene objects for blocks. Per block: a **body** that is drawn (a colored box first, the real model once loaded) and a **pick box** that is never drawn. Mouse picking only tests the simple boxes, so clicks are fast and the "which face" answer is exact even for slopes and 30,000-triangle models. Materials are shared per color; the hover highlight is a translucent overlay box (changing a shared material would tint every block of that color).
- Changing the paint only swaps the body's material. Removing a block removes only its objects; shared geometry and materials stay.

## Frame-rate work in `viewport.ts`
Mouse moves are noted but handled **at most once per frame** (`requestAnimationFrame`), with one raycast shared by the hover tint and the ghost preview. A release applies its own final position first, so a very quick flick-and-release still gets its last move. Area-fill math lives in `areaTools.ts`.

## `viewport.ts`: the 3D view (Three.js)
- **Units:** one grid cell = one unit. A block at position `[x, y, z]` fills `(x, y, z)` to `(x+1, y+1, z+1)`.
- **Drawing:** each block is a box sized by `footprint`, colored from its paint, with a dark outline. `syncBlockMeshes` makes the boxes match the ship (adds, removes, recolors).
- **Picking:** a ray from the mouse hits either an existing block (then the empty cell next to the face we touched is the target) or the floor (the cell under the cursor on the floor).
- **Ghost:** a see-through box showing where the next block would go: green if allowed, red if blocked.
- **Clicks vs drags:** a click that moved more than 5 pixels counts as a camera drag and does nothing, so orbiting never places blocks.
- **Controls:** left click does the current tool; right click (no drag) removes; left drag orbits; right drag pans; wheel zooms.
- **Hover highlight:** in remove (red) and paint (grey) modes the block under the cursor lights up.

## The layout, top to bottom
1. **Game and grid size.** A game drop-down, then two icon buttons: a **solid square** (Large grid) and a **hollow square with a solid corner** (Small grid).
2. **Tools.** Icon buttons with hover tooltips (see below): hammer (Build), trash can (Remove), paint bucket (Paint); then turn, tip and roll arrows. Tooltips are CSS: any element with a `data-tooltip` attribute shows it on hover.
3. **Paint.** "Use color to repaint", a custom color box plus **the game's 14 default colors** (`defaultPalette.ts`), then "Use skin to repaint" and the **skin grid**. The swatch matching the current paint is ringed.
4. **Blocks.** Search, category drop-down, the variants checkbox, then the tile grid (it takes all the leftover height).
5. **Export.** Name, Export, Undo, Clear.

## Tooltips (`tooltip.ts`)
Any element with a `data-tooltip="text"` attribute gets a tooltip. **One** box is drawn on top of the page and moved next to the hovered element, then kept inside the window (nudged left if it would run off the right edge, flipped above if it would run off the bottom). The first version drew the tooltip inside each element with CSS; the side panel clipped it, so tooltips near the panel's right edge slid behind the 3D view. Moving the box out of the panel fixed that. It appears after a 350 ms pause and hides on any click, key or scroll.

## Skins and the two "use ... to repaint" boxes
- The skin grid sits under the paint colors. The first entry is the red X (no skin); then the game's 27 armor skins, each with its game icon. A small gold dot marks skins that need a DLC (the tooltip names the pack). Names are made from the subtype ("DigitalCamouflage_Armor" becomes "Digital Camouflage") because the game has no display names for skins.
- **New blocks get the current color and skin.** The **paint tool** changes the color only if "Use color to repaint" is ticked, and the skin only if "Use skin to repaint" is ticked, as in the game. A block's skin is exported as `<SkinSubtypeId>`.
- The 3D preview does **not** show skin textures (boxes are plain colors); skins only matter in the exported file.

## Shift / Ctrl + drag: fill and clear an area (`viewport.ts`)
- **Update 2026-11-18:** **Shift** makes a **floor** (a layer across y, wherever you click) and **Ctrl** makes a **wall** (across x or z). `dragAxisFor` in `areaTools.ts` decides the axis. Everything below about Ctrl applies to both.
- **Hold Ctrl and drag the left button** to fill a flat area with the selected block; with the Remove or Paint tool selected it clears or repaints the area instead. **Ctrl + right button** always clears. Everything is **one block deep**.
- **Which layer?** The layer is fixed when the drag starts. Placing: the layer just outside the face you pressed on (the floor counts as the top face, so a floor fill lies on the ground). Clearing or painting: the layer of the block you pressed on. Click the top of a floor to work on that floor; click the side of a wall to work on that wall.
- **During the drag** a translucent box shows the rectangle: green (blocks will be placed), red (blocks will be removed, or nothing fits), blue (repaint). Nothing changes until you let go.
- **How the rectangle is found:** the mouse ray is intersected with an invisible flat plane through the middle of the chosen layer (`THREE.Plane`); the cell it hits is the current corner, and the anchor cell is the other corner.
- **Big blocks tile edge to edge.** A 3x3x3 reactor steps three cells at a time; at least one block is always tried.
- **One undo step:** `Ship.runAsOneStep` collects every change into a single undo and refreshes the screen once. Ctrl+Z removes the whole floor.
- **Escape** cancels a drag in progress and changes nothing (and does not deselect the block).
- **Why the camera does not move:** the camera controls would treat Ctrl + drag as panning. A listener with `capture: true` on the container runs before the controls see the click and switches them off for the length of the drag.
- A message such as "Placed 20 blocks (3 did not fit)" shows at the top left for a few seconds.

## `sidebar.ts`: resizing
Drag the thin bar between the panel and the 3D view, or focus it and press the arrow keys; double-click or Home resets. The width is stored in CSS as `--panel-width`, kept between 260 px and 70% of the window, and remembered in `localStorage` (wrapped in try/catch because storage can be unavailable). Pointer capture keeps a drag working when the cursor leaves the bar. The 3D view already resizes itself, so nothing else is needed.

## `blockGrid.ts` and `blockIcons.ts`: the picture grid
- The grid is plain CSS: `grid-template-columns: repeat(auto-fill, minmax(92px, 1fr))`. The browser fits as many columns as the width allows, so it **reflows by itself** when the panel is resized.
- Each tile is a button: picture behind, name on a dark fade at the bottom (or centered while no picture has loaded).
- An `IntersectionObserver` starts an icon load only when a tile is near the visible area, so opening a 1,000-block list does not decode 1,000 images.
- `blockIcons.ts` allows 6 decodes at once, caches by path (several blocks share an icon) and falls back to a name-only tile on any failure.
- In a plain browser there are no game files, so tiles show names only; the real pictures appear only in the desktop app.
- Hover on a tile uses the browser's own `title` tooltip, because tiles hide anything outside them (a CSS tooltip would be clipped).

## `icons.ts`
Our own hand-drawn SVGs, not game artwork. They are parsed with `DOMParser` (not assigned to `innerHTML`) and need the `xmlns` line; without it the browser does not recognize the picture. That bug showed up as blank buttons.

## `ui.ts`: the side panel
- The category drop-down shows **the game's own categories in the game's order**, in two groups ("Categories" and "DLC packs"), each with a count for the current grid size. A last entry, "Not in the game's menu", holds the few blocks the game lists nowhere. Empty categories are hidden.
- Filters the catalog by grid size, category, search text and the "include shape variants" box. Inside a chosen category, blocks follow the game's list order.
- **Grid size can only change while the ship is empty** (a ship is all Large or all Small).
- Keyboard: `1` `2` `3` modes, `Q` `W` `E` rotate, `Ctrl+Z` undo, `Esc` deselect. Ignored while typing in a box.
- Export asks for blocks and a name, then calls `exporter.ts`. If the name is taken it shows a **Replace** button; nothing is overwritten without that press.

## `exporter.ts`
Builds the JSON and calls the Rust command. Its field names must match `blueprint.rs`; a Rust test guards this. In a browser it returns a friendly "export only works in the desktop app".

## Tests (`npm test`, 13)
Orientation (24 orientations, no bad axes, four turns return home, footprint math), ship (overlap, grid size, undo order, freeing multi-cell blocks, grid-size lock), color (round trip).

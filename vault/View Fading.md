# View Fading

Fade a group of blocks so the machinery inside shows through, without deleting anything. Code: `src/viewGroups.ts` (plain logic, tested), `src/blockMeshes.ts` (materials), `src/viewport.ts` and `src/ui.ts` (slider). Related: [[Architecture]], [[Roadmap and Open Questions]].

## Where it lives
The controls are in the **view bar** across the top edge of the 3D view (`#view-bar` in `index.html`, inside `#viewport-top`), so they are always visible. The sidebar is for picking blocks, color and skin. Planned for the same bar: the connection overlay toggle and layer hiding (see [[Roadmap and Open Questions]]). The bar wraps to a second line in a narrow window. Mouse events on the bar are not treated as clicks on the ship (`beginAreaDrag` ignores any pointer-down not on the canvas).

## How it works
- **Groups.** `viewGroupOf` puts a block in the "armor" group (slider label **Armor / structure**) if it is built from side plates (has a cube topology), is listed in a category whose key contains "armor", **or has the plain `CubeBlock` type**, which the game gives to every block with no function: grid beams, windows, trusses, catwalks, stairs, floors, symbols, signs, decoration. Blocks with their own type (conveyors, doors, turrets, thrusters ...) are "other". (Changed 2026-11-18: beam blocks did not fade when only armor counted.) `VIEW_GROUPS` lists the groups that get a slider; today only armor. A new group needs one line there, and a rule in `viewGroupOf`.
- **Materials.** One material per (group, color). Fading a group changes `opacity`, `transparent` and `depthWrite` on that group's materials only, so the cost does not grow with the number of blocks. A block painted or placed while the group is faded starts faded.
- **Depth.** Faded materials do not write depth, so solid parts behind them always show. Three.js draws transparent objects after solid ones.
- **Zero.** At 0% the blocks are not drawn at all (`body.visible = false`) and are skipped by picking.
- **Picking.** Picking uses separate invisible boxes. "Click through faded blocks" (off by default) skips a faded group's boxes, so clicks reach the machinery behind. It is off by default because with it on you cannot build onto faded armor.

## Tests and checks
`viewGroups.test.ts` covers grouping and the opacity rules. Checked by eye in the browser preview: 30% shows a faint block, 0% shows none.

## Not done / not measured
- Not tried on a large ship; transparent blocks cannot be batched, so many thousands could be slow (see [[Roadmap and Open Questions]], "Faster big ships").
- Two faded blocks overlapping can sort wrongly (no depth writes).
- The faded plates of one slope can show faint seam lines.
- The slider is not saved between runs.

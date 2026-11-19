# Orientation and Grid Math

## The grid
Space is cut into cells. Large-grid ships use 2.5 m cells, small-grid ships 0.5 m cells; the editor treats both as one unit per cell (only the numbers matter for export).

Axes (the game's convention, used everywhere in this app):
| Direction | Vector |
|---|---|
| Forward | (0, 0, -1) |
| Backward | (0, 0, 1) |
| Left | (-1, 0, 0) |
| Right | (1, 0, 0) |
| Up | (0, 1, 0) |
| Down | (0, -1, 0) |

x, y and z are the game's own axis names (they are the XML attribute names), so they are used as-is even though the rest of the code uses whole words.

## Position and `Min`
A block's `position` is the **lowest corner cell it covers**, which is exactly the game's `Min`. A 1x1x2 block at `Min = (0,0,0)` covers cells `(0,0,0)` and `(0,0,1)` when facing the default way.

## Orientation = two directions
`forward` (where the front points) and `up` (where the top points). They must lie on different axes. That gives 6 x 4 = **24** valid orientations (a test confirms exactly 24 are reachable).

`right = forward x up` (cross product). A block's own x axis runs along `right`, its y along `up`, its z along `backward`.

## Footprint after rotating
Block size `[sx, sy, sz]` is in block-local axes. Cells covered along each world axis:
```
extent[axis] = | sx*right[axis] + sy*up[axis] + sz*backward[axis] |
```
Example: size `[2,3,4]` facing default gives `[2,3,4]`; after a quarter turn (yaw) it gives `[4,3,2]`. The cell count never changes (a test checks this for all 24 orientations).

## Verified against the game (2026-11-18)
`SSB Test Ship_2` has blocks placed by hand in many directions (Up/Backward, Down/Forward, Backward/Up, Right/Down, Left/Up, ...). Using block sizes from the game's definitions and the footprint formula above, all 26 blocks of the main grid fit together with **zero overlaps**. The strongest case: two 2x4x2 refineries facing Up/Backward were saved at z = 3 and z = 7, and the formula gives each a depth of exactly 4 cells, so they sit end to end.

What this proves: the **cell counts and positions** are right in every orientation tested, the orientation names and the "forward and up on different axes" rule are accepted, and `Min` is the lowest covered cell. What it cannot prove: which way the *model* faces (visible only in game). The thumbnail of that save looks right.

These data points are now permanent tests in `orientation.test.ts`.

## Rotation keys
| Key | Operation | Formula |
|---|---|---|
| R | Turn (yaw) | `forward' = up x forward` |
| T | Tip (pitch) | `right = forward x up`; `forward' = right x forward`; `up' = right x up` |
| Y | Roll | `up' = forward x up` |

## How placing picks a cell
The cell under the cursor becomes the block's `Min`. Clicking on a face of an existing block picks the empty cell on the far side of that face. For multi-cell blocks the new block extends in the **positive** direction from that cell; if that overlaps something the ghost turns red and the click does nothing.

## Known simplification
In the real game the block's *model pivot* decides where the model sits inside its cells. The editor draws a plain box filling the covered cells, so for blocks whose real model is smaller, the preview is only an approximation. The exported data (`Min`, orientation) is what matters.

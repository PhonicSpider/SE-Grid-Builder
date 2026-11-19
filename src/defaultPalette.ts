// The game's 14 default paint colors (the slots a new player starts with).
//
// Source: `AllPlayersColors` in the game's own starting scenarios, for example
//   Content\Scenarios\Never Surrender\Worlds\Mission01\Sandbox.sbc
// Every scenario uses this same list. The values are in the game's "offset"
// form (hue, saturation offset, value offset), exactly as written in a
// blueprint's ColorMaskHSV, so slot 9 below, (0, 0.15, 0.25), is the red
// #B20909 seen in the game's color picker.

import { paintFromGameOffsets } from "./color";
import type { PaintColor } from "./color";

/** [hue, saturation offset, value offset] for each of the game's default slots. */
const DEFAULT_SLOT_OFFSETS: Array<[number, number, number]> = [
  [0, -1, 0],
  [0, 0, 0.05],
  [0.333333343, -0.48, -0.25],
  [0.575, 0, 0],
  [0.122222222, -0.1, 0.26],
  [0, -0.95, 0.4],
  [0, -0.96, -0.5],
  [0, -0.85, 0.2],
  [0, 0.15, 0.25],
  [0.333333343, -0.33, -0.05],
  [0.575, 0.15, 0.2],
  [0.122222222, 0.05, 0.46],
  [0, -0.8, 0.6],
  [0, -0.81, -0.3],
];

/** The default palette as ordinary hue / saturation / value colors. */
export const DEFAULT_PALETTE: PaintColor[] = DEFAULT_SLOT_OFFSETS.map(([hue, saturation, value]) =>
  paintFromGameOffsets(hue, saturation, value),
);

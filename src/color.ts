// Paint colors.
//
// People think of paint as hue / saturation / value (each 0 to 1). The game
// stores it slightly differently (as offsets); the Rust side converts. Here we
// only convert between the browser's hex colors (#rrggbb) and hue/saturation/value.

export interface PaintColor {
  hue: number; // 0 to 1
  saturation: number; // 0 to 1
  value: number; // 0 to 1 (brightness)
}

// The game's default grey: stored as (0, -0.8, 0), which is saturation 0, value 0.45.
export const DEFAULT_PAINT: PaintColor = { hue: 0, saturation: 0, value: 0.45 };

/** "#rrggbb" to hue / saturation / value. */
export function hexToPaint(hex: string): PaintColor {
  const red = parseInt(hex.slice(1, 3), 16) / 255;
  const green = parseInt(hex.slice(3, 5), 16) / 255;
  const blue = parseInt(hex.slice(5, 7), 16) / 255;

  const highest = Math.max(red, green, blue);
  const lowest = Math.min(red, green, blue);
  const range = highest - lowest;

  let hue = 0;
  if (range > 0) {
    if (highest === red) hue = ((green - blue) / range) % 6;
    else if (highest === green) hue = (blue - red) / range + 2;
    else hue = (red - green) / range + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  const saturation = highest === 0 ? 0 : range / highest;
  return { hue, saturation, value: highest };
}

/** Hue / saturation / value to "#rrggbb". */
export function paintToHex(paint: PaintColor): string {
  const { hue, saturation, value } = paint;
  const sector = Math.floor(hue * 6) % 6;
  const fraction = hue * 6 - Math.floor(hue * 6);
  const low = value * (1 - saturation);
  const falling = value * (1 - fraction * saturation);
  const rising = value * (1 - (1 - fraction) * saturation);

  const channels: [number, number, number][] = [
    [value, rising, low],
    [falling, value, low],
    [low, value, rising],
    [low, falling, value],
    [rising, low, value],
    [value, low, falling],
  ];
  const [red, green, blue] = channels[sector];
  const toHexPair = (channel: number) => Math.round(channel * 255).toString(16).padStart(2, "0");
  return `#${toHexPair(red)}${toHexPair(green)}${toHexPair(blue)}`;
}

// The game stores paint as offsets from these two numbers (see the vault note
// "Colors and Paint"). The same constants live in src-tauri/src/blueprint.rs.
const GAME_SATURATION_OFFSET = 0.8;
const GAME_VALUE_OFFSET = 0.45;

/**
 * Converts the game's stored offsets (hue, saturation offset, value offset)
 * into plain hue / saturation / value. Some of the game's own palette entries
 * fall slightly outside 0 to 1, so the result is clamped.
 */
export function paintFromGameOffsets(hue: number, saturationOffset: number, valueOffset: number): PaintColor {
  const clamp = (number: number) => Math.min(1, Math.max(0, number));
  return {
    hue: clamp(hue),
    saturation: clamp(saturationOffset + GAME_SATURATION_OFFSET),
    value: clamp(valueOffset + GAME_VALUE_OFFSET),
  };
}

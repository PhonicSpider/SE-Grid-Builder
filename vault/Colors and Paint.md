# Colors and Paint

## What the player sees
A normal color picker. The app stores paint as **hue, saturation, value** (each 0 to 1) per block.

## What the game stores
`<ColorMaskHSV x="..." y="..." z="..." />` holds **offsets**, not the plain values:
- `x` = hue, 0 to 1 (same as plain).
- `y` = saturation minus **0.8**.
- `z` = value minus **0.45**.

The value offset was first guessed as 0.55 and was **wrong**; it was corrected from the game's own save (below).

## Evidence
| Source | Stored `(x, y, z)` | Meaning |
|---|---|---|
| Real blueprints, most common | `(0, -0.8, 0)` | the default grey: saturation 0, **value 0.45** |
| Real blueprints | `(0, -0.8, 0.55)` | white: value 1.0 |
| Real blueprints | `(0.0639, 0.06, 0.55)` | a tan or orange: saturation 0.86, value 1.0 |
| Real blueprints | `(0.336, 0.2, -0.33)` | a dark green: saturation 1.0, value 0.12 |
| **Game re-save, 2026-11-18** | `(0, 0.15, 0.25)` | a reactor painted `#B20909` (saturation 0.949, value 0.698) |
| **`SSB Test Ship_2`, picker "bright green"** | `(0.3333, 0.2, 0.55)` | hue 120 degrees, saturation 1, value 1 |
| **`SSB Test Ship_2`, picker "bright blue"** | `(0.6944, 0.2, 0.55)` | hue 250 degrees, saturation 1, value 1 |
| **`SSB Test Ship_2`, picker "default grey"** | `(0, -0.8, 0.2)` | saturation 0, value 0.65 (note: not the same as the *unpainted* grey, which is value 0.45) |

The last row is the deciding one: with value offset 0.55 the game would have stored 0.148; it stored 0.25, so the offset is 0.45. The saturation offset 0.8 matched (0.949 - 0.8 = 0.149, stored 0.15). The game rounds picker values to two decimals.

## The conversion (`blueprint.rs`)
```
stored hue        = hue
stored saturation = saturation - 0.8
stored value      = value - 0.45
```
Tests: default grey gives exactly `(0, -0.8, 0)`; full value gives 0.55 (white); and `matches_a_color_the_game_itself_saved` reproduces the `#B20909` data point within 0.01.

The app's default paint is therefore **grey `#737373`** (value 0.45), not the `#8c8c8c` first used.

## Hue is verified
Hue maps straight through as `degrees / 360`: green 120 degrees is stored as 0.3333, blue 250 degrees as 0.6944. A Rust test (`hue_and_bright_colors_match_the_games_own_save`) holds these three picker colors.

## Still unchecked
- The editor preview shows the plain picked color; in-game lighting and material will make it look different anyway.

## The game's 14 default colors
A new player starts with 14 paint slots, stored in `AllPlayersColors` in the game's starting scenarios (for example `Content\Scenarios\Never Surrender\Worlds\Mission01\Sandbox.sbc`; every scenario has the same list). They are in the same offset form as `ColorMaskHSV`:

| Slot | (hue, sat offset, value offset) | Slot | (hue, sat offset, value offset) |
|---|---|---|---|
| 1 | 0, -1, 0 | 8 | 0, -0.85, 0.2 |
| 2 | 0, 0, 0.05 | 9 | 0, 0.15, 0.25 (the `#B20909` red) |
| 3 | 0.3333, -0.48, -0.25 | 10 | 0.3333, -0.33, -0.05 |
| 4 | 0.575, 0, 0 | 11 | 0.575, 0.15, 0.2 |
| 5 | 0.1222, -0.1, 0.26 | 12 | 0.1222, 0.05, 0.46 |
| 6 | 0, -0.95, 0.4 | 13 | 0, -0.8, 0.6 |
| 7 | 0, -0.96, -0.5 | 14 | 0, -0.81, -0.3 |

Slot 9 is exactly the red you picked and the game saved as `(0, 0.15, 0.25)`, which supports the offsets above. Several slots fall slightly outside the 0 to 1 range once converted (for example saturation offset -1 gives -0.2), so the app **clamps** them. The 14 values are copied into `src/defaultPalette.ts` (14 small numbers, not an asset); the app does not read the scenario file at run time.

## Skins
Armor skins (`SkinSubtypeId`, for example `Battered_Armor`) are separate from paint and are not implemented. See [[Roadmap and Open Questions]].

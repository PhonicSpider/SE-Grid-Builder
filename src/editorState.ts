// What the player currently has selected. The menu changes it, the 3D view reads it.

import type { BlockInfo } from "./catalog";
import { DEFAULT_PAINT, type PaintColor } from "./color";
import { DEFAULT_ORIENTATION, type Orientation } from "./orientation";

/** What a left click does: place a block, delete a block, or repaint a block. */
export type EditMode = "build" | "remove" | "paint";

export interface EditorState {
  mode: EditMode;
  selectedBlock: BlockInfo | null;
  orientation: Orientation;
  paint: PaintColor;
  /** Armor skin to apply, or null for none (the red X in the game's skin picker). */
  skin: string | null;
  /** The game's two "use ... to repaint" boxes: which parts the paint tool changes. */
  repaintColor: boolean;
  repaintSkin: boolean;
}

export function createEditorState(): EditorState {
  return {
    mode: "build",
    selectedBlock: null,
    orientation: { ...DEFAULT_ORIENTATION },
    paint: { ...DEFAULT_PAINT },
    skin: null,
    repaintColor: true,
    repaintSkin: true,
  };
}

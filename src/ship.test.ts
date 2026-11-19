import { describe, expect, it } from "vitest";
import type { BlockInfo } from "./catalog";
import { DEFAULT_PAINT } from "./color";
import { DEFAULT_ORIENTATION } from "./orientation";
import { Ship } from "./ship";

function block(size: [number, number, number], cubeSize = "Large"): BlockInfo {
  return {
    type_id: "CubeBlock",
    subtype_id: "Test",
    display_name: "Test",
    categories: [],
    category_positions: [],
    cube_size: cubeSize,
    size,
    icon: null,
    shown_in_game_menu: true,
    model: null,
    model_offset: [0, 0, 0],
    cube_topology: null,
    side_models: [],
  };
}

describe("ship", () => {
  it("rejects overlapping blocks, including multi-cell ones", () => {
    const ship = new Ship();
    expect(ship.place(block([2, 2, 2]), [0, 0, 0], DEFAULT_ORIENTATION, DEFAULT_PAINT)).not.toBeNull();
    expect(ship.place(block([1, 1, 1]), [1, 1, 1], DEFAULT_ORIENTATION, DEFAULT_PAINT)).toBeNull();
    expect(ship.place(block([1, 1, 1]), [2, 0, 0], DEFAULT_ORIENTATION, DEFAULT_PAINT)).not.toBeNull();
  });

  it("rejects a block from the other grid size", () => {
    const ship = new Ship();
    expect(ship.place(block([1, 1, 1], "Small"), [0, 0, 0], DEFAULT_ORIENTATION, DEFAULT_PAINT)).toBeNull();
  });

  it("undo reverses place, paint and remove in order", () => {
    const ship = new Ship();
    const placed = ship.place(block([1, 1, 1]), [0, 0, 0], DEFAULT_ORIENTATION, DEFAULT_PAINT)!;
    ship.paint(placed.id, { color: { hue: 0.5, saturation: 1, value: 1 } });
    ship.remove(placed.id);
    expect(ship.count).toBe(0);

    ship.undo(); // remove undone: block is back, still painted
    expect(ship.count).toBe(1);
    expect(ship.blockById(placed.id)!.color.hue).toBe(0.5);

    ship.undo(); // paint undone
    expect(ship.blockById(placed.id)!.color).toEqual(DEFAULT_PAINT);

    ship.undo(); // place undone
    expect(ship.count).toBe(0);
    expect(ship.undo()).toBe(false);
  });

  it("frees every cell of a multi-cell block when it is removed", () => {
    const ship = new Ship();
    const big = ship.place(block([2, 2, 2]), [0, 0, 0], DEFAULT_ORIENTATION, DEFAULT_PAINT)!;
    ship.remove(big.id);
    expect(ship.place(block([2, 2, 2]), [0, 0, 0], DEFAULT_ORIENTATION, DEFAULT_PAINT)).not.toBeNull();
  });

  it("places blocks with a skin, repaints skin and color separately, and undoes both", () => {
    const ship = new Ship();
    const placed = ship.place(block([1, 1, 1]), [0, 0, 0], DEFAULT_ORIENTATION, DEFAULT_PAINT, "Battered_Armor")!;
    expect(placed.skin).toBe("Battered_Armor");
    expect(ship.place(block([1, 1, 1]), [1, 0, 0], DEFAULT_ORIENTATION, DEFAULT_PAINT)!.skin).toBeNull();

    // Changing only the skin leaves the color alone, and the other way round.
    ship.paint(placed.id, { skin: "Golden_Armor" });
    expect(ship.blockById(placed.id)!.skin).toBe("Golden_Armor");
    expect(ship.blockById(placed.id)!.color).toEqual(DEFAULT_PAINT);
    ship.paint(placed.id, { color: { hue: 0.2, saturation: 1, value: 1 } });
    expect(ship.blockById(placed.id)!.skin).toBe("Golden_Armor");

    // null removes the skin (the game's red X).
    ship.paint(placed.id, { skin: null });
    expect(ship.blockById(placed.id)!.skin).toBeNull();

    ship.undo();
    ship.undo();
    ship.undo();
    expect(ship.blockById(placed.id)!.skin).toBe("Battered_Armor");
    expect(ship.blockById(placed.id)!.color).toEqual(DEFAULT_PAINT);
  });

  it("a grouped fill undoes as one step and refreshes only once", () => {
    const ship = new Ship();
    let refreshes = 0;
    ship.onChange = () => refreshes++;

    ship.runAsOneStep(() => {
      for (let column = 0; column < 5; column++) {
        for (let row = 0; row < 5; row++) {
          ship.place(block([1, 1, 1]), [column, 0, row], DEFAULT_ORIENTATION, DEFAULT_PAINT);
        }
      }
    });
    expect(ship.count).toBe(25);
    expect(refreshes).toBe(1); // one refresh for 25 blocks, not 25

    ship.undo(); // the whole floor goes at once
    expect(ship.count).toBe(0);
    expect(ship.undo()).toBe(false); // and nothing else was recorded
  });

  it("a grouped removal restores every block with one undo", () => {
    const ship = new Ship();
    const ids = [0, 1, 2].map((x) => ship.place(block([1, 1, 1]), [x, 0, 0], DEFAULT_ORIENTATION, DEFAULT_PAINT)!.id);

    ship.runAsOneStep(() => ids.forEach((id) => ship.remove(id)));
    expect(ship.count).toBe(0);

    ship.undo();
    expect(ship.count).toBe(3);
    // The restored blocks occupy their cells again.
    expect(ship.place(block([1, 1, 1]), [1, 0, 0], DEFAULT_ORIENTATION, DEFAULT_PAINT)).toBeNull();
  });

  it("an empty group records nothing", () => {
    const ship = new Ship();
    ship.runAsOneStep(() => {});
    expect(ship.undo()).toBe(false);
  });

  it("only changes grid size while empty", () => {
    const ship = new Ship();
    expect(ship.setGridSize("Small")).toBe(true);
    ship.place(block([1, 1, 1], "Small"), [0, 0, 0], DEFAULT_ORIENTATION, DEFAULT_PAINT);
    expect(ship.setGridSize("Large")).toBe(false);
  });
});

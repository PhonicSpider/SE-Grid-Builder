import { describe, expect, it } from "vitest";
import type { BlockInfo } from "./catalog";
import { applyImport, buildBlockLookup, describeImport, planImport, type ImportedBlock, type ImportedBlueprint } from "./importer";
import { DEFAULT_ORIENTATION } from "./orientation";
import { DEFAULT_PAINT } from "./color";
import { Ship } from "./ship";

function info(typeId: string, subtype: string, size: [number, number, number] = [1, 1, 1], cubeSize = "Large"): BlockInfo {
  return {
    type_id: typeId,
    subtype_id: subtype,
    display_name: subtype,
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

const catalog = [
  info("CubeBlock", "LargeBlockArmorBlock"),
  info("MyObjectBuilder_Projector", "LargeProjector"), // the game lists a few types with the prefix
  info("Conveyor", "LargeBlockConveyor"),
  info("Reactor", "LargeBlockLargeGenerator", [3, 3, 3]),
  info("Door", ""), // a block with no subtype
];

function imported(type: string, subtype: string, position: [number, number, number], overrides: Partial<ImportedBlock> = {}): ImportedBlock {
  return { type_id: type, subtype_id: subtype, position, forward: "Forward", up: "Up", color: DEFAULT_PAINT, skin_subtype_id: null, ...overrides };
}

function blueprint(blocks: ImportedBlock[], overrides: Partial<ImportedBlueprint> = {}): ImportedBlueprint {
  return { name: "Test", grid_size: "Large", is_station: false, blocks, other_grid_count: 0, other_grid_blocks: 0, unreadable_blocks: 0, ...overrides };
}

describe("buildBlockLookup", () => {
  const lookup = buildBlockLookup(catalog);

  it("matches on type and subtype, with or without the MyObjectBuilder_ prefix", () => {
    expect(lookup("CubeBlock", "LargeBlockArmorBlock")?.subtype_id).toBe("LargeBlockArmorBlock");
    expect(lookup("Projector", "LargeProjector")).not.toBeNull();
    expect(lookup("MyObjectBuilder_Projector", "LargeProjector")).not.toBeNull();
    expect(lookup("MyObjectBuilder_Conveyor", "LargeBlockConveyor")).not.toBeNull();
  });

  it("matches blocks that have no subtype by their type", () => {
    expect(lookup("Door", "")?.type_id).toBe("Door");
    expect(lookup("AirVent", "")).toBeNull();
  });

  it("falls back to a subtype that belongs to one block, but never to an empty subtype", () => {
    expect(lookup("SomeRenamedType", "LargeBlockLargeGenerator")?.type_id).toBe("Reactor");
    expect(lookup("Other", "")).toBeNull();
  });

  it("does not guess when two blocks share a subtype", () => {
    const twins = buildBlockLookup([info("A", "Same"), info("B", "Same")]);
    expect(twins("C", "Same")).toBeNull();
    expect(twins("A", "Same")?.type_id).toBe("A");
  });

  it("returns null for blocks the game does not have (mods)", () => {
    expect(lookup("CubeBlock", "SomeModBlock")).toBeNull();
  });
});

describe("planImport", () => {
  const lookup = buildBlockLookup(catalog);

  it("moves the ship so its lowest corner is the origin", () => {
    const plan = planImport(
      blueprint([imported("CubeBlock", "LargeBlockArmorBlock", [-14, 4, 2]), imported("CubeBlock", "LargeBlockArmorBlock", [-12, 6, -3])]),
      lookup,
    );
    expect(plan.entries.map((entry) => entry.position)).toEqual([
      [0, 0, 5],
      [2, 2, 0],
    ]);
  });

  it("ignores blocks it will not place when finding the corner, and counts them by name", () => {
    const plan = planImport(
      blueprint([
        imported("CubeBlock", "ModBlockA", [-100, -100, -100]),
        imported("CubeBlock", "ModBlockA", [-100, -100, -99]),
        imported("Mod", "", [0, 0, 0]),
        imported("CubeBlock", "LargeBlockArmorBlock", [5, 5, 5]),
      ]),
      lookup,
    );
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].position).toEqual([0, 0, 0]);
    expect(plan.unknownBlocks.get("ModBlockA")).toBe(2);
    expect(plan.unknownBlocks.get("Mod")).toBe(1);
  });

  it("keeps orientation, paint and skin, and reads the grid size", () => {
    const red = { hue: 0, saturation: 0.8, value: 0.8 };
    const plan = planImport(
      blueprint([imported("CubeBlock", "LargeBlockArmorBlock", [0, 0, 0], { forward: "Left", up: "Down", color: red, skin_subtype_id: "Battered_Armor" })], { grid_size: "Small" }),
      lookup,
    );
    expect(plan.gridSize).toBe("Small");
    expect(plan.entries[0]).toMatchObject({ orientation: { forward: "Left", up: "Down" }, color: red, skin: "Battered_Armor" });
  });
});

describe("applyImport", () => {
  it("replaces the ship, and one undo brings the old ship back (grid size included)", () => {
    const ship = new Ship();
    ship.place(info("CubeBlock", "LargeBlockArmorBlock"), [0, 0, 0], DEFAULT_ORIENTATION, DEFAULT_PAINT);

    const smallCatalog = [info("CubeBlock", "SmallBlockArmorBlock", [1, 1, 1], "Small")];
    const summary = applyImport(
      ship,
      blueprint([imported("CubeBlock", "SmallBlockArmorBlock", [3, 3, 3]), imported("CubeBlock", "SmallBlockArmorBlock", [4, 3, 3])], { grid_size: "Small" }),
      smallCatalog,
    );
    expect(summary.placed).toBe(2);
    expect(ship.gridSize).toBe("Small");
    expect(ship.count).toBe(2);

    expect(ship.undo()).toBe(true);
    expect(ship.gridSize).toBe("Large");
    expect(ship.count).toBe(1);
    expect(ship.list()[0].info.subtype_id).toBe("LargeBlockArmorBlock");
  });

  it("skips overlapping blocks instead of failing", () => {
    const ship = new Ship();
    const summary = applyImport(
      ship,
      blueprint([imported("Reactor", "LargeBlockLargeGenerator", [0, 0, 0]), imported("CubeBlock", "LargeBlockArmorBlock", [1, 1, 1])]),
      catalog,
    );
    expect(summary.placed).toBe(1);
    expect(summary.didNotFit).toBe(1);
  });

  it("leaves the ship alone when nothing in the file is known", () => {
    const ship = new Ship();
    ship.place(info("CubeBlock", "LargeBlockArmorBlock"), [0, 0, 0], DEFAULT_ORIENTATION, DEFAULT_PAINT);
    const summary = applyImport(ship, blueprint([imported("CubeBlock", "OnlyMods", [0, 0, 0])]), catalog);
    expect(summary.placed).toBe(0);
    expect(ship.count).toBe(1);
    expect(describeImport(summary)).toContain("left as it was");
  });
});

describe("describeImport", () => {
  it("reports what was left out", () => {
    const text = describeImport({
      name: "X",
      placed: 10,
      total: 20,
      notInGame: 8,
      unknownNames: ["A", "B", "C", "D", "E"],
      didNotFit: 1,
      otherGrids: 2,
      otherGridBlocks: 5,
      unreadable: 1,
    });
    expect(text).toContain("Imported 10 of 20");
    expect(text).toContain("8 not in your game's block list");
    expect(text).toContain("A, B, C and 2 more");
    expect(text).toContain("1 did not fit");
    expect(text).toContain("2 other grids");
    expect(text).toContain("Ctrl+Z");
  });
});

import { describe, expect, it } from "vitest";
import { buildGeometry, decodeModel, isBodyPart, modelRequestFor, type ModelPart } from "./modelLoader";

// Builds a packet in the layout Rust sends (documented in src-tauri/src/mwm.rs,
// on `ModelMesh::encode_for_viewer`), so the reader can be tested without the game.
function pack(positions: number[], indices: number[], parts: ModelPart[]): ArrayBuffer {
  const encoder = new TextEncoder();
  const texts = parts.flatMap((part) => [part.material, part.technique, part.colorTexture].map((text) => encoder.encode(text)));
  const vertexCount = positions.length / 3;
  const size = 40 + positions.length * 4 + vertexCount * 8 + indices.length * 4 + parts.length * 8 + parts.length * 12 + texts.reduce((sum, text) => sum + text.length, 0);
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  let offset = 0;
  const write32 = (value: number) => {
    view.setUint32(offset, value, true);
    offset += 4;
  };
  const writeFloat = (value: number) => {
    view.setFloat32(offset, value, true);
    offset += 4;
  };
  write32(0x444d4553);
  write32(positions.length / 3);
  write32(indices.length);
  write32(parts.length);
  for (let axis = 0; axis < 3; axis++) writeFloat(0); // bounds min (not checked here)
  for (let axis = 0; axis < 3; axis++) writeFloat(1); // bounds max
  positions.forEach(writeFloat);
  // Texture coordinates: a recognisable pair per vertex, (vertex number, vertex number + 0.5).
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    writeFloat(vertex);
    writeFloat(vertex + 0.5);
  }
  indices.forEach(write32);
  let textIndex = 0;
  for (const part of parts) {
    write32(part.firstIndex);
    write32(part.indexCount);
    for (let field = 0; field < 3; field++) {
      const text = texts[textIndex++];
      write32(text.length);
      new Uint8Array(buffer, offset, text.length).set(text);
      offset += text.length;
    }
  }
  return buffer.slice(0, offset);
}

const bodyPart = (firstIndex: number, indexCount: number, technique = "MESH"): ModelPart => ({
  firstIndex,
  indexCount,
  material: "PaintedMetal",
  technique,
  colorTexture: "Textures\\a.dds",
});

const triangle = [0, 0, 0, 1, 0, 0, 0, 1, 0];

describe("decodeModel", () => {
  it("reads positions, indices and parts back exactly", () => {
    const parts = [bodyPart(0, 3)];
    const model = decodeModel(pack(triangle, [0, 1, 2], parts));
    expect([...model.positions]).toEqual(triangle);
    expect([...model.uvs]).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    expect([...model.indices]).toEqual([0, 1, 2]);
    expect(model.parts).toEqual(parts);
    expect(model.boundsMax).toEqual([1, 1, 1]);
  });

  it("rejects data with the wrong header, or too short to hold its own header", () => {
    expect(() => decodeModel(new ArrayBuffer(10))).toThrow("too short");
    const wrong = new ArrayBuffer(48);
    expect(() => decodeModel(wrong)).toThrow("wrong header");
  });

  it("rejects data that is cut short at any point, instead of reading garbage", () => {
    const packet = pack(triangle, [0, 1, 2], [bodyPart(0, 3)]);
    for (let length = 0; length < packet.byteLength; length++) {
      expect(() => decodeModel(packet.slice(0, length))).toThrow();
    }
  });

  it("rejects a part that points outside the triangle list", () => {
    expect(() => decodeModel(pack(triangle, [0, 1, 2], [bodyPart(0, 30)]))).toThrow("outside");
  });
});

describe("which parts are drawn", () => {
  it("leaves out stickers and light effects, keeps everything else", () => {
    expect(isBodyPart(bodyPart(0, 3, "MESH"))).toBe(true);
    expect(isBodyPart(bodyPart(0, 3, "GLASS"))).toBe(true);
    expect(isBodyPart(bodyPart(0, 3, "ALPHA_MASKED"))).toBe(true);
    expect(isBodyPart(bodyPart(0, 3, "DECAL"))).toBe(false);
    expect(isBodyPart(bodyPart(0, 3, "DECAL_CUTOUT"))).toBe(false);
    expect(isBodyPart(bodyPart(0, 3, "HOLO"))).toBe(false);
  });

  it("gives glass its own material slot, apart from the textured surface", () => {
    const parts = [bodyPart(0, 3, "MESH"), bodyPart(3, 3, "GLASS")];
    const { slots } = buildGeometry(decodeModel(pack([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2, 0, 1, 2], parts)));
    expect(slots).toEqual([
      { texture: bodyPart(0, 3).colorTexture, glass: false },
      { texture: "", glass: true },
    ]);
  });

  it("parts that share a texture share a slot; a different texture gets its own", () => {
    const other: ModelPart = { ...bodyPart(6, 3), colorTexture: "Textures/other.dds" };
    const parts = [bodyPart(0, 3), bodyPart(3, 3), other];
    const { geometry, slots } = buildGeometry(decodeModel(pack(triangle, [0, 1, 2, 0, 1, 2, 0, 1, 2], parts)));
    expect(slots.map((slot) => slot.texture)).toEqual([bodyPart(0, 3).colorTexture, "Textures/other.dds"]);
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 0, 1]);
  });
});

describe("buildGeometry", () => {
  it("flips the winding: the game's clockwise triangles become counter-clockwise", () => {
    const { geometry } = buildGeometry(decodeModel(pack(triangle, [0, 1, 2], [bodyPart(0, 3)])));
    expect([...geometry.getIndex()!.array]).toEqual([0, 2, 1]);
  });

  it("keeps positions, works out lighting normals, and makes one group per drawn part", () => {
    const flatPlate = [0, 0, 0, 1, 0, 0, 0, 0, 1];
    const parts = [bodyPart(0, 3), bodyPart(3, 3, "GLASS")];
    const { geometry, slots } = buildGeometry(decodeModel(pack(flatPlate, [0, 1, 2, 0, 1, 2], parts)));
    expect(geometry.getAttribute("position").count).toBe(3);
    expect(geometry.getAttribute("normal").count).toBe(3);
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([0, 1]);
    expect(slots.some((slot) => slot.glass)).toBe(true);
    expect(geometry.getAttribute("uv").count).toBe(3);
  });

  it("outward means outward: a plate drawn on top of a cube faces up after the flip", () => {
    // Stored the way the game stores a top plate: clockwise seen from above, which
    // makes the triangle's own normal point DOWN (-y). (The real HeavySquarePlate
    // file does exactly this; the Rust test reads it.) After the flip it faces up.
    const plate = [0, 0, 0, 1, 0, 0, 0, 0, 1];
    const { geometry } = buildGeometry(decodeModel(pack(plate, [0, 1, 2], [bodyPart(0, 3)])));
    const normal = geometry.getAttribute("normal");
    expect(normal.getY(0)).toBeCloseTo(1); // pointing up
  });

  it("does not draw sticker parts at all", () => {
    const parts = [bodyPart(0, 3), bodyPart(3, 3, "DECAL_CUTOUT")];
    const { geometry } = buildGeometry(decodeModel(pack(triangle, [0, 1, 2, 0, 1, 2], parts)));
    expect(geometry.groups).toHaveLength(1);
  });
});

describe("modelRequestFor", () => {
  const base = { subtype_id: "Thing", model: null, cube_topology: null, side_models: [] as string[] };

  it("asks for the model file when the block has one", () => {
    expect(modelRequestFor({ ...base, model: "Models\Cubes\Large\Reactor.mwm" })).toEqual({
      kind: "model",
      path: "Models\Cubes\Large\Reactor.mwm",
    });
  });

  it("asks for an assembled armor shape when the block is made of side plates", () => {
    expect(modelRequestFor({ ...base, subtype_id: "LargeBlockArmorSlope", cube_topology: "Slope", side_models: ["a.mwm", "b.mwm"] })).toEqual({
      kind: "armor",
      subtype: "LargeBlockArmorSlope",
      topology: "Slope",
      sides: ["a.mwm", "b.mwm"],
    });
  });

  it("returns null when there is nothing to load, so the block keeps its box", () => {
    expect(modelRequestFor(base)).toBeNull();
    expect(modelRequestFor({ ...base, cube_topology: "Slope" })).toBeNull();
  });
});

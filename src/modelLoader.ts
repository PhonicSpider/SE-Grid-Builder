// Loads the game's own 3D block models.
//
// Rust reads the `.mwm` file from the player's install and sends back the
// triangles in a compact layout (described in src-tauri/src/mwm.rs, on
// `ModelMesh::encode_for_viewer`). This file reads that layout and builds
// three.js geometry from it. Models are cached, since many blocks share one.

import { invoke } from "@tauri-apps/api/core";
import * as THREE from "three";
import { isDesktopApp } from "./catalog";
import { createLimiter } from "./limiter";

/** "SEMD" as a little-endian number: the first 4 bytes of every model packet. */
const MAGIC = 0x444d4553;
/** Bytes before the position array: 4 numbers of 4 bytes, then 6 bounds of 4 bytes.
 * After the positions come the texture coordinates, then the indices, then the parts. */
const HEADER_BYTES = 40;
/** How many models may be loading at once. */
const MAX_AT_ONCE = 4;

/** A group of triangles that share one material. */
export interface ModelPart {
  firstIndex: number;
  indexCount: number;
  material: string;
  /** How the game shades it: "MESH", "GLASS", "DECAL", ... */
  technique: string;
  /** Path of the part's colour texture (empty if none). */
  colorTexture: string;
}

/** A model exactly as Rust sent it. */
export interface DecodedModel {
  positions: Float32Array;
  /** u, v for each vertex (two numbers per vertex). */
  uvs: Float32Array;
  indices: Uint32Array;
  parts: ModelPart[];
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
}

/** Reads the packet from Rust. Throws an error with a clear message if it is damaged. */
export function decodeModel(buffer: ArrayBuffer): DecodedModel {
  if (buffer.byteLength < HEADER_BYTES) throw new Error("model data is too short");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw new Error("model data has the wrong header");

  const vertexCount = view.getUint32(4, true);
  const indexCount = view.getUint32(8, true);
  const partCount = view.getUint32(12, true);
  const boundsMin: [number, number, number] = [view.getFloat32(16, true), view.getFloat32(20, true), view.getFloat32(24, true)];
  const boundsMax: [number, number, number] = [view.getFloat32(28, true), view.getFloat32(32, true), view.getFloat32(36, true)];

  const positionBytes = vertexCount * 12;
  const uvBytes = vertexCount * 8;
  const indexBytes = indexCount * 4;
  if (HEADER_BYTES + positionBytes + uvBytes + indexBytes > buffer.byteLength) throw new Error("model data is cut short");

  // Views onto the buffer: no copying. (Offsets are multiples of 4, as required.)
  const positions = new Float32Array(buffer, HEADER_BYTES, vertexCount * 3);
  const uvs = new Float32Array(buffer, HEADER_BYTES + positionBytes, vertexCount * 2);
  const indices = new Uint32Array(buffer, HEADER_BYTES + positionBytes + uvBytes, indexCount);

  const decoder = new TextDecoder();
  let offset = HEADER_BYTES + positionBytes + uvBytes + indexBytes;
  const readNumber = (): number => {
    if (offset + 4 > buffer.byteLength) throw new Error("model data is cut short");
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  };
  const readText = (): string => {
    const length = readNumber();
    if (offset + length > buffer.byteLength) throw new Error("model data is cut short");
    const text = decoder.decode(new Uint8Array(buffer, offset, length));
    offset += length;
    return text;
  };

  const parts: ModelPart[] = [];
  for (let part = 0; part < partCount; part++) {
    const firstIndex = readNumber();
    const count = readNumber();
    if (firstIndex + count > indexCount) throw new Error("a model part points outside the triangle list");
    parts.push({ firstIndex, indexCount: count, material: readText(), technique: readText(), colorTexture: readText() });
  }
  return { positions, uvs, indices, parts, boundsMin, boundsMax };
}

/**
 * Techniques the game draws as stickers or light effects on top of a surface
 * (damage marks, labels, holograms). They only look right with their textures
 * and special shading, so without textures they would show up as solid slabs.
 * They are left out.
 */
const OVERLAY_TECHNIQUES = new Set(["DECAL", "DECAL_CUTOUT", "HOLO"]);

/** True if the part is part of the block's body rather than a sticker or light effect. */
export function isBodyPart(part: ModelPart): boolean {
  return !OVERLAY_TECHNIQUES.has(part.technique);
}

/**
 * One material a model needs: a surface texture (empty text = none) or glass.
 * Parts that share a texture share a slot, so a model has only a few slots.
 */
export interface MaterialSlot {
  /** Path of the part's colour texture, or "" for a plain surface. */
  texture: string;
  /** True for the see-through glass material (the texture is then not used). */
  glass: boolean;
}

/** A ready-to-draw model: the geometry (its groups say which slot each part uses) and the slots. */
export interface LoadedModel {
  geometry: THREE.BufferGeometry;
  /** `geometry.groups[n].materialIndex` is an index into this list. */
  slots: MaterialSlot[];
}

/**
 * Builds three.js geometry from a decoded model.
 *
 * The game stores triangles clockwise as seen from outside; three.js expects
 * counter-clockwise, so the second and third corner of each triangle swap
 * places. Lighting normals are worked out from the triangles.
 */
export function buildGeometry(model: DecodedModel): LoadedModel {
  const flipped = new Uint32Array(model.indices.length);
  for (let corner = 0; corner + 2 < model.indices.length; corner += 3) {
    flipped[corner] = model.indices[corner];
    flipped[corner + 1] = model.indices[corner + 2];
    flipped[corner + 2] = model.indices[corner + 1];
  }

  const geometry = new THREE.BufferGeometry();
  // `positions` is a view into the packet; copy it so the packet can be freed.
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(model.positions), 3));
  // The game's texture origin is the top-left corner, which is also where the
  // textures are decoded from, so the coordinates are used as stored.
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(model.uvs), 2));
  geometry.setIndex(new THREE.BufferAttribute(flipped, 1));
  geometry.computeVertexNormals();

  // One slot per distinct (glass or not, texture); each drawn part points at its slot.
  const slots: MaterialSlot[] = [];
  const slotNumbers = new Map<string, number>();
  for (const part of model.parts) {
    if (!isBodyPart(part)) continue; // sticker and light-effect parts are not drawn
    const glass = part.technique === "GLASS";
    const texture = glass ? "" : part.colorTexture;
    const key = `${glass}|${texture}`;
    let slotNumber = slotNumbers.get(key);
    if (slotNumber === undefined) {
      slotNumber = slots.length;
      slotNumbers.set(key, slotNumber);
      slots.push({ texture, glass });
    }
    if (part.indexCount > 0) geometry.addGroup(part.firstIndex, part.indexCount, slotNumber);
  }
  return { geometry, slots };
}

// ---------------------------------------------------------------------------
// Loading from the game
// ---------------------------------------------------------------------------

const limit = createLimiter(MAX_AT_ONCE);
const cache = new Map<string, Promise<LoadedModel | null>>();

/**
 * What to load for a block: either one model file, or an armor-style block that
 * Rust builds from the block's side plates (slopes, corners, half blocks...).
 */
export type ModelRequest =
  | { kind: "model"; path: string }
  | { kind: "armor"; subtype: string; topology: string; sides: string[] };

/** The model request for a block, or null when it has nothing to load (it keeps its box). */
export function modelRequestFor(info: {
  subtype_id: string;
  model: string | null;
  cube_topology: string | null;
  side_models: string[];
}): ModelRequest | null {
  if (info.model) return { kind: "model", path: info.model };
  if (info.cube_topology && info.side_models.length > 0) {
    return { kind: "armor", subtype: info.subtype_id, topology: info.cube_topology, sides: info.side_models };
  }
  return null;
}

/** Where model data comes from when the app is not running as the desktop app. */
type ModelSource = (request: ModelRequest, detail: number) => Promise<ArrayBuffer>;
let developmentSource: ModelSource | null = null;

/**
 * FOR DEVELOPMENT AND TESTS ONLY. In a plain browser there is no Rust to read
 * the game's files, so a test page can supply pre-exported model data here and
 * exercise the real drawing code. The desktop app never calls this.
 */
export function setDevelopmentModelSource(source: ModelSource | null): void {
  developmentSource = source;
  cache.clear();
}

function describe(request: ModelRequest): string {
  return request.kind === "model" ? request.path : `armor ${request.subtype}`;
}

async function fetchModel(request: ModelRequest, detail: number): Promise<LoadedModel | null> {
  try {
    const buffer = await limit(() => {
      if (developmentSource) return developmentSource(request, detail);
      return request.kind === "model"
        ? invoke<ArrayBuffer>("load_block_model", { modelPath: request.path, detail })
        : invoke<ArrayBuffer>("load_armor_model", {
            subtype: request.subtype,
            topology: request.topology,
            sideModels: request.sides,
            detail,
          });
    });
    return buildGeometry(decodeModel(buffer));
  } catch (error) {
    // A few odd models cannot be read; the block keeps its placeholder box.
    console.warn(`model failed (${describe(request)}):`, error);
    return null;
  }
}

/**
 * Loads a block's model (once; later calls reuse the result). Returns null when
 * there is nothing to load, when running outside the desktop app, or when the
 * model cannot be read. `detail` 0 is the most detailed version of the model.
 */
export function loadBlockModel(request: ModelRequest | null, detail: number): Promise<LoadedModel | null> {
  if (!request || (!isDesktopApp() && !developmentSource)) return Promise.resolve(null);
  const key = `${detail}|${request.kind === "model" ? request.path : `armor|${request.subtype}`}`;
  let result = cache.get(key);
  if (!result) {
    result = fetchModel(request, detail);
    cache.set(key, result);
  }
  return result;
}

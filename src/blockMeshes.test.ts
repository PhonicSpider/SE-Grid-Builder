import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BlockMeshes } from "./blockMeshes";
import type { BlockInfo } from "./catalog";
import { DEFAULT_ORIENTATION, type Vector } from "./orientation";
import type { PlacedBlock } from "./ship";

// No model is set on these blocks, so they stay as plain boxes (there is no
// game to load models from in a test). That is exactly what the placeholder
// and picking logic needs to be checked on.
function info(size: Vector = [1, 1, 1]): BlockInfo {
  return {
    type_id: "CubeBlock",
    subtype_id: "Test",
    display_name: "Test",
    categories: [],
    category_positions: [],
    cube_size: "Large",
    size,
    icon: null,
    shown_in_game_menu: true,
    model: null,
    model_offset: [0, 0, 0],
    cube_topology: null,
    side_models: [],
  };
}

function block(id: number, position: Vector, hue = 0, size: Vector = [1, 1, 1]): PlacedBlock {
  return {
    id,
    info: info(size),
    position,
    orientation: DEFAULT_ORIENTATION,
    color: { hue, saturation: 1, value: 1 },
    skin: null,
  };
}

describe("BlockMeshes", () => {
  it("adds one pick box and one body per block, and removes them again", () => {
    const scene = new THREE.Scene();
    const meshes = new BlockMeshes(scene);
    const startingObjects = scene.children.length; // the hover highlight box

    meshes.sync([block(1, [0, 0, 0]), block(2, [1, 0, 0])]);
    expect(meshes.pickTargets).toHaveLength(2);
    expect(scene.children.length).toBe(startingObjects + 2);

    meshes.sync([block(2, [1, 0, 0])]);
    expect(meshes.pickTargets).toHaveLength(1);
    expect(meshes.pickTargets[0].userData.blockId).toBe(2);
    expect(scene.children.length).toBe(startingObjects + 1);
  });

  it("shares one material between blocks of the same color, and swaps it when a block is repainted", () => {
    const scene = new THREE.Scene();
    const meshes = new BlockMeshes(scene);
    const red = block(1, [0, 0, 0], 0);
    const alsoRed = block(2, [1, 0, 0], 0);
    meshes.sync([red, alsoRed]);

    const bodies = scene.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.children.length > 0);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].material).toBe(bodies[1].material); // one material for both

    red.color = { hue: 0.5, saturation: 1, value: 1 };
    meshes.sync([red, alsoRed]);
    expect(bodies[0].material).not.toBe(bodies[1].material);
  });

  it("places the pick box over the block's cells, so a ray finds the right block and face", () => {
    const scene = new THREE.Scene();
    const meshes = new BlockMeshes(scene);
    // A 2x1x1 block at [3, 0, 5] covers x 3..5, y 0..1, z 5..6.
    meshes.sync([block(7, [3, 0, 5], 0, [2, 1, 1]), block(8, [0, 0, 0])]);

    const ray = new THREE.Raycaster(new THREE.Vector3(4, 5, 5.5), new THREE.Vector3(0, -1, 0));
    const hits = ray.intersectObjects(meshes.pickTargets, false);
    // The ray goes right through the block (in at the top, out at the bottom), so there
    // are two hits; the nearest one, first in the list, is what the viewer uses.
    expect(hits.length).toBeGreaterThan(0);
    expect(new Set(hits.map((hit) => hit.object.userData.blockId))).toEqual(new Set([7]));
    expect(hits[0].object.userData.blockId).toBe(7);
    expect(hits[0].point.y).toBeCloseTo(1); // the top face
    expect(hits[0].face!.normal.y).toBeCloseTo(1); // facing up

    // A ray that misses every block finds nothing.
    const miss = new THREE.Raycaster(new THREE.Vector3(20, 5, 20), new THREE.Vector3(0, -1, 0));
    expect(miss.intersectObjects(meshes.pickTargets, false)).toHaveLength(0);
  });

  it("highlights one block with a tint, and clears it", () => {
    const scene = new THREE.Scene();
    const meshes = new BlockMeshes(scene);
    meshes.sync([block(1, [0, 0, 0]), block(2, [4, 0, 0])]);
    const highlight = scene.children[0] as THREE.Mesh; // created first, in the constructor

    meshes.highlight(2, 0xe5484d);
    expect(highlight.visible).toBe(true);
    expect(highlight.position.x).toBeCloseTo(4.5); // over block 2
    expect((highlight.material as THREE.MeshBasicMaterial).color.getHex()).toBe(0xe5484d);

    meshes.highlight(null, 0);
    expect(highlight.visible).toBe(false);

    meshes.highlight(999, 0xffffff); // a block that is not there
    expect(highlight.visible).toBe(false);
  });

  it("keeps the pick list stable until the ship changes", () => {
    const scene = new THREE.Scene();
    const meshes = new BlockMeshes(scene);
    meshes.sync([block(1, [0, 0, 0])]);
    const first = meshes.pickTargets;
    meshes.sync([block(1, [0, 0, 0])]); // nothing changed
    expect(meshes.pickTargets).toBe(first); // the same list, not rebuilt
    meshes.sync([block(1, [0, 0, 0]), block(2, [1, 0, 0])]);
    expect(meshes.pickTargets).not.toBe(first);
  });
});

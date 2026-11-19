// The scene objects for the ship's blocks.
//
// Each block has two parts:
//   * a BODY that is drawn: first a plain colored box, then the block's real
//     3D model as soon as it has loaded from the game;
//   * a PICK BOX that is never drawn: a plain box over the block's cells, used
//     for mouse picking. Keeping picking on simple boxes makes clicks fast and
//     the "which face did I click" answer exact, even for slopes and big models.
//
// Models and materials are shared: a hundred red armor blocks use one model
// and one material, not a hundred of each.

import * as THREE from "three";
import { placementMatrix, placementOf } from "./blockPlacement";
import { DEFAULT_PAINT, paintToHex } from "./color";
import { loadBlockModel, modelRequestFor, type LoadedModel } from "./modelLoader";
import { footprint } from "./orientation";
import type { PlacedBlock } from "./ship";
import { loadTexture } from "./textureLoader";
import { fadeStateFor, viewGroupOf, type ViewGroup } from "./viewGroups";

/** Which version of each model to draw: 0 is the most detailed. */
const MODEL_DETAIL = 0;

/** No paint channel is brightened by more than this, so white paint cannot blow the texture out. */
const MAX_TINT = 4;
/**
 * The game's textures are fairly dark on their own (the average pixel is about a
 * third as bright as the default paint grey). This is the brightness of paint
 * that leaves a texture looking about as bright as the old flat grey box did.
 */
const TEXTURE_REFERENCE_BRIGHTNESS = 0.55;
const DEFAULT_PAINT_COLOR = new THREE.Color(paintToHex(DEFAULT_PAINT)).multiplyScalar(TEXTURE_REFERENCE_BRIGHTNESS);

/**
 * The multiplier that turns a game texture into the painted block.
 *
 * Default grey paint gives the texture at a natural brightness; other paint
 * colors shift it toward their own color (darker, lighter or tinted). This is
 * an approximation: the game paints only the parts of the texture its color
 * mask marks as paintable, while this tints the whole surface.
 */
export function paintTint(colorHex: string): THREE.Color {
  const paint = new THREE.Color(colorHex);
  return new THREE.Color(
    Math.min(MAX_TINT, paint.r / DEFAULT_PAINT_COLOR.r),
    Math.min(MAX_TINT, paint.g / DEFAULT_PAINT_COLOR.g),
    Math.min(MAX_TINT, paint.b / DEFAULT_PAINT_COLOR.b),
  );
}

interface BlockVisual {
  block: PlacedBlock;
  /** Which fadable group the block is in (armor or other). */
  group: ViewGroup;
  pick: THREE.Mesh;
  body: THREE.Mesh;
  /** The color the body currently shows, so a repaint is noticed. */
  colorHex: string;
  /** The loaded model, once it has replaced the placeholder box. */
  model: LoadedModel | null;
}

export class BlockMeshes {
  private visuals = new Map<number, BlockVisual>();
  private pickList: THREE.Object3D[] = [];
  private pickListIsStale = false;

  // Shared by every block.
  private unitBox = new THREE.BoxGeometry(1, 1, 1);
  private unitBoxEdges = new THREE.EdgesGeometry(this.unitBox);
  private outlineMaterial = new THREE.LineBasicMaterial({ color: 0x0b0c10 });
  private pickMaterial = new THREE.MeshBasicMaterial({ visible: false });
  // One material per (group, color), so fading a group only touches that group's materials.
  private solidMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private groupOpacity = new Map<ViewGroup, number>();
  /** Groups whose faded blocks are skipped by mouse picking (clicks go through them). */
  private clickThroughGroups = new Set<ViewGroup>();
  private glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x9ec9ff,
    transparent: true,
    opacity: 0.35,
    roughness: 0.1,
    metalness: 0,
    depthWrite: false,
  });

  /** A translucent box over the block under the cursor (remove / paint tools). */
  private highlightBox: THREE.Mesh;
  private highlightMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false });

  constructor(private scene: THREE.Scene) {
    this.highlightBox = new THREE.Mesh(this.unitBox, this.highlightMaterial);
    this.highlightBox.visible = false;
    scene.add(this.highlightBox);
  }

  /** The boxes to test mouse clicks against. Each carries `userData.blockId`. */
  get pickTargets(): THREE.Object3D[] {
    if (this.pickListIsStale) {
      this.pickList = [...this.visuals.values()].filter((visual) => !this.isIgnoredByPicking(visual)).map((visual) => visual.pick);
      this.pickListIsStale = false;
    }
    return this.pickList;
  }

  /**
   * Fades every block of one group (1 = solid, 0 = not drawn). Blocks added
   * later pick up the same setting, because it lives on the group's materials.
   */
  setGroupOpacity(group: ViewGroup, opacity: number): void {
    const fade = fadeStateFor(opacity);
    this.groupOpacity.set(group, fade.opacity);

    for (const [key, material] of this.solidMaterials) {
      if (!key.startsWith(`${group}:`)) continue;
      this.applyFade(material, group);
    }
    for (const visual of this.visuals.values()) {
      if (visual.group === group) visual.body.visible = fade.visible;
    }
    this.pickListIsStale = true; // hidden or click-through blocks leave the pick list
  }

  /** When on, blocks of a faded group are skipped by picking, so clicks reach what is behind. */
  setClickThrough(group: ViewGroup, clickThrough: boolean): void {
    if (clickThrough) this.clickThroughGroups.add(group);
    else this.clickThroughGroups.delete(group);
    this.pickListIsStale = true;
  }

  /** True when a block is not drawn, or is faded and set to be clicked through. */
  private isIgnoredByPicking(visual: BlockVisual): boolean {
    const fade = fadeStateFor(this.groupOpacity.get(visual.group) ?? 1);
    return !fade.visible || (fade.transparent && this.clickThroughGroups.has(visual.group));
  }

  /** Copies a group's current fade onto one of its materials. */
  private applyFade(material: THREE.MeshStandardMaterial, group: ViewGroup): void {
    const fade = fadeStateFor(this.groupOpacity.get(group) ?? 1);
    // Switching `transparent` changes how the shader is built, so it must be flagged.
    if (material.transparent !== fade.transparent) material.needsUpdate = true;
    material.transparent = fade.transparent;
    material.opacity = fade.opacity;
    material.depthWrite = fade.depthWrite;
  }

  /** Makes the scene match the ship: adds new blocks, removes old ones, repaints changed ones. */
  sync(blocks: PlacedBlock[]): void {
    const currentIds = new Set<number>();

    for (const block of blocks) {
      currentIds.add(block.id);
      let visual = this.visuals.get(block.id);
      if (!visual) {
        visual = this.createVisual(block);
        this.visuals.set(block.id, visual);
        this.pickListIsStale = true;
      }
      const colorHex = paintToHex(block.color);
      if (colorHex !== visual.colorHex) {
        visual.colorHex = colorHex;
        visual.body.material = this.materialsFor(visual);
      }
    }

    for (const [blockId, visual] of this.visuals) {
      if (!currentIds.has(blockId)) {
        // Geometry and materials are shared, so only the object itself is removed.
        this.scene.remove(visual.body);
        this.visuals.delete(blockId);
        this.pickListIsStale = true;
      }
    }
  }

  /** Lights up one block with a tint (or clears the highlight when `blockId` is null). */
  highlight(blockId: number | null, color: number): void {
    const visual = blockId === null ? undefined : this.visuals.get(blockId);
    if (!visual) {
      this.highlightBox.visible = false;
      return;
    }
    // Slightly larger than the block so it shows over the model's surface.
    this.highlightBox.position.copy(visual.pick.position);
    this.highlightBox.scale.copy(visual.pick.scale).addScalar(0.04);
    this.highlightMaterial.color.set(color);
    this.highlightBox.visible = true;
  }

  // -------------------------------------------------------------------------

  private createVisual(block: PlacedBlock): BlockVisual {
    const [width, height, depth] = footprint(block.info.size, block.orientation);
    const center = new THREE.Vector3(
      block.position[0] + width / 2,
      block.position[1] + height / 2,
      block.position[2] + depth / 2,
    );

    // The invisible box for picking. It is not in the scene, so its position
    // in the world is worked out once, here.
    const pick = new THREE.Mesh(this.unitBox, this.pickMaterial);
    pick.position.copy(center);
    pick.scale.set(width, height, depth);
    pick.userData.blockId = block.id;
    pick.updateMatrixWorld(true);

    // The drawn body starts as a plain colored box with a dark outline.
    const colorHex = paintToHex(block.color);
    const group = viewGroupOf(block.info);
    const body = new THREE.Mesh(this.unitBox, this.solidMaterial(colorHex, group, ""));
    body.visible = fadeStateFor(this.groupOpacity.get(group) ?? 1).visible;
    body.position.copy(center);
    body.scale.set(width, height, depth);
    body.add(new THREE.LineSegments(this.unitBoxEdges, this.outlineMaterial));
    this.scene.add(body);

    const visual: BlockVisual = { block, group, pick, body, colorHex, model: null };

    // Swap in the real model when it arrives (if the block is still there by then).
    void loadBlockModel(modelRequestFor(block.info), MODEL_DETAIL).then((model) => {
      if (model && this.visuals.get(block.id) === visual) this.showModel(visual, model);
    });
    return visual;
  }

  /** Replaces the placeholder box with the block's real model. */
  private showModel(visual: BlockVisual, model: LoadedModel): void {
    const { block, body } = visual;
    const matrix = placementMatrix(placementOf(block.info, block.position, block.orientation));

    visual.model = model;
    body.geometry = model.geometry;
    body.clear(); // the outline belonged to the box
    // The model carries its own position, rotation and scale in one matrix.
    body.matrixAutoUpdate = false;
    body.matrix.fromArray(matrix);
    body.matrixWorldNeedsUpdate = true;
    body.material = this.materialsFor(visual);
  }

  /** The material (or materials: solid plus glass) a block should be drawn with. */
  private materialsFor(visual: BlockVisual): THREE.Material | THREE.Material[] {
    const model = visual.model;
    if (!model) return this.solidMaterial(visual.colorHex, visual.group, ""); // the placeholder box
    // One material per slot, in slot order (the geometry's groups point at these).
    return model.slots.map((slot) =>
      slot.glass ? this.glassMaterial : this.solidMaterial(visual.colorHex, visual.group, slot.texture),
    );
  }

  /**
   * The material for one (group, paint color, texture). With a texture the paint
   * color tints the picture; the texture arrives later, and until then the plain
   * color shows.
   */
  private solidMaterial(colorHex: string, group: ViewGroup, texturePath: string): THREE.MeshStandardMaterial {
    const key = `${group}:${colorHex}:${texturePath}`;
    let material = this.solidMaterials.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.6, metalness: 0.2 });
      this.applyFade(material, group); // a new color made while faded must start faded
      this.solidMaterials.set(key, material);

      if (texturePath) {
        const created = material;
        void loadTexture(texturePath).then((texture) => {
          if (!texture) return;
          created.map = texture;
          created.color.copy(paintTint(colorHex));
          created.needsUpdate = true; // the shader changes when a map is added
        });
      }
    }
    return material;
  }
}

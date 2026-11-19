// The 3D view: draws the ship and turns mouse clicks into edits.
//
// Every block is drawn as a colored box of the right size. These are
// stand-ins; real game models come later (see the vault note "Roadmap").
//
// Controls:
//   left click (no drag)       do the current tool's action (build / remove / paint)
//   right click (no drag)      remove the block under the cursor
//   Shift + left drag          fill a FLOOR (flat, one block deep) with the current tool
//   Shift + right drag         remove a floor
//   Ctrl + left drag           fill a WALL (stands on the clicked face) with the current tool
//   Ctrl + right drag          remove a wall
//   left drag                  orbit the camera
//   right drag                 pan the camera
//   mouse wheel                zoom
//
// One grid cell is one unit in the 3D scene. The cell at position [x, y, z]
// fills the space from (x, y, z) to (x + 1, y + 1, z + 1).

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { boundsOfDrag, cellsInLayer, dragAxisFor, fillLayout, IN_PLANE_AXES, type AreaBounds, type AreaShape } from "./areaTools";
import { BlockMeshes } from "./blockMeshes";
import { placementMatrix, placementOf } from "./blockPlacement";
import type { BlockInfo } from "./catalog";
import { loadBlockModel, modelRequestFor, type LoadedModel } from "./modelLoader";
import type { EditorState } from "./editorState";
import { footprint, type Vector } from "./orientation";
import type { PaintChange, Ship } from "./ship";
import type { ViewGroup } from "./viewGroups";

/** Clicks that move the mouse further than this many pixels count as drags. */
const CLICK_DRAG_LIMIT_PIXELS = 5;

/** What is under the mouse: a block, and/or an empty cell where a new block would go. */
interface PickResult {
  blockId: number | null;
  /** The empty cell next to the face that was hit (or on the floor). */
  placementCell: Vector | null;
  /** The axis (0 = x, 1 = y, 2 = z) the hit face points along. The floor counts as y. */
  faceAxis: number | null;
  /** The cell inside the hit block (null when the floor was hit). */
  hitCell: Vector | null;
}

type AreaAction = "place" | "remove" | "paint";

/** A Ctrl-drag in progress. The area is one cell deep, on layer `layer` of `axis`. */
interface AreaDrag {
  action: AreaAction;
  axis: number;
  layer: number;
  /** In-plane cell where the drag started and where it is now, as [first axis, second axis]. */
  anchor: [number, number];
  current: [number, number];
}

export class Viewport {
  /** Called with short status text such as "Placed 12 blocks". */
  onMessage: (text: string) => void = () => {};

  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private blocks: BlockMeshes;
  private ghost: THREE.Mesh;
  private ghostMaterial: THREE.MeshBasicMaterial;
  private ghostModel: THREE.Mesh;
  private ghostModelMaterial: THREE.MeshStandardMaterial;
  /** The block whose model the ghost currently has (or is loading), and the model once loaded. */
  private ghostModelBlock: BlockInfo | null = null;
  private ghostModelLoaded: LoadedModel | null = null;
  private areaPreview: THREE.Mesh;
  private areaPreviewMaterial: THREE.MeshBasicMaterial;
  private hoveredBlockId: number | null = null;

  private lastPointer: { clientX: number; clientY: number } | null = null;
  private pointerDown: { clientX: number; clientY: number; button: number } | null = null;
  private areaDrag: AreaDrag | null = null;
  private pointerUpdateScheduled = false;

  constructor(
    private container: HTMLElement,
    private ship: Ship,
    private state: EditorState,
  ) {
    this.scene.background = new THREE.Color(0x14161c);
    this.blocks = new BlockMeshes(this.scene);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    this.camera.position.set(9, 8, 14);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(2, 1, 0);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const sunlight = new THREE.DirectionalLight(0xffffff, 2.2);
    sunlight.position.set(6, 12, 8);
    this.scene.add(sunlight);

    // Floor grid; its lines sit exactly on cell boundaries.
    const floorGrid = new THREE.GridHelper(60, 60, 0x4b5365, 0x2a2f3b);
    this.scene.add(floorGrid);

    // The ghost previews where the next block would go (green) or why it cannot (red).
    this.ghostMaterial = new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.45 });
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.ghostMaterial);
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    // The ghost's model: the selected block's real shape, tinted green or red,
    // so the player can see which way it faces before placing it. The box above
    // stays as a faint footprint, and as the whole ghost until the model loads.
    this.ghostModelMaterial = new THREE.MeshStandardMaterial({
      color: 0x3ddc84,
      transparent: true,
      opacity: 0.7,
      roughness: 0.6,
      metalness: 0.1,
    });
    this.ghostModel = new THREE.Mesh(new THREE.BufferGeometry(), [this.ghostModelMaterial, this.ghostModelMaterial]);
    this.ghostModel.matrixAutoUpdate = false;
    this.ghostModel.visible = false;
    this.scene.add(this.ghostModel);

    // The area preview shows the rectangle a Ctrl-drag would fill or clear.
    this.areaPreviewMaterial = new THREE.MeshBasicMaterial({ color: 0x3ddc84, transparent: true, opacity: 0.35 });
    this.areaPreview = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.areaPreviewMaterial);
    this.areaPreview.visible = false;
    this.scene.add(this.areaPreview);

    this.listenForPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.refresh();
    this.animate();
  }

  /** Redraws everything that depends on the ship or the current selection. */
  refresh(): void {
    this.blocks.sync(this.ship.list());
    this.updateHover();
    this.updateGhost();
  }

  /**
   * Points the camera at the whole ship, from the direction it is already looking
   * from, far enough back to see all of it (used after an import).
   */
  frameShip(): void {
    const blocks = this.ship.list();
    if (blocks.length === 0) return;
    const low = new THREE.Vector3(Infinity, Infinity, Infinity);
    const high = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const block of blocks) {
      const [width, height, depth] = footprint(block.info.size, block.orientation);
      low.min(new THREE.Vector3(...block.position));
      high.max(new THREE.Vector3(block.position[0] + width, block.position[1] + height, block.position[2] + depth));
    }
    const center = low.clone().add(high).multiplyScalar(0.5);
    const radius = Math.max(2, high.clone().sub(low).length() / 2);

    // Back off along the current view direction until the whole ship fits the view.
    const direction = this.camera.position.clone().sub(this.controls.target);
    if (direction.lengthSq() < 1e-6) direction.set(1, 0.6, 1);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(direction.normalize().multiplyScalar(distance * 1.1));
    this.camera.far = Math.max(this.camera.far, distance * 4);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /** Fades a group of blocks (1 = solid, 0 = hidden), for example armor, to see inside the ship. */
  setGroupOpacity(group: ViewGroup, opacity: number): void {
    this.blocks.setGroupOpacity(group, opacity);
    this.hoveredBlockId = null; // the block under the mouse may no longer be pickable
    this.updateHover();
  }

  /** When on, clicks pass through a faded group to the blocks behind it. */
  setClickThrough(group: ViewGroup, clickThrough: boolean): void {
    this.blocks.setClickThrough(group, clickThrough);
    this.hoveredBlockId = null;
    this.updateHover();
  }

  // -------------------------------------------------------------------------
  // Drawing the ship (the block objects live in BlockMeshes)
  // -------------------------------------------------------------------------

  /** Tints the block under the cursor in remove / paint mode. */
  private updateHover(): void {
    const tool = this.state.mode;
    if (tool === "build") {
      this.blocks.highlight(null, 0);
      return;
    }
    this.blocks.highlight(this.hoveredBlockId, tool === "remove" ? 0xe5484d : 0xffffff);
  }

  /**
   * Shows where the next block would go. A caller that has just worked out what
   * is under the mouse can pass it in, so the (slow) raycast is not done twice.
   */
  private updateGhost(knownPick?: PickResult): void {
    const selected = this.state.selectedBlock;
    if (this.areaDrag || this.state.mode !== "build" || !selected || !this.lastPointer) {
      this.ghost.visible = false;
      this.ghostModel.visible = false;
      return;
    }
    this.loadGhostModel(selected);
    const pick = knownPick ?? this.pick(this.lastPointer.clientX, this.lastPointer.clientY);
    if (!pick.placementCell) {
      this.ghost.visible = false;
      this.ghostModel.visible = false;
      return;
    }

    const [width, height, depth] = footprint(selected.size, this.state.orientation);
    this.ghost.scale.set(width, height, depth);
    this.ghost.position.set(
      pick.placementCell[0] + width / 2,
      pick.placementCell[1] + height / 2,
      pick.placementCell[2] + depth / 2,
    );
    const allowed = this.ship.canPlace(selected, pick.placementCell, this.state.orientation);
    const tint = allowed ? 0x3ddc84 : 0xe5484d;
    this.ghostMaterial.color.set(tint);
    this.ghost.visible = true;

    // With the real model loaded, only the model is drawn, turned the way the
    // block will face. (A box around it would hide the model's surface, since
    // see-through boxes still block what is behind their front faces.) The box
    // is the whole ghost until the model arrives, or for blocks with no model.
    const model = this.ghostModelBlock === selected ? this.ghostModelLoaded : null;
    this.ghost.visible = model === null;
    this.ghostModel.visible = model !== null;
    if (model) {
      this.ghostModelMaterial.color.set(tint);
      this.ghostModel.geometry = model.geometry;
      // Every material slot the model uses needs an entry, or its parts would not be drawn.
      this.ghostModel.material = model.slots.map(() => this.ghostModelMaterial);
      const placement = placementOf(selected, pick.placementCell, this.state.orientation);
      this.ghostModel.matrix.fromArray(placementMatrix(placement));
      this.ghostModel.matrixWorldNeedsUpdate = true;
    }
  }

  /** Starts loading the selected block's model for the ghost (the loader caches, so this is cheap to repeat). */
  private loadGhostModel(selected: BlockInfo): void {
    if (this.ghostModelBlock === selected) return;
    this.ghostModelBlock = selected;
    this.ghostModelLoaded = null;
    void loadBlockModel(modelRequestFor(selected), 0).then((model) => {
      if (this.ghostModelBlock !== selected) return; // the player picked something else meanwhile
      this.ghostModelLoaded = model;
      this.updateGhost();
    });
  }

  // -------------------------------------------------------------------------
  // Finding what is under the mouse
  // -------------------------------------------------------------------------

  /** Aims the ray at the mouse position. */
  private aimRay(clientX: number, clientY: number): void {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
  }

  /** Works out what is under the mouse pointer. */
  private pick(clientX: number, clientY: number): PickResult {
    this.aimRay(clientX, clientY);

    // First: did the ray hit an existing block's pick box?
    const hits = this.raycaster.intersectObjects(this.blocks.pickTargets, false);
    if (hits.length > 0 && hits[0].face) {
      const hit = hits[0];
      const normal = hit.face!.normal;
      const normalParts: Vector = [normal.x, normal.y, normal.z];
      const faceAxis = normalParts.findIndex((part) => Math.abs(part) > 0.5);

      // Nudge the hit point a hair outward through the face we touched; the
      // cell that contains it is the empty cell next to that face. Nudged
      // inward instead, it is the cell of the block that was hit.
      const placementCell: Vector = [
        Math.floor(hit.point.x + normal.x * 0.01),
        Math.floor(hit.point.y + normal.y * 0.01),
        Math.floor(hit.point.z + normal.z * 0.01),
      ];
      const hitCell: Vector = [
        Math.floor(hit.point.x - normal.x * 0.01),
        Math.floor(hit.point.y - normal.y * 0.01),
        Math.floor(hit.point.z - normal.z * 0.01),
      ];
      return { blockId: hit.object.userData.blockId as number, placementCell, faceAxis, hitCell };
    }

    // Otherwise: did it hit the floor?
    const floorPoint = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.groundPlane, floorPoint)) {
      return {
        blockId: null,
        placementCell: [Math.floor(floorPoint.x), 0, Math.floor(floorPoint.z)],
        faceAxis: 1,
        hitCell: null,
      };
    }
    return { blockId: null, placementCell: null, faceAxis: null, hitCell: null };
  }

  // -------------------------------------------------------------------------
  // Mouse handling
  // -------------------------------------------------------------------------

  /**
   * A mouse can report hundreds of moves per second, but the screen only
   * redraws about 60 times a second. Raycasting on every move would waste
   * most of the work, so moves are collected and handled once per frame.
   */
  private schedulePointerUpdate(): void {
    if (this.pointerUpdateScheduled) return;
    this.pointerUpdateScheduled = true;
    requestAnimationFrame(() => {
      this.pointerUpdateScheduled = false;
      const pointer = this.lastPointer;
      if (!pointer) return;

      if (this.areaDrag) {
        this.updateAreaDrag(pointer.clientX, pointer.clientY);
        return;
      }
      const pick = this.pick(pointer.clientX, pointer.clientY); // one raycast, used for both
      this.hoveredBlockId = pick.blockId;
      this.updateHover();
      this.updateGhost(pick);
    });
  }

  private listenForPointer(): void {
    const canvas = this.renderer.domElement;

    // Ctrl + drag must start BEFORE the camera controls see the click, or the
    // camera would start moving. A listener with `capture: true` on the
    // container runs first, so it can switch the camera controls off.
    this.container.addEventListener("pointerdown", (event) => this.beginAreaDrag(event), { capture: true });

    canvas.addEventListener("pointermove", (event) => {
      // Only note where the mouse is; the work happens at most once per frame.
      this.lastPointer = { clientX: event.clientX, clientY: event.clientY };
      this.schedulePointerUpdate();
    });

    canvas.addEventListener("pointerleave", () => {
      if (this.areaDrag) return; // pointer capture keeps the drag going outside the canvas
      this.lastPointer = null;
      this.hoveredBlockId = null;
      this.updateHover();
      this.updateGhost();
    });

    canvas.addEventListener("pointerdown", (event) => {
      this.pointerDown = { clientX: event.clientX, clientY: event.clientY, button: event.button };
    });

    canvas.addEventListener("pointerup", (event) => {
      const start = this.pointerDown;
      this.pointerDown = null;

      if (this.areaDrag) {
        // Moves are handled once per frame, so a quick flick and release could
        // arrive before the last move was applied. Use the release position.
        this.updateAreaDrag(event.clientX, event.clientY);
        this.finishAreaDrag();
        return;
      }
      if (!start) return;

      const movedPixels = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY);
      if (movedPixels > CLICK_DRAG_LIMIT_PIXELS) return; // it was a camera drag, not a click

      this.handleClick(start.button, this.pick(event.clientX, event.clientY));
    });

    canvas.addEventListener("pointercancel", () => void this.cancelAreaDrag());

    // Right click is used for removing, so hide the browser's context menu.
    canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  private handleClick(button: number, pick: PickResult): void {
    if (button === 2) {
      if (pick.blockId !== null) this.ship.remove(pick.blockId);
      return;
    }
    if (button !== 0) return;

    switch (this.state.mode) {
      case "build": {
        const selected = this.state.selectedBlock;
        if (selected && pick.placementCell) {
          this.ship.place(
            selected,
            pick.placementCell,
            { ...this.state.orientation },
            { ...this.state.paint },
            this.state.skin,
          );
        }
        break;
      }
      case "remove":
        if (pick.blockId !== null) this.ship.remove(pick.blockId);
        break;
      case "paint":
        if (pick.blockId !== null) this.ship.paint(pick.blockId, this.paintChange());
        break;
    }
  }

  /** What the paint tool changes, following the two "use ... to repaint" boxes. */
  private paintChange(): PaintChange {
    const change: PaintChange = {};
    if (this.state.repaintColor) change.color = { ...this.state.paint };
    if (this.state.repaintSkin) change.skin = this.state.skin;
    return change;
  }

  // -------------------------------------------------------------------------
  // Ctrl + drag: fill or clear a flat area, one block deep
  // -------------------------------------------------------------------------

  /** Starts an area drag when Shift (floor) or Ctrl (wall) is held. Does nothing for a normal click. */
  private beginAreaDrag(event: PointerEvent): void {
    // The view bar sits inside the container too; clicks on it are not clicks on the ship.
    if (event.target !== this.renderer.domElement) return;
    // Shift makes a floor, Ctrl makes a wall (Shift wins if both are held).
    if ((!event.shiftKey && !event.ctrlKey) || (event.button !== 0 && event.button !== 2)) return;
    const shape: AreaShape = event.shiftKey ? "floor" : "wall";

    // Right button always clears. The left button follows the current tool.
    const action: AreaAction =
      event.button === 2 ? "remove" : this.state.mode === "build" ? "place" : this.state.mode;

    const pick = this.pick(event.clientX, event.clientY);
    let axis: number;
    let startCell: Vector;
    const viewDirection = this.camera.getWorldDirection(new THREE.Vector3());
    const view: Vector = [viewDirection.x, viewDirection.y, viewDirection.z];

    if (action === "place") {
      // The area lies in the layer just outside the face that was clicked (or on the floor).
      if (!this.state.selectedBlock || !pick.placementCell || pick.faceAxis === null) return;
      axis = dragAxisFor(shape, pick.faceAxis, view);
      startCell = pick.placementCell;
    } else {
      // Remove and paint work on the layer of the block that was clicked.
      if (pick.blockId === null || !pick.hitCell || pick.faceAxis === null) return;
      axis = dragAxisFor(shape, pick.faceAxis, view);
      startCell = pick.hitCell;
    }

    const [firstAxis, secondAxis] = IN_PLANE_AXES[axis];
    const anchor: [number, number] = [startCell[firstAxis], startCell[secondAxis]];
    this.areaDrag = { action, axis, layer: startCell[axis], anchor, current: anchor };

    this.controls.enabled = false; // stop the camera from also moving
    try {
      // Keeps the drag working when the cursor leaves the canvas.
      this.renderer.domElement.setPointerCapture(event.pointerId);
    } catch {
      // The pointer may already be gone; the drag still works while over the canvas.
    }
    this.ghost.visible = false;
    this.showAreaPreview();
  }

  /** Follows the mouse while dragging: which in-plane cell is it over? */
  private updateAreaDrag(clientX: number, clientY: number): void {
    const drag = this.areaDrag;
    if (!drag) return;

    const [firstAxis, secondAxis] = IN_PLANE_AXES[drag.axis];
    // The flat layer being edited, as an infinite plane through the middle of its cells.
    const planeNormal = new THREE.Vector3();
    planeNormal.setComponent(drag.axis, 1);
    const plane = new THREE.Plane(planeNormal, -(drag.layer + 0.5));

    this.aimRay(clientX, clientY);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, point)) return; // looking away from the layer

    drag.current = [Math.floor(point.getComponent(firstAxis)), Math.floor(point.getComponent(secondAxis))];
    this.showAreaPreview();
  }

  /** The in-plane corners of the dragged rectangle. */
  private areaBounds(drag: AreaDrag): AreaBounds {
    return boundsOfDrag(drag.anchor, drag.current);
  }

  /** Where blocks would be placed to fill the rectangle (the math is in areaTools.ts). */
  private fillPositions(drag: AreaDrag): { positions: Vector[]; size: Vector } {
    const selected = this.state.selectedBlock!;
    const blockSize = footprint(selected.size, this.state.orientation);
    return fillLayout(drag.axis, drag.layer, this.areaBounds(drag), blockSize);
  }

  /** The ids of every block touching the dragged rectangle's layer. */
  private blocksInArea(drag: AreaDrag): number[] {
    const ids = new Set<number>();
    for (const cell of cellsInLayer(drag.axis, drag.layer, this.areaBounds(drag))) {
      const block = this.ship.blockAtCell(cell);
      if (block) ids.add(block.id);
    }
    return [...ids];
  }

  /** Draws the translucent box over the area the drag would affect. */
  private showAreaPreview(): void {
    const drag = this.areaDrag;
    if (!drag) {
      this.areaPreview.visible = false;
      return;
    }
    const [firstAxis, secondAxis] = IN_PLANE_AXES[drag.axis];
    const bounds = this.areaBounds(drag);

    const minCorner: Vector = [0, 0, 0];
    const size: Vector = [1, 1, 1];
    minCorner[drag.axis] = drag.layer;
    minCorner[firstAxis] = bounds.minFirst;
    minCorner[secondAxis] = bounds.minSecond;

    let color = 0xe5484d; // red: blocks will be removed
    if (drag.action === "place") {
      const fill = this.fillPositions(drag);
      const selected = this.state.selectedBlock!;
      const canPlaceAny = fill.positions.some((position) =>
        this.ship.canPlace(selected, position, this.state.orientation),
      );
      color = canPlaceAny ? 0x3ddc84 : 0xe5484d; // green, or red when nothing fits
      size[0] = fill.size[0];
      size[1] = fill.size[1];
      size[2] = fill.size[2];
    } else {
      size[firstAxis] = bounds.maxFirst - bounds.minFirst + 1;
      size[secondAxis] = bounds.maxSecond - bounds.minSecond + 1;
      if (drag.action === "paint") color = 0x4f8cff; // blue: blocks will be repainted
    }

    this.areaPreview.scale.set(size[0], size[1], size[2]);
    this.areaPreview.position.set(
      minCorner[0] + size[0] / 2,
      minCorner[1] + size[1] / 2,
      minCorner[2] + size[2] / 2,
    );
    this.areaPreviewMaterial.color.set(color);
    this.areaPreview.visible = true;
  }

  /** Carries out the drag. Everything it does undoes with one Ctrl+Z. */
  private finishAreaDrag(): void {
    const drag = this.areaDrag;
    if (!drag) return;
    this.endAreaDrag();

    switch (drag.action) {
      case "place": {
        const selected = this.state.selectedBlock;
        if (!selected) return;
        let placed = 0;
        let blocked = 0;
        this.ship.runAsOneStep(() => {
          for (const position of this.fillPositions(drag).positions) {
            const block = this.ship.place(
              selected,
              position,
              { ...this.state.orientation },
              { ...this.state.paint },
              this.state.skin,
            );
            if (block) placed++;
            else blocked++;
          }
        });
        this.onMessage(
          `Placed ${placed} block${placed === 1 ? "" : "s"}` + (blocked > 0 ? ` (${blocked} did not fit)` : ""),
        );
        break;
      }
      case "remove": {
        const ids = this.blocksInArea(drag);
        this.ship.runAsOneStep(() => ids.forEach((id) => this.ship.remove(id)));
        this.onMessage(`Removed ${ids.length} block${ids.length === 1 ? "" : "s"}`);
        break;
      }
      case "paint": {
        const ids = this.blocksInArea(drag);
        const change = this.paintChange();
        this.ship.runAsOneStep(() => ids.forEach((id) => this.ship.paint(id, change)));
        this.onMessage(`Painted ${ids.length} block${ids.length === 1 ? "" : "s"}`);
        break;
      }
    }
  }

  /**
   * Abandons a drag in progress without changing the ship (the Escape key calls
   * this). Returns true if there was a drag to cancel.
   */
  cancelAreaDrag(): boolean {
    if (!this.areaDrag) return false;
    this.endAreaDrag();
    this.onMessage("Cancelled");
    return true;
  }

  /** Common clean-up when a drag ends, whether it finished or was cancelled. */
  private endAreaDrag(): void {
    this.areaDrag = null;
    this.pointerDown = null;
    this.controls.enabled = true;
    this.areaPreview.visible = false;
    this.updateGhost();
  }

  // -------------------------------------------------------------------------
  // Window size and the render loop
  // -------------------------------------------------------------------------

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
